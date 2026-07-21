// app/api/store-settings/audit/route.ts
// 操作監査ログの閲覧API (管理者専用)。DynamoDB(knowbie-audit-logs)を読み出す。
// フィルタ: ?action= (前方一致) / ?clubCode= / ?userId= / ?from= / ?to= (ISO) / ?limit=
// テーブルは PAY_PER_REQUEST で件数も限定的なため Scan + JS 側で新しい順ソートする。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getSessionUser } from "@/lib/auth";
import { isAdminLike } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.AUDIT_LOG_TABLE || "knowbie-audit-logs";
const USERS_TABLE = process.env.USERS_TABLE || "yamauchi-Users";
const USERS_EMAIL_GSI = process.env.USERS_EMAIL_GSI || "email-index";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// Scan の暴走防止: 最大この件数までページングして集める
const MAX_SCAN_ITEMS = 5000;

// userName が空の監査レコード向けに、userId(=email) から登録名を引く(email-index)。短時間キャッシュ。
const nameCache = new Map<string, { at: number; name: string | null }>();
async function resolveUserName(userId: string): Promise<string | null> {
  const hit = nameCache.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.name;
  let name: string | null = null;
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: USERS_TABLE, IndexName: USERS_EMAIL_GSI,
      KeyConditionExpression: "email = :e", ExpressionAttributeValues: { ":e": userId },
      ProjectionExpression: "#n", ExpressionAttributeNames: { "#n": "name" }, Limit: 1,
    }));
    name = (r.Items?.[0] as any)?.name ?? null;
  } catch { name = null; }
  nameCache.set(userId, { at: Date.now(), name });
  return name;
}

export async function GET(req: Request) {
  // 監査ログ閲覧は admin または SV(加盟店SV) に開放 (店舗設定内の機能)。
  const sessionUser = await getSessionUser(req);
  if (!sessionUser || !isAdminLike(sessionUser.role)) {
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
  const logs = items.slice(0, limit);

  // userName が空の記録は Users(email-index) から名前を補完して「名前が出ない人」を解消
  const missing = [...new Set(logs.filter((l) => !l.userName && l.userId).map((l) => String(l.userId)))];
  if (missing.length > 0) {
    const resolved = await Promise.all(missing.map(async (uid) => [uid, await resolveUserName(uid)] as const));
    const nameByUser = new Map(resolved);
    for (const l of logs) if (!l.userName && l.userId) { const n = nameByUser.get(String(l.userId)); if (n) l.userName = n; }
  }
  return NextResponse.json({ ok: true, logs, total: items.length, truncated });
}
