// app/api/bi/club-comparison/route.ts  — BI D2: 勝ち負け店舗比較
//   月セレクタ(既定=直近の完了月) / 全社KPIに前年同月併記 / トレンドは月・年度(FY)トグル /
//   客単価=売上額/月初(課金会員のみ)。年度(FY)=4月開始: month>=4→year, else year-1。
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sfQuery } from "@/lib/snowflake";
import { parseFilters, buildWhere, clubOptions, N } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGG = 'MART."DM_勝ち負け表_売上_集計"';
const COLS = new Set(["ブランド", "業態", "エリア", "カンパニー", "企業", "クラブコード", "会員種別", "営業年月"]);
// 課金会員のみの月初(客単価の分母)
const MSPAY = `SUM(IFF("会員種別"='課金会員',"月初在籍数",0))`;
const MEAS = `SUM("月初在籍数") ms, SUM("月末在籍数") me, SUM("入会数") jn, SUM("退会数") qt, SUM("来館者数") vs, SUM("売上額") sales, ${MSPAY} msp`;
const FY = `CASE WHEN MOD("営業年月",100)>=4 THEN FLOOR("営業年月"/100) ELSE FLOOR("営業年月"/100)-1 END`;

const shape = (r: any) => {
  const ms = N(r.MS), me = N(r.ME), jn = N(r.JN), qt = N(r.QT), vs = N(r.VS), sales = N(r.SALES), msp = N(r.MSP);
  return { 月初: ms, 月末: me, 入会: jn, 退会: qt, 来館: vs, 売上額: sales,
    純増減: me - ms, 解約率: ms ? qt / ms : null, 来館率: me ? vs / me : null, 客単価: msp ? sales / msp : null };
};

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const f = parseFilters(req.url);
  const sp = new URL(req.url).searchParams;
  const gran = sp.get("gran") === "fy" ? "fy" : "month";
  const wantMonth = sp.get("month") || undefined;
  try {
    const w = buildWhere(f, COLS, "営業年月"); // 期間from/toも効く
    // 選べる月一覧
    const monthsRows: any[] = await sfQuery(`SELECT DISTINCT "営業年月" ym FROM ${AGG} ${w.clause} ORDER BY 1 DESC`, w.binds);
    const months = monthsRows.map((r) => String(r.YM));
    // 対象月: 指定 > 直近の完了月(当月除外) > 最新
    const curYm = Number(new Date().toISOString().slice(0, 7).replace("-", ""));
    const selectedMonth = (wantMonth && months.includes(wantMonth)) ? wantMonth
      : (months.find((m) => Number(m) < curYm) || months[0] || null);

    // 全社KPI(選択月 + 前年同月)
    const oneMonth = async (ym: string) => {
      const wm = buildWhere({ ...f, from: ym, to: ym }, COLS, "営業年月");
      const r: any[] = await sfQuery(`SELECT ${MEAS} FROM ${AGG} ${wm.clause}`, wm.binds);
      return shape(r[0] || {});
    };
    let summary = null, prevYear = null, clubs: any[] = [];
    if (selectedMonth) {
      const pym = String(Number(selectedMonth) - 100);
      summary = await oneMonth(selectedMonth);
      prevYear = months.includes(pym) ? await oneMonth(pym) : null;
      // クラブ別(選択月) + 前年同月をJSでjoin
      const wc = buildWhere({ ...f, from: selectedMonth, to: selectedMonth }, COLS, "営業年月");
      const cur: any[] = await sfQuery(`SELECT "クラブコード" code,"クラブ略称" name, ${MEAS} FROM ${AGG} ${wc.clause} GROUP BY 1,2`, wc.binds);
      const wp = buildWhere({ ...f, from: pym, to: pym }, COLS, "営業年月");
      const prev: any[] = months.includes(pym) ? await sfQuery(`SELECT "クラブコード" code, ${MEAS} FROM ${AGG} ${wp.clause} GROUP BY 1`, wp.binds) : [];
      const prevBy: Record<string, any> = {}; prev.forEach((r) => (prevBy[String(r.CODE)] = shape(r)));
      clubs = cur.map((r) => { const s = shape(r); const p = prevBy[String(r.CODE)] || null;
        return { code: N(r.CODE), name: String(r.NAME), ...s,
          前年: p ? { 月初: p.月初, 月末: p.月末, 入会: p.入会, 退会: p.退会, 純増減: p.純増減 } : null }; })
        .sort((a, b) => b.純増減 - a.純増減);
    }

    // トレンド(月 or 年度FY)
    let trend: any[] = [];
    if (gran === "fy") {
      const rows: any[] = await sfQuery(
        `WITH m AS (SELECT "営業年月" ym, ${FY} fy, ${MEAS} FROM ${AGG} ${w.clause} GROUP BY 1,2)
         SELECT fy, MIN_BY(ms,ym) ms, MAX_BY(me,ym) me, SUM(jn) jn, SUM(qt) qt, SUM(sales) sales, MAX_BY(msp,ym) msp
         FROM m GROUP BY fy ORDER BY fy`, w.binds);
      trend = rows.map((r) => ({ label: `${N(r.FY)}年度`, 入会数: N(r.JN), 退会数: N(r.QT), 月末在籍数: N(r.ME),
        純増減: N(r.ME) - N(r.MS), 売上額: N(r.SALES) }));
    } else {
      const rows: any[] = await sfQuery(`SELECT "営業年月" ym, ${MEAS} FROM ${AGG} ${w.clause} GROUP BY 1 ORDER BY 1`, w.binds);
      trend = rows.map((r) => { const s = shape(r); return { label: String(r.YM), 入会数: s.入会, 退会数: s.退会, 月末在籍数: s.月末, 純増減: s.純増減 }; });
    }

    const meta = {
      source: 'MART."DM_勝ち負け表_売上_集計"（安定会員基準）',
      conditions: [
        "会員数は SUM(月初在籍数/月末在籍数) で算出（明細フラグの合計）",
        "客単価 = SUM(売上額) / SUM(月初在籍数 WHERE 会員種別='課金会員')（家族会員は分母から除外）",
        "解約率 = SUM(退会数)/SUM(月初在籍数)、来館率 = SUM(来館者数)/SUM(月末在籍数)（近似）",
        "対象月は既定=直近の完了月（当月は途中集計のため除外）／年度(FY)=4月開始・入退会は年計・在籍は年度末",
        `WHERE句: ${w.clause || "（フィルタなし）"}（? は適用フィルタ値）`,
      ],
      sql: [`SELECT "クラブコード","クラブ略称", SUM("月初在籍数") ms, SUM("月末在籍数") me, SUM("入会数") jn, SUM("退会数") qt, SUM("来館者数") vs, SUM("売上額") sales, ${MSPAY} msp\nFROM ${AGG} ${selectedMonth ? `WHERE "営業年月"=${selectedMonth}${w.clause ? " AND " + w.clause.replace(/^WHERE /, "") : ""}` : w.clause}\nGROUP BY 1,2`],
    };
    return NextResponse.json({ options: await clubOptions(), months, selectedMonth, summary, prevYear, clubs, gran, trend, meta });
  } catch (e: any) {
    console.error("[bi/club-comparison]", e?.message || e);
    return NextResponse.json({ error: "query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
