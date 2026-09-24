// lib/shopify.ts
// Shopify 連携ヘルパー（オンラインショップ ⇄ CPSS ポイント連携用）。
//   - App Proxy 署名検証 / Webhook HMAC 検証
//   - Admin API (GraphQL) で顧客メタフィールドの読み書き・email検索
// 設計: docs/shopify-loyalty-integration.md
import crypto from "node:crypto";
import { loadRuntimeEnv } from "@/lib/runtimeEnv";

loadRuntimeEnv();

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN || "";
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
// App Proxy / Webhook の署名検証に使うアプリのシークレット（Client secret）。
const APP_SECRET = process.env.SHOPIFY_APP_PROXY_SECRET || "";
// Customer Account UI Extension(minefit-loyalty アプリ)のセッショントークン検証用。
// App Proxy とは別アプリなので secret / client_id を分ける（未設定なら APP_SECRET にフォールバック）。
const LOYALTY_APP_SECRET = process.env.SHOPIFY_LOYALTY_APP_SECRET || APP_SECRET;
// minefit-loyalty アプリの client_id（公開値。aud 検証用）。env 未設定ならこの既定を使う。
const LOYALTY_APP_CLIENT_ID =
  process.env.SHOPIFY_LOYALTY_APP_CLIENT_ID || "f300f735bdf80352e273526af992f973";

export const LOYALTY_NAMESPACE = "loyalty";

// ---- 署名検証 -------------------------------------------------------------

/**
 * App Proxy 署名検証。Shopify は `signature` 以外の全クエリを key ソートし
 * `key=value`（配列は `,` 連結）を区切り無しで連結、アプリ secret で HMAC-SHA256(hex)。
 */
