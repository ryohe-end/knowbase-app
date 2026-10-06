// app/api/bi/distribution/route.ts  — BI D7: 会員分布(都道府県)
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sfQuery } from "@/lib/snowflake";
import { parseFilters, buildWhere, clubOptions, N } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const V = 'MART."V_会員分布_都道府県"';
const COLS = new Set(["ブランド", "業態", "エリア", "会員種別", "年月"]); // ビューは業態/ブランド/エリア + 属性

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const f = parseFilters(req.url);
  const kubun = new URL(req.url).searchParams.get("kubun") || "安定"; // 入会/退会/安定
  try {
    // 対象最新月(区分=kubun)
    const base = buildWhere(f, COLS, "年月");
    const kClause = base.clause ? `${base.clause} AND "区分" = ?` : `WHERE "区分" = ?`;
    const mx: any[] = await sfQuery(`SELECT MAX("年月") mx FROM ${V} ${kClause}`, [...base.binds, kubun]);
    const latestYm = mx[0]?.MX ? String(mx[0].MX) : null;
    let byPref: any[] = [], byGender: any[] = [], byAge: any[] = [];
    if (latestYm) {
      const w = buildWhere({ ...f, from: latestYm, to: latestYm }, COLS, "年月");
      const clause = `${w.clause ? w.clause + " AND" : "WHERE"} "区分" = ?`;
      const binds = [...w.binds, kubun];
      const g = async (dim: string) =>
        (await sfQuery(`SELECT ${dim} k, SUM("会員数") v FROM ${V} ${clause} GROUP BY 1 ORDER BY 2 DESC`, binds))
          .map((r: any) => ({ key: r.K == null ? "不明" : String(r.K), value: N(r.V) }));
      byPref = await g('"都道府県"');
      byGender = await g('"性別"');
      byAge = await g('"年代"');
    }
    const meta = {
      source: 'MART."V_会員分布_都道府県"（DM_会員属性プロットを都道府県粒度に集計）',
      conditions: [
        `区分=${kubun}（安定/入会/退会）の最新月の会員数=COUNT`,
        "会員の地域は都道府県のみ（緯度経度・市区町村は個人情報配慮で非保持）",
        "都道府県が取れない会員は「不明」として計上",
        `WHERE句: ${base.clause ? base.clause + " AND " : "WHERE "}"区分"='${kubun}'`,
      ],
      sql: [`SELECT "都道府県", SUM("会員数")\nFROM MART."V_会員分布_都道府県"\nWHERE "区分"='${kubun}' AND "年月"=<最新月> ${base.clause ? "AND ..." : ""}\nGROUP BY 1 ORDER BY 2 DESC`],
    };
    return NextResponse.json({ options: await clubOptions(), kubun, latestYm, byPref, byGender, byAge, meta });
  } catch (e: any) {
    console.error("[bi/distribution]", e?.message || e);
    return NextResponse.json({ error: "query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
