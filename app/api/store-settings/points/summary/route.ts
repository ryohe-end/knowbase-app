// app/api/store-settings/points/summary/route.ts
//
// ポイント・ダッシュボード読み取り API。夜間集計(yamauchi-PointSummary)から
// 選択月の指標 + 前月比/昨年比 + 直近12ヶ月の月次サマリーを返す。
//   GET ?clubCode=511&month=2026-07
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { getClubBusinessType, cpssBrandForBusinessType } from "@/lib/clubScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const SUMMARY_TABLE = process.env.SUMMARY_TABLE || "yamauchi-PointSummary";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function thisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) {
    return NextResponse.json({ ok: false, error: "この店舗は担当外です" }, { status: 403 });
  }
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") || "") ? (sp.get("month") as string) : thisMonth();
  const brand = cpssBrandForBusinessType(await getClubBusinessType(clubCode));

  const from = addMonths(month, -13);
  let items: any[] = [];
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: SUMMARY_TABLE,
      KeyConditionExpression: "clubCode = :c AND yyyymm BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":c": clubCode, ":from": from, ":to": month },
    }));
    items = res.Items || [];
  } catch (e: any) {
    console.error("[points/summary] query error", e?.message);
    return NextResponse.json({ ok: false, error: "集計データの取得に失敗しました" }, { status: 500 });
  }

  const byYm = new Map<string, any>(items.map((it) => [it.yyyymm, it]));
  const cur = byYm.get(month) || null;
  const prev = byYm.get(addMonths(month, -1)) || null;
  const prevYear = byYm.get(addMonths(month, -12)) || null;

  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const ym = addMonths(month, -i);
    const it = byYm.get(ym);
    monthly.push({ ym, granted: it?.granted ?? 0, used: it?.used ?? 0, memberCount: it?.memberCount ?? 0 });
  }

  const pct = (curV: number, baseV: number): number | null =>
    baseV > 0 ? Math.round(((curV - baseV) / baseV) * 1000) / 10 : null;

  return NextResponse.json({
    ok: true,
    clubCode,
    brand,
    month,
    available: !!cur,
    updatedAt: cur?.updatedAt ?? null,
    current: cur ? {
      granted: cur.granted ?? 0,
      used: cur.used ?? 0,
      grantedCount: cur.grantedCount ?? 0,
      usedCount: cur.usedCount ?? 0,
      memberCount: cur.memberCount ?? 0,
      byGender: cur.byGender ?? {},
      byAge: cur.byAge ?? {},
      byRank: cur.byRank ?? {},
      avgTenureMonths: cur.avgTenureMonths ?? null,
      avgEarnToUseDays: cur.avgEarnToUseDays ?? null,
      earnToUseSamples: cur.earnToUseSamples ?? 0,
    } : null,
    compare: {
      prevMonth: prev ? { granted: prev.granted ?? 0, used: prev.used ?? 0 } : null,
      prevYear: prevYear ? { granted: prevYear.granted ?? 0, used: prevYear.used ?? 0 } : null,
      grantedMoM: cur && prev ? pct(cur.granted ?? 0, prev.granted ?? 0) : null,
      usedMoM: cur && prev ? pct(cur.used ?? 0, prev.used ?? 0) : null,
      grantedYoY: cur && prevYear ? pct(cur.granted ?? 0, prevYear.granted ?? 0) : null,
      usedYoY: cur && prevYear ? pct(cur.used ?? 0, prevYear.used ?? 0) : null,
    },
    monthly,
  });
}
