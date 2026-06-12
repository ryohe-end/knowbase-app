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
  groupIds: string[];      // clubCode 配列 (空=全店)
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
        ProjectionExpression: "userId, #n, email, #r, dept, groupIds, isActive",
        ExpressionAttributeNames: { "#n": "name", "#r": "role" },
      })
    );
    const u = res.Items?.[0] as any;
    if (!u || u.isActive === false) return null;
    return {
      userId: String(u.userId ?? ""),
      name: String(u.name ?? ""),
      email: String(u.email ?? ""),
      role: String(u.role ?? ""),
      dept: typeof u.dept === "string" ? u.dept : undefined,
      groupIds: normArr(u.groupIds),
    };
  } catch (e) {
    console.error("[refundAuth] error:", e);
    return null;
  }
}

// 役割マトリクス
export function canApprove(user: RefundUser): boolean {
  return user.role === "admin" || user.role === "approver";
}
export function canFinance(user: RefundUser): boolean {
  return user.role === "admin" || user.role === "finance";
}
// クラブスコープ判定 (groupIds が空なら全店、そうでなければ含まれる必要あり)
export function isClubInScope(user: RefundUser, clubCode: string): boolean {
  if (user.groupIds.length === 0) return true;
  return user.groupIds.includes(clubCode);
}
