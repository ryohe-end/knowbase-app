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
import { writeAudit, clientIp } from "@/lib/auditLog";
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
    // 会員別の休会一覧(PII: 氏名/会員番号)閲覧を監査記録
    void writeAudit({
      userId: user.email, userName: user.name, action: "recess.month.view",
      clubCodes: isAdmin ? [] : user.clubCodes, targetCount: out.length, detail: { month }, ip: clientIp(req),
    });
    return NextResponse.json({ month, count: out.length, members: out, updatedAt: meta.updatedAt });
  }

  // ── 分析サマリー(月別・ブランド別・店舗別 + 前月比・新規/継続/復帰・季節性) ──
  const cacheKey = `${runId}|${isAdmin ? "ALL" : user.clubCodes.join(",")}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SUMMARY_TTL) return NextResponse.json({ ...cached.data, updatedAt: meta.updatedAt });
  const data = await aggregate(runId, user);
  summaryCache.set(cacheKey, { at: Date.now(), data });
  return NextResponse.json({ ready: true, isAdmin, ...data, updatedAt: meta.updatedAt });
}

const SUMMARY_TTL = 10 * 60 * 1000;
const summaryCache = new Map<string, { at: number; data: any }>();

// 現行runのロスターを Scan → 月別/ブランド別/店舗別 + 会員の月次遷移(新規/継続/復帰) + 季節性
async function aggregate(runId: string, user: any) {
  const byBrand: Record<string, number> = {};
  const byClubMap = new Map<string, { clubCode: string; clubName: string; count: number }>();
  const byMonth: Record<string, number> = {};
  const monthMembers = new Map<string, Set<string>>(); // month → member集合(新規/復帰算出用)
  let ek: any;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "recessMonth <> :meta AND runId = :r",
      ExpressionAttributeValues: { ":meta": "__META__", ":r": runId },
      ProjectionExpression: "recessMonth, clubCode, clubName, brand, memberno",
      ExclusiveStartKey: ek,
    }));
    for (const it of r.Items || []) {
      if (!inScope(user, String(it.clubCode))) continue;
      const m = String(it.recessMonth);
      byBrand[it.brand] = (byBrand[it.brand] || 0) + 1;
      byMonth[m] = (byMonth[m] || 0) + 1;
      const k = String(it.clubCode);
      const e = byClubMap.get(k) || { clubCode: k, clubName: String(it.clubName || k), count: 0 };
      e.count++; byClubMap.set(k, e);
      (monthMembers.get(m) || monthMembers.set(m, new Set()).get(m)!).add(String(it.memberno));
    }
    ek = r.LastEvaluatedKey;
  } while (ek);

  const byClub = [...byClubMap.values()].sort((a, b) => b.count - a.count).slice(0, 30);
  const sortedMonths = Object.keys(byMonth).sort();
  // 月別 + 前月比
  const months = sortedMonths.map((m, i) => {
    const prev = i > 0 ? byMonth[sortedMonths[i - 1]] : null;
    return { month: m, count: byMonth[m], mom: prev != null ? byMonth[m] - prev : null, momPct: prev ? Math.round(((byMonth[m] - prev) / prev) * 1000) / 10 : null };
  });
  // 暦月の前月/翌月(YYYYMM)
  const nextYm = (ym: string) => { let y = +ym.slice(0, 4), mo = +ym.slice(4); mo++; if (mo > 12) { y++; mo = 1; } return `${y}${String(mo).padStart(2, "0")}`; };
  const prevYm = (ym: string) => { let y = +ym.slice(0, 4), mo = +ym.slice(4); mo--; if (mo < 1) { y--; mo = 12; } return `${y}${String(mo).padStart(2, "0")}`; };
  // 新規=前月非休会→当月休会 / 継続=前月から継続 / 復帰=当月休会→翌月に外れた人数
  // (暦月キーで直接参照。翌月データが無い=最新月は復帰を算出不能なので null)
  const flow = sortedMonths.map((m) => {
    const cur = monthMembers.get(m) || new Set<string>();
    const prev = monthMembers.get(prevYm(m)) || new Set<string>();
    const nm = nextYm(m);
    const next = monthMembers.get(nm);
    let neu = 0, cont = 0;
    for (const mn of cur) (prev.has(mn) ? cont++ : neu++);
    let returned: number | null = null;
    if (next) { returned = 0; for (const mn of cur) if (!next.has(mn)) returned++; }
    return { month: m, new: neu, continued: cont, returned };
  });
  // 季節性(暦月1-12の平均)
  const seasonAgg: Record<string, { sum: number; n: number }> = {};
  for (const m of sortedMonths) { const mm = m.slice(4); (seasonAgg[mm] ||= { sum: 0, n: 0 }); seasonAgg[mm].sum += byMonth[m]; seasonAgg[mm].n++; }
  const seasonality = Array.from({ length: 12 }, (_, i) => { const mm = String(i + 1).padStart(2, "0"); const a = seasonAgg[mm]; return { month: mm, avg: a ? Math.round(a.sum / a.n) : 0 }; });

  return { byBrand, byClub, months, flow, seasonality };
}
