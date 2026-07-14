// app/api/admin/chat-logs/route.ts
// AIチャットの会話ログ閲覧 (管理者専用)。誰が・何を聞き・どう答えたかを確認する。
// フィルタ: ?userId= / ?q=(質問・回答の部分一致) / ?from=&to=(YYYY-MM-DD) / ?limit=
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.KB_CHAT_LOG_TABLE || "knowbie-chat-logs";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const MAX_SCAN = 5000;

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const userId = (searchParams.get("userId") || "").trim();
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const from = (searchParams.get("from") || "").trim();
  const to = (searchParams.get("to") || "").trim();
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 200, 1), 1000);

  const filters: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  if (userId) { filters.push("userId = :u"); values[":u"] = userId; }
  if (from) { filters.push("#day >= :from"); names["#day"] = "day"; values[":from"] = from; }
  if (to) { filters.push("#day <= :to"); names["#day"] = "day"; values[":to"] = to; }

  const items: any[] = [];
  try {
    let lastKey: Record<string, any> | undefined;
    do {
      const res: any = await ddb.send(new ScanCommand({
        TableName: TABLE,
        ...(filters.length ? { FilterExpression: filters.join(" AND ") } : {}),
        ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ExclusiveStartKey: lastKey,
      }));
      if (Array.isArray(res.Items)) items.push(...res.Items);
      lastKey = res.LastEvaluatedKey;
    } while (lastKey && items.length < MAX_SCAN);
  } catch (e: any) {
    console.error("[admin/chat-logs] scan failed:", e?.message);
    return NextResponse.json({ ok: false, error: "scan_failed", logs: [] }, { status: 502 });
  }

  let logs = items;
  if (q) {
    logs = logs.filter(
      (l) => String(l.query || "").toLowerCase().includes(q) || String(l.answer || "").toLowerCase().includes(q)
    );
  }
  logs.sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
  const truncated = items.length >= MAX_SCAN;
  return NextResponse.json({ ok: true, logs: logs.slice(0, limit), total: logs.length, truncated });
}
