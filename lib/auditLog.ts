// lib/auditLog.ts
// 操作監査ログ。誰が・いつ・何をしたかを DynamoDB(knowbie-audit-logs) に記録する。
// 失敗しても本処理を止めない (ベストエフォート)。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.AUDIT_LOG_TABLE || "knowbie-audit-logs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

export type AuditEntry = {
  userId: string;            // 実行者(メール or userId)
  userName?: string;         // 表示名
  action: string;           // 例: "push.send" / "dm.send" / "refund.transition" / "member.extract"
  resource?: string;         // 対象種別 例: "club:511" / "member:5110004421" / "application:xxx"
  clubCodes?: string[];      // 対象店舗
  targetCount?: number;      // 対象件数(配信人数など)
  detail?: Record<string, unknown>; // 補足(タイトル/件名/遷移先など)
  ip?: string;               // 送信元IP
  result?: "ok" | "error";  // 成否
};

// req から送信元IP(X-Forwarded-For の先頭)を取り出す
export function clientIp(req: Request): string | undefined {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || undefined;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        userId: entry.userId || "unknown",
        timestamp: new Date().toISOString(),
        action: entry.action,
        userName: entry.userName,
        resource: entry.resource,
        clubCodes: entry.clubCodes && entry.clubCodes.length > 0 ? entry.clubCodes : undefined,
        targetCount: entry.targetCount,
        detail: entry.detail,
        ip: entry.ip,
        result: entry.result || "ok",
      },
    }));
  } catch (e) {
    console.error("[audit] write failed:", (e as Error)?.message, "action=", entry.action);
  }
}
