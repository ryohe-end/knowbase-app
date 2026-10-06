// app/api/bi/sales-budget/route.ts  — BI D6: 売上・予実
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sfQuery } from "@/lib/snowflake";
import { parseFilters, buildWhere, clubOptions, N } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SALES = 'MART."DM_売上実績_集計"';
const SALES_COLS = new Set(["ブランド", "業態", "エリア", "クラブコード", "請求月"]); // 売上実績は業態/ブランド/エリアのみ
const BUDGET = 'MART."DM_クラブ予実"';

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const f = parseFilters(req.url);
  try {
    // 売上実績(月次)
    const ws = buildWhere(f, SALES_COLS, "請求月");
    const sales: any[] = await sfQuery(
      `SELECT TO_VARCHAR("請求月") ym, SUM("売上金額") amt, SUM("入金金額") paid, SUM("未納金額") unpaid
       FROM ${SALES} ${ws.clause} GROUP BY 1 ORDER BY 1`, ws.binds);
    // 予実(勘定科目=売上高, 月次)。属性が無いのでDM_クラブマスタ結合でブランド/エリア/カンパニー絞りを効かせる(R-14)
    const bConds = ['b."勘定科目" = ?']; const bBinds: (string | number)[] = ["売上高"];
    if (f.brand) { bConds.push('cm."ブランド" = ?'); bBinds.push(f.brand); }
    if (f.gyotai) { bConds.push('cm."業態" = ?'); bBinds.push(f.gyotai); }
    if (f.area) { bConds.push('cm."エリア" = ?'); bBinds.push(f.area); }
    if (f.company) { bConds.push('cm."カンパニー" = ?'); bBinds.push(f.company); }
    if (f.gyosha) { bConds.push('cm."企業" = ?'); bBinds.push(f.gyosha); }
    if (f.club) { const codes = f.club.split(",").filter((s) => /^\d+$/.test(s)); if (codes.length) { bConds.push(`b."クラブコード" IN (${codes.map(() => "?").join(",")})`); codes.forEach((c) => bBinds.push(Number(c))); } }
    if (f.from && /^\d{6}$/.test(f.from)) { bConds.push('TO_VARCHAR(b."営業年月") >= ?'); bBinds.push(f.from); }
    if (f.to && /^\d{6}$/.test(f.to)) { bConds.push('TO_VARCHAR(b."営業年月") <= ?'); bBinds.push(f.to); }
    const budget: any[] = await sfQuery(
      `SELECT TO_VARCHAR(b."営業年月") ym, SUM(b."計画") plan, SUM(b."実績") act
       FROM ${BUDGET} b JOIN MART."DM_クラブマスタ" cm ON cm."クラブコード" = b."クラブコード"
       WHERE ${bConds.join(" AND ")} GROUP BY 1 ORDER BY 1`, bBinds);
    // ym で結合
    const months = Array.from(new Set([...sales.map((r) => String(r.YM)), ...budget.map((r) => String(r.YM))])).sort();
    const trend = months.map((ym) => {
      const s = sales.find((r) => String(r.YM) === ym), b = budget.find((r) => String(r.YM) === ym);
      const plan = N(b?.PLAN), act = N(b?.ACT);
      return { ym, 振替売上: N(s?.AMT), 入金: N(s?.PAID), 未納: N(s?.UNPAID),
        予算計画: plan, 会計実績: act, 達成率: plan ? act / plan : null,
        未納率: N(s?.AMT) ? N(s?.UNPAID) / N(s?.AMT) : null };
    });
    const latest = trend[trend.length - 1] || null;
    const meta = {
      source: '振替売上=MART."DM_売上実績_集計" / 予算・会計実績=MART."DM_クラブ予実"(勘定科目=売上高)',
      conditions: [
        "予算達成率 = SUM(実績)/SUM(計画)（予実DM内で完結。会計PL由来）",
        "「振替売上」(口座振替)と「会計実績」(会計PL)はソースが異なり一致しない=別系列",
        "未納率 = SUM(未納金額)/SUM(売上金額)（売上実績DM）",
        "予実はDM_クラブマスタ結合でブランド/エリア/カンパニー絞込を反映（勘定科目=売上高固定）",
        `売上実績WHERE句: ${ws.clause || "（なし）"}`,
      ],
      sql: [
        `SELECT TO_VARCHAR("請求月"), SUM("売上金額"), SUM("入金金額"), SUM("未納金額")\nFROM MART."DM_売上実績_集計" ${ws.clause} GROUP BY 1`,
        `SELECT TO_VARCHAR(b."営業年月"), SUM(b."計画"), SUM(b."実績")\nFROM MART."DM_クラブ予実" b JOIN MART."DM_クラブマスタ" cm ON cm."クラブコード"=b."クラブコード"\nWHERE ${bConds.join(" AND ")} GROUP BY 1`,
      ],
    };
    return NextResponse.json({ options: await clubOptions(), latest, trend, meta });
  } catch (e: any) {
    console.error("[bi/sales-budget]", e?.message || e);
    return NextResponse.json({ error: "query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
