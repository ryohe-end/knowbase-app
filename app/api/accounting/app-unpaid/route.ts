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
import Encoding from "encoding-japanese";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET: Record<string, string> = { JOYFIT: "ecojoy", FIT365: "fit365entry" };
const BASE_JOIN = `FROM unpaid_history uh
  INNER JOIN sb_history sb ON sb.member_no=uh.uid AND sb.cust_code=uh.cust_no AND sb.order_id=uh.order_id AND sb.way=9
  INNER JOIN shop_convert_view spv ON spv.town_shop_id=sb.shop_id
  INNER JOIN shop sp ON sp.shop_id=sb.shop_id`;
const MAX_ROWS = 100000;

const ymd = (s: string | null) => (s && /^\d{4}-?\d{2}-?\d{2}$/.test(s) ? s.replace(/-/g, "") : null);
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toSjis = (s: string) => new Uint8Array(Encoding.convert(Encoding.stringToCode(s), { to: "SJIS", from: "UNICODE" }));

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

  // CSV: 指定ブランドの明細
  if (sp.get("format") === "csv") {
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
    const header = ["会員番号", "金額", "支払日", "支払時刻", "注文ID", "店舗コード", "店舗名", "ブランド"];
    const lines = rows.map((r) => [
      r.uid, r.amount, r.insert_date, r.insert_time, r.order_id, r.casio_shop_id, r.name, brand,
    ].map(csvCell).join(","));
    const csv = [header.join(","), ...lines].join("\r\n") + "\r\n";
    const period = `${from || "all"}-${to || "all"}`;
    const filename = `${brand}_APP未納金支払_${period}.csv`;
    return new Response(toSjis(csv) as any, {
      headers: {
        "Content-Type": "text/csv; charset=Shift_JIS",
        "Content-Disposition": `attachment; filename="appUnpaid_${brand}_${period}.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  }

  // サマリ: ブランド別 件数・金額
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
  return NextResponse.json({ ok: true, from, to, summary });
}
