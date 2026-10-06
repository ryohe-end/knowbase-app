// app/api/bi/traffic/route.ts  — BI D4: 来館・混雑(曜日×時間帯ヒートマップ)
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sfQuery } from "@/lib/snowflake";
import { parseFilters, buildWhere, clubOptions, N } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGG = 'MART."DM_時間別来館_集計_軽量"';
const COLS = new Set(["ブランド", "業態", "エリア", "クラブコード", "営業年月"]); // 軽量DMは業態/ブランド/エリアのみ

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const f = parseFilters(req.url);
  try {
    const w = buildWhere(f, COLS, "営業年月");
    // 曜日×時間帯 の来館数(期間合算)
    const cells: any[] = await sfQuery(
      `SELECT "曜日" dow, "時間帯" hour, SUM("来館数") v
       FROM ${AGG} ${w.clause} GROUP BY 1,2 ORDER BY 1,2`, w.binds);
    // 月次来館数
    const tr: any[] = await sfQuery(
      `SELECT TO_VARCHAR("営業年月") ym, SUM("来館数") v, SUM("来館人数") p
       FROM ${AGG} ${w.clause} GROUP BY 1 ORDER BY 1`, w.binds);
    const meta = {
      source: 'MART."DM_時間別来館_集計_軽量"（年代・性別なしの軽量版）',
      conditions: [
        "ヒートマップ=曜日×時間帯 の SUM(来館数)（選択期間の合算。複数月選択で積み上がる）",
        "来館人数はクラブ横断で重複排除されるためクラブ別合計と全社計は一致しない",
        `WHERE句: ${w.clause || "（フィルタなし）"}（軽量DMはブランド/エリア/クラブのみ絞込可）`,
      ],
      sql: [`SELECT "曜日","時間帯", SUM("来館数") FROM MART."DM_時間別来館_集計_軽量" ${w.clause} GROUP BY 1,2`],
    };
    return NextResponse.json({
      options: await clubOptions(),
      heatmap: cells.map((r) => ({ dow: r.DOW == null ? "" : String(r.DOW), hour: N(r.HOUR), value: N(r.V) })),
      trend: tr.map((r) => ({ ym: String(r.YM), 来館数: N(r.V), 来館人数: N(r.P) })),
      meta,
    });
  } catch (e: any) {
    console.error("[bi/traffic]", e?.message || e);
    return NextResponse.json({ error: "query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
