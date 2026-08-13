// app/api/public/fees/route.ts
// 公開API: adb01 契約会費金額 — クラブ別の会費(月会費/半年一括/年一括/年管理費/入会金/事務手続料/保証金/休会費)を
// 「適用年月」付きで返す。x-api-key 認証。
//   GET /api/public/fees?clubCode=375[&history=1][&asOf=202608]
// 粒度 = (契約形態コード × 会費適用区分コード × 適用人数) ごとに 適用年月 の改定履歴を持つ。
//   既定       : 各キーの最新(適用年月が最大)のみ。各行 isLatest=true。
//   history=1  : 全ての適用年月(改定履歴)。isLatest でその年月が最新版かどうか判定できる。
//   asOf=YYYYMM: その年月時点で有効な会費(=適用年月 <= asOf の中の最新)。
import { NextResponse } from "next/server";
import { callMemberSearch } from "@/lib/unpaid";
import { requirePublicApiKey } from "@/lib/publicApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;
  const sp = new URL(req.url).searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  const history = (sp.get("history") || "").trim();
  const asOf = (sp.get("asOf") || "").trim();

  try {
    const params: Record<string, string> = { type: "club-fees", clubCode };
    if (history) params.history = history;
    if (asOf) params.asOf = asOf;
    const data = await callMemberSearch(params);
    const fees = (data?.fees || []).map((r: any) => ({
      clubCode: r.CLUB_CODE, // クラブコード
      formCode: r.FORM_CODE, // 契約形態コード
      formName: r.FORM_NAME, // 契約形態名
      feeApplyKubun: r.FEE_APPLY_KUBUN, // 会費適用区分コード
      applyHeadcount: r.APPLY_HEADCOUNT, // 適用人数
      applyYearMonth: r.APPLY_YYYYMM, // 適用年月 (YYYYMM 数値)
      isLatest: r.APPLY_YYYYMM === r.MAX_YYYYMM, // このキーで最新の適用年月か
      amounts: {
        enrollmentFee: r.ENROLLMENT_FEE, // 入会金
        adminFee: r.ADMIN_FEE, // 事務手数料
        monthlyFee: r.MONTHLY_FEE, // 月会費
      },
    }));
    return NextResponse.json({
      ok: true,
      clubCode: String(data?.clubCode ?? clubCode),
      asOf: data?.asOf ?? null,
      history: !!data?.history,
      count: fees.length,
      fees,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "member_search_error" }, { status: 502 });
  }
}