export function verifyAppProxySignature(url: URL): boolean {
  if (!APP_SECRET) return false;
  const params = url.searchParams;
  const signature = params.get("signature");
  if (!signature) return false;

  const message = [...params.entries()]
    .filter(([k]) => k !== "signature")
    .map(([k, v]) => [k, v] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    // 同一キーが複数ある場合は `,` 連結
    .reduce<Record<string, string[]>>((acc, [k, v]) => {
      (acc[k] ||= []).push(v);
      return acc;
    }, {});
  const serialized = Object.keys(message)
    .sort()
    .map((k) => `${k}=${message[k].join(",")}`)
    .join("");

  const digest = crypto.createHmac("sha256", APP_SECRET).update(serialized).digest("hex");
  return timingSafeEqualHex(digest, signature);
}

/** Webhook HMAC 検証（raw body の base64 HMAC-SHA256 と X-Shopify-Hmac-Sha256 を比較）。 */
export function verifyWebhookHmac(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;
  // webhookを作成したアプリのsecretで署名される。minefit-loyalty(LOYALTY_APP_SECRET)/App Proxy(APP_SECRET) 両対応。
  const secrets = [LOYALTY_APP_SECRET, APP_SECRET].filter((s, i, a) => s && a.indexOf(s) === i);
  for (const secret of secrets) {
    const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    try {
      const a = new Uint8Array(Buffer.from(digest));
      const b = new Uint8Array(Buffer.from(hmacHeader));
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch {
      /* 次の secret を試す */
    }
  }
  return false;
}

/**
 * Customer Account UI Extension のセッショントークン(JWT/HS256)検証。
 * minefit-loyalty アプリの Client secret で署名検証し、ログイン顧客IDを返す。
 * - `sub` = 顧客の gid（アプリに read_customers 権限がある時のみ付与される）
 * - `aud` = アプリの client_id。LOYALTY_APP_CLIENT_ID と一致するか確認（ストア非依存＝test/本番どちらでも可）。
 * 失敗時は null。設計: docs/shopify-loyalty-integration.md §4.1c
 */
export function verifySessionToken(token: string): { customerId: string; dest: string } | null {
  if (!LOYALTY_APP_SECRET || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // 署名検証（HS256）
  const expected = crypto.createHmac("sha256", LOYALTY_APP_SECRET).update(`${headerB64}.${payloadB64}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(new Uint8Array(expected), new Uint8Array(provided))
  ) {
    return null;
  }

  // ペイロード検証
  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now >= payload.exp) return null;
  if (typeof payload.nbf === "number" && now < payload.nbf - 5) return null;
  // aud(=client_id)で検証。設定があれば厳格に、無ければ dest でストア確認にフォールバック。
  if (LOYALTY_APP_CLIENT_ID) {
    if (String(payload.aud) !== LOYALTY_APP_CLIENT_ID) return null;
  } else if (SHOP_DOMAIN && payload.dest && !String(payload.dest).includes(SHOP_DOMAIN)) {
    return null;
  }

  const sub = payload.sub ? String(payload.sub) : "";
  if (!sub) return null; // 未ログイン、または read_customers 権限なし
  return { customerId: sub, dest: String(payload.dest || "") };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = new Uint8Array(Buffer.from(a, "hex"));
    const bb = new Uint8Array(Buffer.from(b, "hex"));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// ---- Admin API (GraphQL) --------------------------------------------------

export function customerGid(id: string | number): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/Customer/${s}`;
}

// Dev Dashboard アプリは静的Adminトークンを出せないため、client_credentials grant で
// 短命(24h)Adminトークンを取得しキャッシュする。静的 SHOPIFY_ADMIN_API_TOKEN があればそれを優先。
let cachedAdminToken: { token: string; exp: number } | null = null;
async function getAdminAccessToken(): Promise<string> {
  if (ADMIN_TOKEN) return ADMIN_TOKEN;
  const now = Date.now();
  if (cachedAdminToken && cachedAdminToken.exp > now + 60_000) return cachedAdminToken.token;
  if (!SHOP_DOMAIN || !LOYALTY_APP_CLIENT_ID || !LOYALTY_APP_SECRET) {
    throw new Error("Admin token config missing (SHOP_DOMAIN/LOYALTY_APP_CLIENT_ID/LOYALTY_APP_SECRET)");
  }
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: LOYALTY_APP_CLIENT_ID,
      client_secret: LOYALTY_APP_SECRET,
    }).toString(),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) {
    throw new Error(`client_credentials failed: ${JSON.stringify(j)}`);
  }
  cachedAdminToken = { token: j.access_token, exp: now + Number(j.expires_in || 86399) * 1000 };
  return cachedAdminToken.token;
}

async function adminGraphql<T = any>(query: string, variables: Record<string, any>): Promise<T> {
  if (!SHOP_DOMAIN) throw new Error("Shopify Admin API not configured");
  const token = await getAdminAccessToken();
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`Shopify Admin API error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data as T;
}

export type LoyaltyMetafields = {
  member_id?: string;
  rank?: string;
  rank_name?: string;
  points?: number;
  synced_at?: string;
};

/** 顧客の loyalty.* メタフィールドを取得。 */
export async function getLoyaltyMetafields(customerId: string | number): Promise<LoyaltyMetafields> {
  const data = await adminGraphql<{
    customer: { metafields: { edges: { node: { key: string; value: string } }[] } } | null;
  }>(
    `query($id:ID!,$ns:String!){
      customer(id:$id){ metafields(namespace:$ns, first:10){ edges{ node{ key value } } } }
    }`,
    { id: customerGid(customerId), ns: LOYALTY_NAMESPACE }
  );
  const out: LoyaltyMetafields = {};
  for (const e of data.customer?.metafields.edges ?? []) {
    const { key, value } = e.node;
    if (key === "points") out.points = Number(value);
    else (out as any)[key] = value;
  }
  return out;
}

/** 顧客の loyalty.* メタフィールドを upsert。 */
export async function setLoyaltyMetafields(
  customerId: string | number,
  fields: LoyaltyMetafields
): Promise<void> {
  const ownerId = customerGid(customerId);
  const typeFor = (k: string) => (k === "points" ? "number_integer" : k === "synced_at" ? "date_time" : "single_line_text_field");
  const metafields = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([key, v]) => ({
      ownerId,
      namespace: LOYALTY_NAMESPACE,
      key,
      type: typeFor(key),
      value: String(v),
    }));
  if (metafields.length === 0) return;

  const data = await adminGraphql<{ metafieldsSet: { userErrors: { field: string[]; message: string }[] } }>(
    `mutation($metafields:[MetafieldsSetInput!]!){
      metafieldsSet(metafields:$metafields){ userErrors{ field message } }
    }`,
    { metafields }
  );
  const errs = data.metafieldsSet.userErrors;
  if (errs?.length) throw new Error(`metafieldsSet failed: ${JSON.stringify(errs)}`);
}

/**
 * 商品ID配列 → タグ一覧のマップ（{ "123": ["private-brand", ...] }）。
 * 注文Webhookの line_items には商品タグが含まれないため、付与判定用に取得する。
 */
export async function getProductsTags(
  productIds: (string | number)[]
): Promise<Record<string, string[]>> {
  const ids = [...new Set(productIds.map((v) => String(v)).filter((v) => v && v !== "null"))];
  if (ids.length === 0) return {};
  const gids = ids.map((id) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`));
  const data = await adminGraphql<{ nodes: ({ id: string; tags: string[] } | null)[] }>(
    `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id tags } } }`,
    { ids: gids }
  );
  const out: Record<string, string[]> = {};
  for (const n of data.nodes ?? []) {
    if (!n?.id) continue;
    const numeric = n.id.split("/").pop() as string;
    out[numeric] = Array.isArray(n.tags) ? n.tags : [];
  }
  return out;
}

/** email から顧客ID(数値文字列)を1件解決。見つからなければ null。 */
export async function findCustomerIdByEmail(email: string): Promise<string | null> {
  const data = await adminGraphql<{ customers: { edges: { node: { id: string } }[] } }>(
    `query($q:String!){ customers(first:1, query:$q){ edges{ node{ id } } } }`,
    { q: `email:${JSON.stringify(email)}` }
  );
  const gid = data.customers.edges[0]?.node.id;
  return gid ? gid.split("/").pop() || null : null;
}
