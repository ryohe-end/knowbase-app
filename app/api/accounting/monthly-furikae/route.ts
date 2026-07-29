// app/api/accounting/monthly-furikae/route.ts
//
// 月次処理: 振替契約別サマリ(経理連携)を adb01(member-search Lambda 経由)から取得する。
//   GET ?ym=YYYYMM
//     → member-search type=furikae_summary&ym=YYYYMM を中継し rows を返す。
// クラブコード×振替結果×税率で集計した「振替合計/年管理費/会費/割引」を返す。
// 経理管理(requireAccounting)のみアクセス可。CSV 整形は画面側(Shift-JIS)で行う。
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/accountingAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";

export async function GET(req: NextRequest) {
  const user = await requireAccounting();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const ym = (req.nextUrl.searchParams.get("ym") || "").trim();
  if (!/^\d{6}$/.test(ym)) {
    return NextResponse.json({ ok: false, error: "ym(YYYYMM) required" }, { status: 400 });
  }
  if (!API_BASE || !API_KEY) {
    return NextResponse.json({ ok: false, error: "member_search_api_not_configured" }, { status: 500 });
  }

  const url = new URL(`${API_BASE}/members/search`);
  url.searchParams.set("type", "furikae_summary");
  url.searchParams.set("ym", ym);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), { method: "GET", headers: { "x-api-key": API_KEY }, cache: "no-store" });
  } catch (err) {
    console.error("[monthly-furikae] upstream fetch failed", err);
    return NextResponse.json({ ok: false, error: "upstream_unreachable" }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => ({} as any));
  if (!upstream.ok) {
    console.error("[monthly-furikae] upstream error", upstream.status, payload);
    // Oracle 権限不足(ORA-00942)等は message をそのまま返して画面で理由を提示する
    return NextResponse.json(
      { ok: false, error: payload?.error || "upstream_error", message: payload?.message || null, status: upstream.status },
      { status: 502 }
    );
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return NextResponse.json({ ok: true, ym, rows });
}
