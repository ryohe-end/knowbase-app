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

// 契約会費金額 に格納された生値の税基準。
//   "excluded" = 生値は税抜(本体価格) … taxIncluded を加算算出
//   "included" = 生値は税込          … taxExcluded を割戻し算出
// ※ FIT_ADMIN.契約会費金額 のマスタ金額は税抜格納が一般的なため既定 "excluded"。
//    実データで税込と判明した場合はこの一行を "included" に変更するだけでよい。
const STORED_TAX_BASIS: "excluded" | "included" = "excluded";

// 税テーブルの税率は 10(=%) / 0.10(=率) いずれの格納もあり得るため 0.10 形式へ正規化する。
function normalizeTaxRate(raw: any): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  return n > 1 ? n / 100 : n; // 10 → 0.10 / 0.10 → 0.10
}

// 生値と税率から税抜・税込の両方を返す。rate=null(税未紐付け)なら税額を出さず生値のみ。
function withTax(raw: any, rate: number | null): {
  taxExcluded: number | null;
  taxIncluded: number | null;
} {
  const v = Number(raw);
  if (!Number.isFinite(v)) return { taxExcluded: null, taxIncluded: null };
  if (rate == null) {
    // 税率不明: 生値をそのまま両方に入れず、基準側のみ埋める
    return STORED_TAX_BASIS === "included"
      ? { taxExcluded: null, taxIncluded: v }
      : { taxExcluded: v, taxIncluded: null };
  }
  if (STORED_TAX_BASIS === "included") {
    const excluded = Math.round(v / (1 + rate));
    return { taxExcluded: excluded, taxIncluded: v };
  }
  const included = Math.round(v * (1 + rate));
  return { taxExcluded: v, taxIncluded: included };
}

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
    const fees = (data?.fees || []).map((r: any) => {
      const rate = normalizeTaxRate(r.TAX_RATE); // 0.10 形式に正規化。未紐付けは null
      return {
        clubCode: r.CLUB_CODE, // クラブコード
        formCode: r.FORM_CODE, // 契約形態コード
        formName: r.FORM_NAME, // 契約形態名
        feeApplyKubun: r.FEE_APPLY_KUBUN, // 会費適用区分コード
        applyHeadcount: r.APPLY_HEADCOUNT, // 適用人数
        applyYearMonth: r.APPLY_YYYYMM, // 適用年月 (YYYYMM 数値)
        isLatest: r.APPLY_YYYYMM === r.MAX_YYYYMM, // このキーで最新の適用年月か
        taxCode: r.TAX_CODE ?? null, // 税コード (契約会費金額.税コード)
        taxRate: rate, // 税率 (0.10 形式)。税テーブル未紐付けなら null
        // 各金額は税抜(taxExcluded)・税込(taxIncluded)の両方を返す
        amounts: {
          enrollmentFee: withTax(r.ENROLLMENT_FEE, rate), // 入会金
          adminFee: withTax(r.ADMIN_FEE, rate), // 事務手数料
          monthlyFee: withTax(r.MONTHLY_FEE, rate), // 月会費
        },
      };
    });
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
