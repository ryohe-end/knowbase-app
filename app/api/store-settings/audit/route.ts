// app/api/store-settings/audit/route.ts
// 操作監査ログの閲覧API (管理者専用)。DynamoDB(knowbie-audit-logs)を読み出す。
// フィルタ: ?action= (前方一致) / ?clubCode= / ?userId= / ?from= / ?to= (ISO) / ?limit=
// テーブルは PAY_PER_REQUEST で件数も限定的なため Scan + JS 側で新しい順ソートする。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.AUDIT_LOG_TABLE || "knowbie-audit-logs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// Scan の暴走防止: 最大この件数までページングして集める
const MAX_SCAN_ITEMS = 5000;

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const action = (searchParams.get("action") || "").trim();
  const clubCode = (searchParams.get("clubCode") || "").trim();
  const userId = (searchParams.get("userId") || "").trim();
  const from = (searchParams.get("from") || "").trim(); // ISO 下限 (含む)
  const to = (searchParams.get("to") || "").trim(); // ISO 上限 (含む)
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 200, 1), 1000);

  // FilterExpression を動的に組み立てる
  const filters: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  if (action) {
    filters.push("begins_with(#action, :action)");
    names["#action"] = "action";
    values[":action"] = action;
  }
  if (userId) {
    filters.push("userId = :userId");
    values[":userId"] = userId;
  }
  if (clubCode) {
    filters.push("contains(clubCodes, :clubCode)");
    values[":clubCode"] = clubCode;
  }
  if (from) {
    filters.push("#ts >= :from");
    names["#ts"] = "timestamp";
    values[":from"] = from;
  }
  if (to) {
    filters.push("#ts <= :to");
    names["#ts"] = "timestamp";
    values[":to"] = to;
  }

  const items: any[] = [];
  try {
    let lastKey: Record<string, any> | undefined = undefined;
    do {
      const res: any = await ddb.send(
        new ScanCommand({
          TableName: TABLE,
          ...(filters.length > 0 ? { FilterExpression: filters.join(" AND ") } : {}),
          ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
          ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
          ExclusiveStartKey: lastKey,
        })
      );
      if (Array.isArray(res.Items)) items.push(...res.Items);
      lastKey = res.LastEvaluatedKey;
    } while (lastKey && items.length < MAX_SCAN_ITEMS);
  } catch (e: any) {
    console.error("[audit GET] scan failed:", e?.message || e);
    return NextResponse.json({ ok: false, error: "scan_failed", logs: [] }, { status: 502 });
  }

  // 新しい順 (timestamp desc)
  items.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const truncated = items.length >= MAX_SCAN_ITEMS;
  return NextResponse.json({ ok: true, logs: items.slice(0, limit), total: items.length, truncated });
}
