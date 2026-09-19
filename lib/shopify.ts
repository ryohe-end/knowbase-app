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
  if (!APP_SECRET || !hmacHeader) return false;
  const digest = crypto.createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("base64");
  try {
    const a = new Uint8Array(Buffer.from(digest));
    const b = new Uint8Array(Buffer.from(hmacHeader));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Customer Account UI Extension のセッショントークン(JWT/HS256)検証。
 * アプリの Client secret(APP_SECRET) で署名検証し、ログイン顧客IDを返す。
 * - `sub` = 顧客の gid（アプリに read_customers 権限がある時のみ付与される）
 * - `dest` = ストアURL。SHOP_DOMAIN と一致するか確認。
 * 失敗時は null。設計: docs/shopify-loyalty-integration.md §4.1c
 */
export function verifySessionToken(token: string): { customerId: string; dest: string } | null {
  if (!APP_SECRET || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // 署名検証（HS256）
  const expected = crypto.createHmac("sha256", APP_SECRET).update(`${headerB64}.${payloadB64}`).digest();
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
  if (SHOP_DOMAIN && payload.dest && !String(payload.dest).includes(SHOP_DOMAIN)) return null;

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

async function adminGraphql<T = any>(query: string, variables: Record<string, any>): Promise<T> {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) throw new Error("Shopify Admin API not configured");
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
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

/** email から顧客ID(数値文字列)を1件解決。見つからなければ null。 */
export async function findCustomerIdByEmail(email: string): Promise<string | null> {
  const data = await adminGraphql<{ customers: { edges: { node: { id: string } }[] } }>(
    `query($q:String!){ customers(first:1, query:$q){ edges{ node{ id } } } }`,
    { q: `email:${JSON.stringify(email)}` }
  );
  const gid = data.customers.edges[0]?.node.id;
  return gid ? gid.split("/").pop() || null : null;
}
