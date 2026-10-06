// app/api/bi/executive/route.ts — 経営者ダッシュボード(全社サマリ・課金会員のみ)
//   会員数/会員売上/入退会/純増減は家族会員を除く(課金会員のみ)。純増減=入会-退会。都度売上も。
//   既定=直近の完了月＋前年同月。
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sfQuery } from "@/lib/snowflake";
import { parseFilters, buildWhere, clubOptions, N } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGG = 'MART."DM_勝ち負け表_売上_集計"';
const COLS = new Set(["ブランド", "業態", "エリア", "カンパニー", "企業", "クラブコード", "営業年月"]);
const MEAS = `SUM("月初在籍数") ms, SUM("月末在籍数") me, SUM("入会数") jn, SUM("退会数") qt, SUM("来館者数") vs, SUM("売上額") sales`;
const SPOT = 'MART."V_都度利用_統合"';
const SPOT_COLS = new Set(["ブランド", "業態", "エリア", "カンパニー", "企業", "クラブコード", "購入年月"]);

const shape = (r: any) => {
  const ms = N(r.MS), me = N(r.ME), jn = N(r.JN), qt = N(r.QT), vs = N(r.VS), sales = N(r.SALES);
  return { 月初: ms, 月末: me, 入会: jn, 退会: qt, 来館: vs, 会員売上: sales,
    純増減: jn - qt, 解約率: ms ? qt / ms : null, 来館率: me ? vs / me : null, 客単価: ms ? sales / ms : null };
};
// 家族会員を除く(課金会員のみ)を強制。memberTypeフィルタは無視。
function payClause(f: any) {
  const fp = { ...f, memberType: undefined };
  const w = buildWhere(fp, COLS, "営業年月");
  return { clause: w.clause ? `${w.clause} AND "会員種別"='課金会員'` : `WHERE "会員種別"='課金会員'`, binds: w.binds };
}
function payClauseYm(f: any, ym: string) {
  const fp = { ...f, memberType: undefined, from: ym, to: ym };
  const w = buildWhere(fp, COLS, "営業年月");
  return { clause: w.clause ? `${w.clause} AND "会員種別"='課金会員'` : `WHERE "会員種別"='課金会員'`, binds: w.binds };
}

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const f = parseFilters(req.url);
  try {
    const w = payClause(f);
    const trRows: any[] = await sfQuery(`SELECT "営業年月" ym, ${MEAS} FROM ${AGG} ${w.clause} GROUP BY 1 ORDER BY 1`, w.binds);
    const trend = trRows.map((r) => { const s = shape(r); return { ym: String(r.YM), 月末在籍数: s.月末, 純増減: s.純増減, 入会数: s.入会, 退会数: s.退会, 会員売上: s.会員売上, 客単価: s.客単価 }; });
    const curYm = Number(new Date().toISOString().slice(0, 7).replace("-", ""));
    const completed = trend.filter((t) => Number(t.ym) < curYm);
    const latestYm = (completed[completed.length - 1] || trend[trend.length - 1])?.ym || null;

    const oneMonth = async (ym: string) => { const w2 = payClauseYm(f, ym); return shape((await sfQuery(`SELECT ${MEAS} FROM ${AGG} ${w2.clause}`, w2.binds))[0] || {}); };
    let summary: any = null, prevYear = null, spotSales = 0;
    if (latestYm) {
      summary = await oneMonth(latestYm);
      const pym = String(Number(latestYm) - 100);
      prevYear = trend.some((t) => t.ym === pym) ? await oneMonth(pym) : null;
      const ws = buildWhere({ ...f, from: latestYm, to: latestYm }, SPOT_COLS, "購入年月");
      spotSales = N((await sfQuery(`SELECT SUM("売上金額") amt FROM ${SPOT} ${ws.clause}`, ws.binds))[0]?.AMT);
      // LTV: 平均継続月数=1/月次解約率、LTV=月間客単価/月次解約率(=客単価×平均継続月数)
      summary.平均継続月数 = summary.解約率 ? 1 / summary.解約率 : null;
      summary.LTV = (summary.客単価 && summary.解約率) ? summary.客単価 / summary.解約率 : null;
    }

    // コホート(入会月別 継続率)。DM_継続率(クラブ×入会年月×経過月数)を全社集計。期間スライダーは非適用。
    const RET = 'MART."DM_継続率"';
    const RET_COLS = new Set(["業態", "エリア", "クラブコード"]);
    const wr = buildWhere({ ...f, from: undefined, to: undefined, memberType: undefined }, RET_COLS);
    const cohRows: any[] = await sfQuery(
      `SELECT TO_VARCHAR("入会年月") coh, "経過月数" m, SUM("入会者数") base, SUM("継続者数") kept
       FROM ${RET} ${wr.clause} GROUP BY 1,2`, wr.binds);
    const cohMap: Record<string, Record<number, { base: number; kept: number }>> = {};
    let maxM = 0;
    for (const r of cohRows) { const c = String(r.COH), m = N(r.M); (cohMap[c] ||= {})[m] = { base: N(r.BASE), kept: N(r.KEPT) }; if (m > maxM) maxM = m; }
    const cohortKeys = Object.keys(cohMap).sort().slice(-13); // 直近13コホート
    const months = Array.from({ length: Math.min(maxM, 12) + 1 }, (_, i) => i);
    const cohort = cohortKeys.map((c) => ({
      cohort: c,
      base: cohMap[c][0]?.base || 0,
      rates: months.map((m) => { const cell = cohMap[c][m]; return cell && cell.base ? cell.kept / cell.base : null; }),
    }));
    const meta = {
      source: '会員=MART."DM_勝ち負け表_売上_集計"（課金会員のみ・家族除く）/ 都度売上=MART."V_都度利用_統合"',
      conditions: [
        "★家族会員を除外（会員種別='課金会員' のみ）。月初/月末会員数・入会・退会・会員売上すべて課金会員ベース",
        "純増減 = 入会数 − 退会数",
        "会員売上=SUM(売上額)（有効請求の口座振替）、客単価=会員売上/月初(課金会員)",
        "LTV = 月間客単価 / 月次解約率（=客単価×平均継続月数）。平均継続月数=1/解約率",
        "コホート=入会月別の継続率（DM_継続率、経過0〜12ヶ月）。全社集計・期間スライダー非適用",
        "都度売上=OneTimePass/1DAY/オプション都度の売上金額合計。対象=直近の完了月、前年=前年同月",
        `WHERE句: ${w.clause}`,
      ],
      sql: [`SELECT "営業年月", ${MEAS} FROM ${AGG} ${w.clause} GROUP BY 1 ORDER BY 1`],
    };
    return NextResponse.json({ options: await clubOptions(), latestYm, summary, prevYear, spotSales, trend, cohort, cohortMonths: months, meta });
  } catch (e: any) {
    console.error("[bi/executive]", e?.message || e);
    return NextResponse.json({ error: "query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
