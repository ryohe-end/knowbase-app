// lib/refundAuth.ts
// 返金 API 共通の認証/役割解決。

import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export type RefundUser = {
  userId: string;
  name: string;
  email: string;
  role: string;
  dept?: string;
  clubCodes: string[];     // yamauchi-Users.clubCodes (空=全クラブ)
};

function normArr(raw: any): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((x: any) => (typeof x === "string" ? x : (x?.S ?? String(x))))
    .map((s: string) => String(s).trim())
    .filter(Boolean);
}

export async function getRefundUser(): Promise<RefundUser | null> {
  try {
    const cookieStore = await cookies();
    const rawUser = cookieStore.get("kb_user")?.value ?? "";
    const email = (await verifySignedValue(rawUser)) ?? "";
    if (!email) return null;

    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_USERS,
        IndexName: EMAIL_GSI_NAME,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
        ProjectionExpression: "userId, #n, email, #r, dept, clubCodes, areas, groupIds, isActive",
        ExpressionAttributeNames: { "#n": "name", "#r": "role" },
      })
    );
    const u = res.Items?.[0] as any;
    if (!u || u.isActive === false) return null;
    // 担当エリア(companyGroup)を店舗に展開し、個別clubCodesと union した実効スコープを返す
    const { effectiveClubCodes } = await import("./clubScope");
    const clubCodes = await effectiveClubCodes(normArr(u.clubCodes), normArr(u.areas), {
      groupIds: normArr(u.groupIds), role: String(u.role ?? ""),
    });
    return {
      userId: String(u.userId ?? ""),
      name: String(u.name ?? ""),
      email: String(u.email ?? ""),
      role: String(u.role ?? ""),
      dept: typeof u.dept === "string" ? u.dept : undefined,
      clubCodes,
    };
  } catch (e) {
    console.error("[refundAuth] error:", e);
    return null;
  }
}

// 役割マトリクス (アカウント種別)
//   store(店舗)   : 申請のみ
//   admin(管理者) : 申請 + 承認   ※経理は不可(件名通り)
//   finance(経理) : 経理のみ
export function canApply(user: RefundUser): boolean {
  // 経理アカウントは申請しない。それ以外(店舗/管理者/viewer 等)は申請可。
  return user.role !== "finance";
}
export function canApprove(user: RefundUser): boolean {
  return user.role === "admin" || user.role === "approver";
}
export function canFinance(user: RefundUser): boolean {
  // 経理のみ。管理者(admin)は経理メニュー/処理を持たない。
  return user.role === "finance";
}
// クラブスコープ判定 (clubCodes が空なら全クラブ、そうでなければ含まれる必要あり)
export function isClubInScope(user: RefundUser, clubCode: string): boolean {
  if (user.clubCodes.length === 0) return true;
  return user.clubCodes.includes(clubCode);
}
