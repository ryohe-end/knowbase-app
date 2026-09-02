// app/api/accounting/point-usage-fee/route.ts
// 経理: ポイント利用による会費割引のクラブ別集計(手数料2%)。
//   adb01(FIT_ADMIN.会員契約割引 自動生成フラグ=9) を member-search Lambda の
//   type=point-usage-fee 経由で集計。対象年月ごとに クラブ別 使用ポイント合計 + 手数料(2%,切捨)。
//   GET ?mode=months            → 対象年月の一覧(降順)
//   GET ?ym=2025年08月           → クラブ別集計 + 合計
import { NextResponse } from "next/server";
import { requireAccounting } from "@/lib/accountingAuth";
import { callMemberSearch } from "@/lib/unpaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireAccounting())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;

  // 対象年月の一覧
  if (sp.get("mode") === "months") {
    try {
      const data = await callMemberSearch({ type: "point-usage-fee", mode: "months" });
      return NextResponse.json({ ok: true, months: Array.isArray(data?.months) ? data.months : [] });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || "member_search_error" }, { status: 502 });
    }
  }

  const ym = (sp.get("ym") || "").trim();
  if (!/^\d{4}年\d{2}月$/.test(ym)) {
    return NextResponse.json({ ok: false, error: "ym は「2025年08月」形式で指定してください" }, { status: 400 });
  }

  try {
    const data = await callMemberSearch({ type: "point-usage-fee", ym });
    const rows = (data?.rows || []).map((r: any) => ({
      クラブコード: r.CLUB_CODE,
      クラブ略称: r.CLUB_NAME,
      使用ポイント: Number(r.USED_POINTS) || 0,
      手数料: Number(r.FEE) || 0,
    }));
    const totals = rows.reduce(
      (t: { 使用ポイント: number; 手数料: number }, r: any) => {
        t.使用ポイント += r.使用ポイント;
        t.手数料 += r.手数料;
        return t;
      },
      { 使用ポイント: 0, 手数料: 0 }
    );
    return NextResponse.json({ ok: true, ym, count: rows.length, rows, totals });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "member_search_error" }, { status: 502 });
  }
}
