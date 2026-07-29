// lib/accountingAuth.ts
//
// 経理(会計)管理画面の閲覧可否。以下のいずれかで許可:
//   - role === "finance"(経理ユーザー)
//   - permissions に "accounting"(経理フラグ。/admin/users で付与)
//   - 許可メール(ACCOUNTING_ALLOW_EMAILS。既定=遠藤 陵平)
// 対象: /accounting(ポイント会計・返金/入金の経理処理)。
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export const ACCOUNTING_PERMISSION = "accounting";

// 許可メール(小文字)。既定で遠藤 陵平。env で上書き/追加可(カンマ区切り)。
const ALLOW_EMAILS = (process.env.ACCOUNTING_ALLOW_EMAILS || "r-endo@okamoto-group.co.jp")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export type AccountingIdentity = { email?: string | null; role?: string | null; permissions?: string[] | null };

// 純粋判定(クライアント/サーバ共用可)。
export function canViewAccounting(u: AccountingIdentity | null | undefined): boolean {
  if (!u) return false;
  if (String(u.role || "") === "finance") return true;
  if (Array.isArray(u.permissions) && u.permissions.includes(ACCOUNTING_PERMISSION)) return true;
  if (u.email && ALLOW_EMAILS.includes(String(u.email).toLowerCase())) return true;
  return false;
}

function normArr(raw: any): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((x) => (typeof x === "string" ? x : x?.S ?? String(x))).map((s: string) => String(s).trim()).filter(Boolean);
}

// サーバ: kb_user cookie から会員を解決(role/permissions/email/name)。
export async function getAccountingIdentity(): Promise<{ email: string; role: string; permissions: string[]; name: string; userId: string } | null> {
  try {
    const cookieStore = await cookies();
    const email = (await verifySignedValue(cookieStore.get("kb_user")?.value)) ?? "";
    if (!email) return null;
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE_USERS, IndexName: EMAIL_GSI_NAME,
      KeyConditionExpression: "email = :email", ExpressionAttributeValues: { ":email": email }, Limit: 1,
      ProjectionExpression: "userId, #n, email, #r, #p, isActive",
      ExpressionAttributeNames: { "#n": "name", "#r": "role", "#p": "permissions" },
    }));
    const u = res.Items?.[0] as any;
    if (!u || u.isActive === false) return null;
    return { email: String(u.email ?? email), role: String(u.role ?? ""), permissions: normArr(u.permissions), name: String(u.name ?? ""), userId: String(u.userId ?? "") };
  } catch (e) {
    console.error("[accountingAuth] error:", e);
    return null;
  }
}

// API ゲート用: 経理可なら identity を返し、不可なら null。
export async function requireAccounting() {
  const u = await getAccountingIdentity();
  return u && canViewAccounting(u) ? u : null;
}
