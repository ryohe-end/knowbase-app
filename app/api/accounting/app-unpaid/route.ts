// app/api/accounting/app-unpaid/route.ts
//
// 経理: APPで支払われた未納金の実績を、ブランド別(JOYFIT/FIT365)に集計/CSV出力する。
// データ源(既存 unpaid-app-payments と同一): 入会DB(FIT365=fit365entry / JOYFIT=ecojoy) の
//   unpaid_history(path_type='APP', paid_flg=1) ⋈ sb_history(way=9) ⋈ shop_convert_view ⋈ shop
//   GET ?from=&to=                 → ブランド別サマリ {brand, count, total}[]
//   GET ?format=csv&brand=X&from=&to= → そのブランドの明細を Shift-JIS CSV でダウンロード
// 経理(requireAccounting)のみ。全店対象(店舗スコープ無し)。
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/accountingAuth";
import { sshBatch } from "@/lib/sshDbProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET: Record<string, string> = { JOYFIT: "ecojoy", FIT365: "fit365entry" };
const BASE_JOIN = `FROM unpaid_history uh
  INNER JOIN sb_history sb ON sb.member_no=uh.uid AND sb.cust_code=uh.cust_no AND sb.order_id=uh.order_id AND sb.way=9
  INNER JOIN shop_convert_view spv ON spv.town_shop_id=sb.shop_id
  INNER JOIN shop sp ON sp.shop_id=sb.shop_id`;
const MAX_ROWS = 100000;
const SUMMARY_TTL = 5 * 60 * 1000;
const summaryCache = new Map<string, { at: number; summary: any[] }>();

const ymd = (s: string | null) => (s && /^\d{4}-?\d{2}-?\d{2}$/.test(s) ? s.replace(/-/g, "") : null);

function whereClause(from: string | null, to: string | null) {
  const clauses = ["uh.path_type='APP'", "uh.paid_flg=1"];
  const params: any[] = [];
  if (from) { clauses.push("uh.insert_date >= ?"); params.push(from); }
  if (to) { clauses.push("uh.insert_date <= ?"); params.push(to); }
  return { sql: clauses.join(" AND "), params };
}

export async function GET(req: NextRequest) {
  const user = await requireAccounting();
  if (!user) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const from = ymd(sp.get("from"));
  const to = ymd(sp.get("to"));
  const { sql, params } = whereClause(from, to);

  // 明細取得(CSVは画面側でSJIS生成する。SSRのバイナリ応答はAmplify経由で文字化けし得るため)
  if (sp.get("rows") === "1") {
    const brand = String(sp.get("brand") || "").toUpperCase();
    const target = TARGET[brand];
    if (!target) return NextResponse.json({ ok: false, error: "brand must be JOYFIT or FIT365" }, { status: 400 });
    let rows: any[] = [];
    try {
      const res = await sshBatch(target, [
        { text: `SELECT uh.uid, uh.amount, uh.insert_date, uh.insert_time, uh.order_id, spv.casio_shop_id, sp.name ${BASE_JOIN} WHERE ${sql}
                 ORDER BY uh.insert_date DESC, uh.insert_time DESC LIMIT ?`, params: [...params, MAX_ROWS] },
      ]);
      if (!res.ok) return NextResponse.json({ ok: false, error: "db_error", message: res.error }, { status: 502 });
      rows = res.results[0].rows || [];
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: "db_unreachable", message: e?.message || null }, { status: 502 });
    }
    const out = rows.map((r) => ({
      会員番号: String(r.uid ?? ""), 金額: Number(r.amount) || 0,
      支払日: String(r.insert_date ?? ""), 支払時刻: String(r.insert_time ?? ""),
      注文ID: String(r.order_id ?? ""), 店舗コード: String(r.casio_shop_id ?? ""),
      店舗名: String(r.name ?? ""), ブランド: brand,
    }));
    return NextResponse.json({ ok: true, brand, count: out.length, truncated: out.length >= MAX_ROWS, rows: out });
  }

  // サマリ: ブランド別 件数・金額 (短期キャッシュ。踏み台SSHの立ち上げに時間がかかるため)
  const cacheKey = `${from || ""}|${to || ""}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SUMMARY_TTL) {
    return NextResponse.json({ ok: true, from, to, summary: cached.summary, cached: true });
  }
  const summary = await Promise.all(Object.entries(TARGET).map(async ([brand, target]) => {
    try {
      const res = await sshBatch(target, [
        { text: `SELECT COUNT(*) cnt, COALESCE(SUM(uh.amount),0) total ${BASE_JOIN} WHERE ${sql}`, params },
      ]);
      if (!res.ok) return { brand, count: 0, total: 0, error: res.error };
      const h = res.results[0].rows[0] || { cnt: 0, total: 0 };
      return { brand, count: Number(h.cnt), total: Number(h.total) };
    } catch (e: any) {
      return { brand, count: 0, total: 0, error: e?.message || "error" };
    }
  }));
  summaryCache.set(cacheKey, { at: Date.now(), summary });
  return NextResponse.json({ ok: true, from, to, summary });
}
