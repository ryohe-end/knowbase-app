// lib/auth.ts
// Edge-safe auth helpers (Web Crypto based). Usable from middleware AND Node API routes.

const ENC = new TextEncoder();

function getSecret(): string {
  const secret = process.env.KB_COOKIE_SECRET || "";
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("KB_COOKIE_SECRET must be set to a 32+ character value in production");
    }
    return "dev-only-insecure-secret-please-set-KB_COOKIE_SECRET";
  }
  return secret;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    ENC.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(v)) return null;
    bytes[i] = v;
  }
  return bytes;
}

/**
 * Sign a value with HMAC-SHA256. Returns "<value>.<hexSig>".
 * Use for cookie values we want to prevent tampering on.
 */
export async function signValue(value: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, ENC.encode(value));
  return `${value}.${bufToHex(sig)}`;
}

/**
 * Verify a signed value produced by signValue. Returns the original value if
 * the signature is valid, else null.
 */
export async function verifySignedValue(signed: string | undefined | null): Promise<string | null> {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const macHex = signed.slice(idx + 1);
  const macBytes = hexToBytes(macHex);
  if (!macBytes) return null;
  try {
    const key = await hmacKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      macBytes as BufferSource,
      ENC.encode(value)
    );
    return ok ? value : null;
  } catch {
    return null;
  }
}

/**
 * Sign an admin marker bound to an email so kb_admin can't be moved between users.
 * Stored value format: "admin:<email>.<hmac>"
 */
export function makeAdminCookiePayload(email: string): Promise<string> {
  return signValue(`admin:${email}`);
}

/**
 * Verify kb_admin against a specific email. Returns true only if the cookie
 * was signed for that exact email.
 */
export async function verifyAdminCookie(
  cookieValue: string | undefined | null,
  expectedEmail: string | undefined | null
): Promise<boolean> {
  if (!cookieValue || !expectedEmail) return false;
  const decoded = await verifySignedValue(cookieValue);
  if (!decoded) return false;
  return decoded === `admin:${expectedEmail}`;
}

/**
 * Read verified session from a request's cookies. Returns { email, isAdmin } or null.
 * Works with NextRequest (middleware) and plain Request (via req.cookies if provided).
 */
type CookieSource = {
  get: (name: string) => { value: string } | undefined;
};

export async function readVerifiedSession(
  cookies: CookieSource
): Promise<{ email: string; isAdmin: boolean } | null> {
  const rawUser = cookies.get("kb_user")?.value;
  if (!rawUser) return null;
  const email = await verifySignedValue(rawUser);
  if (!email) return null;
  const rawAdmin = cookies.get("kb_admin")?.value;
  const isAdmin = await verifyAdminCookie(rawAdmin, email);
  return { email, isAdmin };
}

/**
 * Admin gate for API routes.
 *
 * Accepts either:
 *   1. A valid signed kb_admin cookie bound to the signed kb_user.
 *   2. A matching `x-kb-admin-key` header or `?token=` query (server-to-server
 *      automation — e.g. scheduled notify endpoint).
 */
export async function isAdminRequest(req: Request): Promise<boolean> {
  // Cookie path (admin UI)
  const cookieHeader = req.headers.get("cookie") || "";
  const cookieMap = parseCookieHeader(cookieHeader);
  const session = await readVerifiedSession({
    get: (n) => (cookieMap[n] !== undefined ? { value: cookieMap[n] } : undefined),
  });
  if (session?.isAdmin) return true;

  // Header / query path (automation). Compare in constant time.
  const expected = (process.env.KB_ADMIN_API_KEY || "").trim();
  if (!expected) return false;
  const headerKey = (req.headers.get("x-kb-admin-key") || "").trim();
  let tokenKey = "";
  try {
    tokenKey = (new URL(req.url).searchParams.get("token") || "").trim();
  } catch {
    /* ignore */
  }
  if (headerKey && timingSafeEqualStr(headerKey, expected)) return true;
  if (tokenKey && timingSafeEqualStr(tokenKey, expected)) return true;
  return false;
}

/**
 * Check if a request's session user has a specific permission flag.
 * Looks up yamauchi-Users by signed kb_user email. Requires AWS region + creds.
 * NOTE: role: admin alone does NOT grant a permission - explicit grant required.
 */
export async function requestHasPermission(
  req: Request,
  perm: string
): Promise<boolean> {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookieMap = parseCookieHeader(cookieHeader);
  const session = await readVerifiedSession({
    get: (n) => (cookieMap[n] !== undefined ? { value: cookieMap[n] } : undefined),
  });
  if (!session) return false;

  // Dynamic import so this module stays edge-safe when not called.
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, QueryCommand } = await import(
    "@aws-sdk/lib-dynamodb"
  );
  const region = process.env.AWS_REGION || "us-east-1";
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  try {
    const res = await ddb.send(
      new QueryCommand({
        TableName: "yamauchi-Users",
        IndexName: "email-index",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": session.email },
        Limit: 1,
        ProjectionExpression: "#p, isActive",
        ExpressionAttributeNames: { "#p": "permissions" },
      })
    );
    const u = res.Items?.[0] as { permissions?: string[]; isActive?: boolean } | undefined;
    if (!u || u.isActive === false) return false;
    return Array.isArray(u.permissions) && u.permissions.includes(perm);
  } catch (e) {
    console.error("[requestHasPermission] DynamoDB error", e);
    return false;
  }
}

/** DynamoDB の文字列/文字列配列/{S:..} を string[] に正規化 */
function normalizeStringArray(raw: any): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((x: any) => (x && typeof x === "object" && "S" in x ? String(x.S) : String(x ?? "")))
    .map((s: string) => s.trim())
    .filter(Boolean);
}

/**
 * セッション(kb_user cookie)のユーザーを yamauchi-Users から解決する。
 * ログインユーザーのクラブスコープ (clubCodes) 判定に使う。
 * clubCodes が空の admin は「全クラブ可」を意味する (stores API と同じ規約)。
 */
export async function getSessionUser(
  req: Request
): Promise<{ email: string; role: string; clubCodes: string[]; groupIds: string[]; areas: string[] } | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookieMap = parseCookieHeader(cookieHeader);
  const session = await readVerifiedSession({
    get: (n) => (cookieMap[n] !== undefined ? { value: cookieMap[n] } : undefined),
  });
  if (!session) return null;

  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, QueryCommand } = await import("@aws-sdk/lib-dynamodb");
  const region = process.env.AWS_REGION || "us-east-1";
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  try {
    const res = await ddb.send(
      new QueryCommand({
        TableName: "yamauchi-Users",
        IndexName: "email-index",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": session.email },
        Limit: 1,
        ProjectionExpression: "email, #r, groupIds, clubCodes, areas, isActive",
        ExpressionAttributeNames: { "#r": "role" },
      })
    );
    const u = res.Items?.[0] as any;
    if (!u || u.isActive === false) return null;
    const areas = normalizeStringArray(u.areas);
    // 担当エリア(companyGroup)を店舗に展開し、個別clubCodesと union した実効スコープを返す
    const { effectiveClubCodes } = await import("./clubScope");
    const clubCodes = await effectiveClubCodes(normalizeStringArray(u.clubCodes), areas, { role: String(u.role ?? "") });
    return {
      email: String(u.email ?? session.email),
      role: String(u.role ?? ""),
      clubCodes,
      groupIds: normalizeStringArray(u.groupIds),
      areas,
    };
  } catch (e) {
    console.error("[getSessionUser] DynamoDB error", e);
    return null;
  }
}

function parseCookieHeader(h: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const part of h.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
