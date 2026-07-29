// app/api/admin/points-accounting/fund-import/route.ts
//
// CPSS管理コンソールの発行原資(shop_<6桁>_issue:FND)エクスポートを貼り付けて取り込む(admin専用)。
// 各行: 原資ID  発行合計  発行件数  消費合計  失効合計  → 真残高 = 発行 − 消費 − 失効。
// 保存: DynamoDB knowbie-point-fund (PK=clubCode)。ポイント会計ダッシュボードの残高(B方式)に使う。
//   POST { text: "shop_000101_issue:FND\t424095\t34199\t174013\t73411\n..." , snapshotAt?: "YYYY-MM-DD" }
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { isAdminRequest, verifySignedValue, parseCookieHeader } from "@/lib/auth";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const FUND_TABLE = process.env.POINT_FUND_TABLE || "knowbie-point-fund";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// 1行 → {clubCode, issued, issuedCount, consumed, expired, balance} | null
function parseLine(line: string): any | null {
  const m = line.match(/shop_(\d+)_issue:FND[\s,]+(\d+)[\s,]+(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (!m) return null;
  const clubCode = String(parseInt(m[1], 10)); // 6桁→leading0除去
  const issued = Number(m[2]), issuedCount = Number(m[3]), consumed = Number(m[4]), expired = Number(m[5]);
  return { clubCode, issued, issuedCount, consumed, expired, balance: issued - consumed - expired };
}

async function actorEmail(req: Request): Promise<string> {
  try {
    const map = parseCookieHeader(req.headers.get("cookie") || "");
    return (await verifySignedValue(map["kb_user"])) || "admin";
  } catch { return "admin"; }
}

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  let body: { text?: string; snapshotAt?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const text = String(body?.text || "");
  if (!text.trim()) return NextResponse.json({ ok: false, error: "貼り付けデータが空です" }, { status: 400 });
  const snapshotAt = /^\d{4}-\d{2}-\d{2}$/.test(body?.snapshotAt || "")
    ? (body!.snapshotAt as string)
    : new Date().toISOString().slice(0, 10);

  const rows: any[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const r = parseLine(line);
    if (!r) { skipped++; continue; }
    if (seen.has(r.clubCode)) continue;
    seen.add(r.clubCode);
    rows.push({ ...r, snapshotAt, source: "cpss-console" });
  }
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "取り込める行がありません（形式: shop_000101_issue:FND<TAB>発行<TAB>件数<TAB>消費<TAB>失効）", skipped }, { status: 400 });
  }

  try {
    for (let i = 0; i < rows.length; i += 25) {
      await ddb.send(new BatchWriteCommand({
        RequestItems: { [FUND_TABLE]: rows.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) },
      }));
    }
  } catch (e: any) {
    console.error("[fund-import] write error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }

  const email = await actorEmail(req);
  void writeAudit({
    userId: email, action: "pointFund.import", targetCount: rows.length,
    detail: { imported: rows.length, skipped, snapshotAt }, ip: clientIp(req), result: "ok",
  });
  return NextResponse.json({ ok: true, imported: rows.length, skipped, snapshotAt });
}
