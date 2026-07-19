// app/api/store-settings/recess/route.ts
//
// 休会ロスター(月別休会者)の参照。夜間集計 Lambda(knowbie-recess-roster)が書いた
// DynamoDB(knowbie-recess-roster)を読む(相手DB負荷ゼロ)。休会マスタは外部API側で、
// DBには recess_api_history のログのみ → 現在の休会状態(rw='a', apply_flg=true)を集計済み。
//   GET                 → 分析サマリー(月別件数・ブランド別・店舗別・更新時刻)
//   GET ?month=YYYYMM   → その月の休会者一覧(スコープ内)
// アクセス: 管理者=全店 / 店舗ユーザー=自clubCode。
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = process.env.RECESS_TABLE || "knowbie-recess-roster";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" }));

async function getMeta(): Promise<{ runId: string; monthTotals: Record<string, number>; updatedAt: string } | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { recessMonth: "__META__", memberKey: "current" } }));
  return (r.Item as any) ?? null;
}
const inScope = (user: any, clubCode: string) => user.clubCodes.length === 0 || isClubInScope(user, clubCode);

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = user.clubCodes.length === 0;
  const meta = await getMeta();
  if (!meta) return NextResponse.json({ ready: false, months: [], updatedAt: null, isAdmin });
  const runId = meta.runId;
  const month = new URL(req.url).searchParams.get("month");

  // ── 月別一覧 ──
  if (month) {
    if (!/^\d{6}$/.test(month)) return NextResponse.json({ error: "month は YYYYMM" }, { status: 400 });
    const out: any[] = [];
    let ek: any;
    do {
      const r = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "recessMonth = :m",
        FilterExpression: "runId = :r",
        ExpressionAttributeValues: { ":m": month, ":r": runId },
        ExclusiveStartKey: ek,
      }));
      for (const it of r.Items || []) {
        if (!inScope(user, String(it.clubCode))) continue;
        out.push({
          memberno: it.memberno, name: it.name || "", clubCode: it.clubCode, clubName: it.clubName || "",
          brand: it.brand, tempFlag: !!it.tempFlag, appliedAt: it.appliedAt || null,
        });
      }
      ek = r.LastEvaluatedKey;
    } while (ek);
    out.sort((a, b) => String(a.clubName).localeCompare(String(b.clubName)) || String(a.memberno).localeCompare(String(b.memberno)));
    return NextResponse.json({ month, count: out.length, members: out, updatedAt: meta.updatedAt });
  }

  // ── 分析サマリー ──
  // 管理者は集計済み monthTotals を使える。店舗ユーザーはスコープ集計のため Scan(現行runのみ)。
  if (isAdmin) {
    const months = Object.entries(meta.monthTotals || {}).map(([m, c]) => ({ month: m, count: Number(c) })).sort((a, b) => a.month.localeCompare(b.month));
    // ブランド別/店舗別は Scan で(小規模)
    const { byBrand, byClub } = await aggregate(runId, user);
    return NextResponse.json({ ready: true, isAdmin, months, byBrand, byClub, updatedAt: meta.updatedAt });
  }
  const { months, byBrand, byClub } = await aggregate(runId, user, true);
  return NextResponse.json({ ready: true, isAdmin, months, byBrand, byClub, updatedAt: meta.updatedAt });
}

// 現行runのロスターを Scan して ブランド別/店舗別(/月別) を集計(スコープ適用)
async function aggregate(runId: string, user: any, withMonths = false) {
  const byBrand: Record<string, number> = {};
  const byClubMap = new Map<string, { clubCode: string; clubName: string; count: number }>();
  const byMonth: Record<string, number> = {};
  let ek: any;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "recessMonth <> :meta AND runId = :r",
      ExpressionAttributeValues: { ":meta": "__META__", ":r": runId },
      ProjectionExpression: "recessMonth, clubCode, clubName, brand",
      ExclusiveStartKey: ek,
    }));
    for (const it of r.Items || []) {
      if (!inScope(user, String(it.clubCode))) continue;
      byBrand[it.brand] = (byBrand[it.brand] || 0) + 1;
      byMonth[String(it.recessMonth)] = (byMonth[String(it.recessMonth)] || 0) + 1;
      const k = String(it.clubCode);
      const e = byClubMap.get(k) || { clubCode: k, clubName: String(it.clubName || k), count: 0 };
      e.count++; byClubMap.set(k, e);
    }
    ek = r.LastEvaluatedKey;
  } while (ek);
  const byClub = [...byClubMap.values()].sort((a, b) => b.count - a.count).slice(0, 30);
  const months = Object.entries(byMonth).map(([m, c]) => ({ month: m, count: c })).sort((a, b) => a.month.localeCompare(b.month));
  return { byBrand, byClub, months };
}
