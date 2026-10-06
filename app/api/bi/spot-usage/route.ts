// app/api/bi/spot-usage/route.ts  — BI D5: 都度利用(OneTimePass/1DAY/オプション都度)
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sfQuery } from "@/lib/snowflake";
import { parseFilters, buildWhere, clubOptions, N } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const V = 'MART."V_都度利用_統合"';
const COLS = new Set(["ブランド", "業態", "エリア", "カンパニー", "企業", "クラブコード", "購入年月"]);

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const f = parseFilters(req.url);
  try {
    const w = buildWhere(f, COLS, "購入年月");
    // 商品区分別サマリ
    const byProd: any[] = await sfQuery(
      `SELECT "商品区分" p, SUM("販売数") sales, SUM("利用数") used, SUM("売上金額") amt
       FROM ${V} ${w.clause} GROUP BY 1 ORDER BY 3 DESC`, w.binds);
    // 月次(商品区分別の売上金額・販売数)
    const tr: any[] = await sfQuery(
      `SELECT "購入年月" ym, "商品区分" p, SUM("販売数") sales, SUM("売上金額") amt
       FROM ${V} ${w.clause} GROUP BY 1,2 ORDER BY 1`, w.binds);
    // 月次をym行×商品区分列にピボット(売上金額)
    const months = Array.from(new Set(tr.map((r) => String(r.YM)))).sort();
    const prods = ["OneTimePass", "1DAYパス", "オプション都度"];
    const trend = months.map((ym) => {
      const row: any = { ym };
      prods.forEach((p) => { row[p] = N(tr.find((r) => String(r.YM) === ym && r.P === p)?.AMT); });
      return row;
    });
    const meta = {
      source: 'MART."V_都度利用_統合"（OneTimePass/1DAY/オプション都度をUNION）',
      conditions: [
        "販売数=SUM(販売数)、利用率=SUM(利用数)/SUM(販売数)、売上=SUM(売上金額)",
        "OneTimePassは2024-08以降のみ（それ以前を選ぶと0）",
        "金額列の差(OTP=金額/1DAY・オプション=販売金額)はビュー側で売上金額に統一",
        `WHERE句: ${w.clause || "（フィルタなし）"}`,
      ],
      sql: [`SELECT "商品区分", SUM("販売数"), SUM("利用数"), SUM("売上金額")\nFROM MART."V_都度利用_統合" ${w.clause} GROUP BY 1`],
    };
    return NextResponse.json({
      options: await clubOptions(),
      products: byProd.map((r) => { const s = N(r.SALES), u = N(r.USED); return { 商品区分: r.P, 販売数: s, 利用数: u, 売上金額: N(r.AMT), 利用率: s ? u / s : null }; }),
      trend, meta,
    });
  } catch (e: any) {
    console.error("[bi/spot-usage]", e?.message || e);
    return NextResponse.json({ error: "query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
