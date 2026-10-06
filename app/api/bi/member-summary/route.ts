// app/api/bi/member-summary/route.ts
// BI D1: 会員数サマリー。MART."DM_勝ち負け表_集計"を集計。率はSUM(分子)/SUM(分母)。admin限定。
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sfQuery } from "@/lib/snowflake";
import { parseFilters, buildWhere, clubOptions, N } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGG = 'MART."DM_勝ち負け表_集計"';
const COLS = new Set(["ブランド", "業態", "エリア", "カンパニー", "企業", "クラブコード", "会員種別", "営業年月"]);

const TREND_SELECT = `
  "営業年月" AS ym,
  SUM("月初在籍数") AS m_start, SUM("月末在籍数") AS m_end,
  SUM("入会数") AS joins, SUM("退会数") AS quits,
  SUM("来館者数") AS visits, SUM("OP契約数") AS op, SUM("対象人数") AS people`;

function shapeRow(r: any) {
  const m_start = N(r.M_START), m_end = N(r.M_END), joins = N(r.JOINS), quits = N(r.QUITS), visits = N(r.VISITS);
  return {
    ym: String(r.YM),
    月初在籍数: m_start, 月末在籍数: m_end, 入会数: joins, 退会数: quits,
    来館者数: visits, OP契約数: N(r.OP), 対象人数: N(r.PEOPLE),
    純増減: m_end - m_start,
    解約率: m_start ? quits / m_start : null,
    入会率: m_start ? joins / m_start : null,
    来館率: m_end ? visits / m_end : null,
  };
}

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const f = parseFilters(req.url);
  const { clause, binds } = buildWhere(f, COLS, "営業年月");
  try {
    const trendRows = await sfQuery(`SELECT ${TREND_SELECT} FROM ${AGG} ${clause} GROUP BY 1 ORDER BY 1`, binds);
    const trend = trendRows.map(shapeRow);
    const latest = trend[trend.length - 1] || null;
    let prevYear = null;
    if (latest) { const pym = Number(latest.ym) - 100; prevYear = trend.find((t) => t.ym === String(pym)) || null; }

    let breakdown = { byMemberType: [] as any[], byAge: [] as any[], byGender: [] as any[] };
    if (latest) {
      const w2 = buildWhere({ ...f, from: latest.ym, to: latest.ym }, COLS, "営業年月");
      // 会員種別の構成は会員種別フィルタを外す(でないと1色になる)
      const w2NoMT = buildWhere({ ...f, memberType: undefined, from: latest.ym, to: latest.ym }, COLS, "営業年月");
      const bk = async (dim: string, ws: { clause: string; binds: (string | number)[] }) =>
        (await sfQuery(`SELECT ${dim} AS k, SUM("月末在籍数") AS v FROM ${AGG} ${ws.clause} GROUP BY 1 ORDER BY 2 DESC`, ws.binds))
          .map((r: any) => ({ key: r.K == null ? "不明" : String(r.K), value: N(r.V) }));
      breakdown = { byMemberType: await bk('"会員種別"', w2NoMT), byAge: await bk('"年代"', w2), byGender: await bk('"性別"', w2) };
    }

    const meta = {
      source: 'MART."DM_勝ち負け表_集計"（安定会員基準）',
      conditions: [
        "月初/月末安定会員数=SUM(月初在籍数/月末在籍数)、入会/退会=SUM(入会数/退会数)",
        "解約率=SUM(退会数)/SUM(月初在籍数)、入会率=SUM(入会数)/SUM(月初在籍数)、来館率=SUM(来館者数)/SUM(月末在籍数)（近似）",
        "会員種別の構成は会員種別フィルタ非連動（他は連動）",
        `WHERE句: ${clause || "（フィルタなし）"}`,
      ],
      sql: [`SELECT "営業年月", SUM("月初在籍数"), SUM("月末在籍数"), SUM("入会数"), SUM("退会数"), SUM("来館者数")\nFROM ${AGG} ${clause}\nGROUP BY 1 ORDER BY 1`],
    };
    return NextResponse.json({ options: await clubOptions(), latest, prevYear, trend, breakdown, meta });
  } catch (e: any) {
    console.error("[bi/member-summary]", e?.message || e);
    return NextResponse.json({ error: "Snowflake query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
