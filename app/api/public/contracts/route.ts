// app/api/public/contracts/route.ts
// 公開API: adb01 契約形態マスタ — クラブごとの「最新の契約できる契約」。x-api-key 認証。
// 契約形態マスタはクラブ非依存のため、直近 sinceMonths ヶ月に入会した会員(区分1/7/70)の
// 契約形態から「現在そのクラブで契約可能な契約形態」を導出する。
//   GET /api/public/contracts?clubCode=375[&sinceMonths=12]
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
  const sinceMonths = (sp.get("sinceMonths") || "12").trim();

  try {
    const data = await callMemberSearch({ type: "club-contracts", clubCode, sinceMonths });
    const contracts = (data?.contracts || []).map((r: any) => ({
      code: r.CODE,
      name: r.NAME,
      memberKubun: r.KUBUN, // 1=会費(本会員) / 7=スタッフ / 70=法人個人
      termMonths: r.TERM, // 契約形態マスタ「有効期限」(契約期間/月数相当)
      flags: {
        school: r.SCHOOL_FLAG === 1,
        groupDiscount: r.GROUP_DISCOUNT_FLAG === 1,
        pausable: r.PAUSABLE_FLAG === 1,
      },
      monthlyUses: r.MONTHLY_USES,
      yearlyUses: r.YEARLY_USES,
      productCodes: {
        // deposit=保証金(預り金)商品コード。契約形態マスタに元から存在する項目で、
        // 値が null のクラブ/契約は当該契約に保証金設定が無いことを意味する(未設定=請求なし)。
        deposit: r.DEPOSIT_PID,
        enrollment: r.ENROLL_PID,
        adminFee: r.ADMIN_FEE_PID,
        monthlyFee: r.FEE_PID,
        annualFee: r.ANNUAL_FEE_PID,
      },
      sortNo: r.SORT_NO,
      recentSignups: r.RECENT_COUNT, // 直近sinceMonthsの新規契約数
      latestSignupDate: r.LATEST_JOIN, // 直近の入会届出日(YYYYMMDD)
    }));
    return NextResponse.json({
      ok: true,
      clubCode: String(data?.clubCode ?? clubCode),
      sinceMonths: data?.sinceMonths ?? Number(sinceMonths),
      // 導出方法の明示: 契約形態マスタはクラブ非依存のため、直近 sinceMonths ヶ月の入会実績から
      // 「そのクラブで実際に契約されている契約形態」を近似導出している。「今月から新規募集開始」
      // 「先月末で募集停止」といった募集状態そのものは表現できない(前者は実績が無く出ない/
      // 後者は実績が残り出る)点に注意。募集状態の権威マスタが提供されれば実績代理を置き換える。
      derivation: {
        method: "recent-signups", // 直近入会実績に基づく近似
        approximate: true,
        note: "契約可能かどうかの権威マスタではなく、直近入会実績に基づく近似。募集開始直後/停止直後は実態とずれる場合がある。",
      },
      count: contracts.length,
      contracts,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "member_search_error" }, { status: 502 });
  }
}
