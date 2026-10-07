// app/api/public/contracts/route.ts
// 公開API: adb01 契約形態マスタ — クラブごとの「最新の契約できる契約」。x-api-key 認証。
// 契約形態マスタはクラブ非依存のため、直近 sinceMonths ヶ月に入会した会員(区分1/7/70)の
// 契約形態から「現在そのクラブで契約可能な契約形態」を導出する。
//   GET /api/public/contracts?clubCode=375[&sinceMonths=12]
import { NextResponse } from "next/server";
import { callMemberSearch } from "@/lib/unpaid";
import { requirePublicApiKey } from "@/lib/publicApiAuth";
import { loadClubContractOverlay } from "@/lib/clubContractSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 主契約の会員区分コード (1=フィットネス/7=スタッフ/8=タイム/70=法人個人)。
// これ以外(例: 90=オプション=ロッカー類)はオプション扱い。日割り判定に使用。
const MAIN_KUBUN = new Set([1, 7, 8, 70]);

export async function GET(req: Request) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;
  const sp = new URL(req.url).searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  const sinceMonths = (sp.get("sinceMonths") || "12").trim();

  // オプション一覧(会員区分90)を含めるか。既定で含める。options=0 で抑止。
  const withOptions = (sp.get("options") || "") !== "0";
  try {
    // 入会管理オーバーレイ(knowbie側入力): プレオープン/家族可否/説明文/募集ON-OFF/違約金。
    const [data, optData, overlay] = await Promise.all([
      callMemberSearch({ type: "club-contracts", clubCode, sinceMonths }),
      withOptions ? callMemberSearch({ type: "club-options", clubCode }) : Promise.resolve({ options: [] }),
      loadClubContractOverlay(clubCode),
    ]);
    const contracts = (data?.contracts || []).map((r: any) => {
      const ov = overlay[String(r.CODE)] || {};
      return ({
      code: r.CODE,
      name: r.NAME,
      memberKubun: r.KUBUN, // 1=会費(本会員) / 7=スタッフ / 70=法人個人
      // 日割り: ルール固定。主契約(会員区分1/7/70)=日割りあり(true)、オプション(区分90等)=なし(false)。
      //   本APIは主契約(1/7/70)を返すため既定 true。オプション一覧を別APIで返す際は false 固定。
      prorated: r.KUBUN === 1 || r.KUBUN === 7 || r.KUBUN === 70,
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
      // 日割り(9/17 寺崎): 主契約=あり / オプション=なし の固定ルール。会員区分コードで判定。
      prorated: MAIN_KUBUN.has(Number(r.KUBUN)),
      // 以下は FIT_ADMIN.契約形態 マスタに列が無く、入会管理オーバーレイ(knowbie入力)から補完。
      // 未入力(オーバーレイに無い)は null = 未整備。
      description: ov.description ?? null,            // 説明文 (9/17 寺崎)
      isPreOpenContract: ov.isPreOpenContract ?? null, // プレオープン契約か (9/17 寺崎)
      familyAllowed: ov.familyAllowed ?? null,       // 家族会員可否 (9/17 寺崎)
      recruiting: ov.enabled ?? null,                 // 募集ON/OFF(契約別)。未設定=null
      penalty: ov.penalty ?? null,                    // 違約金(円)。未設定=null
    });
    });
    // オプション一覧(会員区分90)。フラット(クラブ別)。主契約への紐づけ/スコープはマスタに無い。
    const options = (optData?.options || []).map((o: any) => ({
      code: o.CODE,
      name: o.NAME,
      memberKubun: o.KUBUN, // 90=オプション
      productCodes: {
        deposit: o.DEPOSIT_PID,
        enrollment: o.ENROLL_PID,
        adminFee: o.ADMIN_FEE_PID,
        monthlyFee: o.FEE_PID,
        annualFee: o.ANNUAL_FEE_PID,
      },
      sortNo: o.SORT_NO,
      prorated: false, // オプションは日割りなし(固定ルール)
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
      // 9/17 寺崎 要望への対応状況(フィールド注記)。
      fieldNotes: {
        prorated: "日割り。主契約=true / オプション=false の固定ルール(会員区分コードで判定)。",
        description: "説明文。契約形態マスタに列が無く、入会管理オーバーレイ(knowbie入力)から補完。未入力=null。",
        isPreOpenContract: "プレオープン契約か。マスタに判別列が無く、オーバーレイ入力。未入力=null。",
        familyAllowed: "家族会員可否。マスタに列が無く、オーバーレイ入力。未入力=null。",
        recruiting: "募集ON/OFF(契約別)。オーバーレイ入力。未入力=null(近似導出に委ねる)。",
        penalty: "違約金(円)。オーバーレイ入力。未入力=null。",
        options: "オプション(会員区分90)のフラット一覧(クラブ別)。options=0 で抑止可。主契約への紐づけ/法人・プレミアム・家族スコープはマスタに存在しないため本APIでは未表現(必要ならオーバーレイ整備で対応)。",
      },
      count: contracts.length,
      contracts,
      optionCount: options.length,
      options,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "member_search_error" }, { status: 502 });
  }
}
