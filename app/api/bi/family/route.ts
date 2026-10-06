// app/api/bi/family/route.ts  — BI D3: 家族会員
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sfQuery } from "@/lib/snowflake";
import { parseFilters, buildWhere, clubOptions, N } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGG = 'MART."DM_家族会員数_集計"';
const COLS = new Set(["ブランド", "業態", "エリア", "クラブコード", "営業月度"]); // 家族DMはカンパニー/企業を持たない(R-03)

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const f = parseFilters(req.url);
  try {
    const w = buildWhere(f, COLS, "営業月度");
    const tr: any[] = await sfQuery(
      `SELECT TO_VARCHAR("営業月度") ym, SUM("課金会員数") pay, SUM("家族会員数") fam
       FROM ${AGG} ${w.clause} GROUP BY 1 ORDER BY 1`, w.binds);
    const trend = tr.map((r) => { const pay = N(r.PAY), fam = N(r.FAM); return { ym: String(r.YM), 課金会員数: pay, 家族会員数: fam, 付帯率: pay ? fam / pay : null }; });
    const latest = trend[trend.length - 1] || null;
    // クラブ別 付帯率(最新月)
    let clubs: any[] = [];
    if (latest) {
      const wc = buildWhere({ ...f, from: latest.ym, to: latest.ym }, COLS, "営業月度");
      const rows: any[] = await sfQuery(
        `SELECT "クラブコード" code,"クラブ略称" name, SUM("課金会員数") pay, SUM("家族会員数") fam
         FROM ${AGG} ${wc.clause} GROUP BY 1,2`, wc.binds);
      clubs = rows.map((r) => { const pay = N(r.PAY), fam = N(r.FAM); return { code: N(r.CODE), name: String(r.NAME), 課金会員数: pay, 家族会員数: fam, 付帯率: pay ? fam / pay : null }; })
        .filter((c) => c.課金会員数 > 0).sort((a, b) => (b.付帯率 || 0) - (a.付帯率 || 0));
    }
    const meta = {
      source: 'MART."DM_家族会員数_集計"',
      conditions: [
        "課金会員数(親)=SUM(課金会員数)、家族会員数=SUM(家族会員数)",
        "付帯率 = SUM(家族会員数)/SUM(課金会員数)（合算して算出）",
        "家族関係は履歴を持たず現行値を過去月にも適用（過去推移は現在に引きずられる）",
        `WHERE句: ${w.clause || "（フィルタなし）"}（家族DMはブランド/エリア/クラブのみ絞込可）`,
      ],
      sql: [`SELECT TO_VARCHAR("営業月度"), SUM("課金会員数"), SUM("家族会員数")\nFROM MART."DM_家族会員数_集計" ${w.clause}\nGROUP BY 1 ORDER BY 1`],
    };
    return NextResponse.json({ options: await clubOptions(), latest, trend, clubs, meta });
  } catch (e: any) {
    console.error("[bi/family]", e?.message || e);
    return NextResponse.json({ error: "query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
