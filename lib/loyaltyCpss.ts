// lib/loyaltyCpss.ts
// Shopify連携で使う CPSS 照会の薄いラッパー。会員番号=CPSS aid（変換不要）。
// 読み取り(getMemberForApp)は shopid 不要（既存 points/member/route.ts 準拠）。
import { cpssCall, type CpssBrand, type CpssEnvName } from "@/lib/cpssProxy";

const CPSS_ENV = ((process.env.CPSS_ENV as CpssEnvName) || "stg");
const BRAND = ((process.env.CPSS_BRAND as CpssBrand) || "FIT365");

export { CPSS_ENV, BRAND };

/** shopid は本番のみ6桁ゼロ埋め（既存 points 系ルート準拠）。 */
export const cpssShopId = (c: string) =>
  CPSS_ENV === "prod" ? String(c).replace(/\D/g, "").padStart(6, "0") : String(c);

// FIT365 の会員番号はちょうど10桁の数字
export const MEMBER_ID_RE = /^\d{10}$/;
export const isValidMemberId = (v: string) => MEMBER_ID_RE.test(v);

export type LoyaltyInfo = {
  exists: boolean;
  rank: string | null;
  rankName: string | null;
  balance: number | null;
};

// CPSS: 指定会員が存在しない場合のエラーコード（実測。空resultではなくこのcodeで返る）
const CODE_MEMBER_NOT_FOUND = "003-001-000";

/** 会員番号(=aid)で会員照会。存在しなければ exists=false。CPSS障害時は例外を投げる。 */
export async function fetchLoyalty(memberId: string): Promise<LoyaltyInfo> {
  const cp = await cpssCall(BRAND, CPSS_ENV, "getMemberForApp", {
    aid: memberId,
    cumulus: true,
    expires: true,
  });
  if (!cp.ok) {
    // 会員不在は「非会員」として扱う（真のCPSS障害と区別する）
    if (cp.code === CODE_MEMBER_NOT_FOUND) {
      return { exists: false, rank: null, rankName: null, balance: null };
    }
    // それ以外（IP未許可/通信障害/仕様外）は障害として投げる
    throw new Error(cp.cpssMsg || cp.error || "CPSS getMemberForApp failed");
  }
  const r = cp.result || {};
  const balance = typeof r.balance === "number" ? r.balance : null;
  const rank = r.rank != null ? String(r.rank) : null;
  // rank/balance いずれか取れれば会員実在とみなす
  const exists = rank != null || balance != null;
  return {
    exists,
    rank,
    rankName: r.rankname != null ? String(r.rankname) : null,
    balance,
  };
}

export type GrantResult = { ok: boolean; hid?: string; balance?: number; error?: string };

/** ポイント付与（give_point）。reqid で冪等。shopid は呼び出し側で導出して渡す。 */
export async function grantPoint(args: {
  memberId: string;
  shopid: string;
  point: number;
  reqid: string;
  scode?: string;
  svalue?: string;
}): Promise<GrantResult> {
  const cp = await cpssCall(BRAND, CPSS_ENV, "givePoint", {
    aid: args.memberId,
    shopid: args.shopid,
    point: args.point,
    reqid: args.reqid,
    scode: args.scode ?? "EC",
    svalue: args.svalue,
  });
  if (!cp.ok) return { ok: false, error: cp.cpssMsg || cp.error };
  return {
    ok: true,
    hid: cp.result?.hid,
    balance: typeof cp.result?.balance === "number" ? cp.result.balance : undefined,
  };
}

/** ポイント利用（use_point・減算）。reqid で冪等。1pt=1円想定で point=利用ポイント数。 */
export async function usePoint(args: {
  memberId: string;
  shopid: string;
  point: number;
  reqid: string;
  scode?: string;
  svalue?: string;
}): Promise<GrantResult> {
  const cp = await cpssCall(BRAND, CPSS_ENV, "usePoint", {
    aid: args.memberId,
    shopid: args.shopid,
    point: args.point,
    reqid: args.reqid,
    ptypes: "point",
    scode: args.scode ?? "EC",
    svalue: args.svalue,
  });
  if (!cp.ok) return { ok: false, error: cp.cpssMsg || cp.error };
  return {
    ok: true,
    hid: cp.result?.hid,
    balance: typeof cp.result?.balance === "number" ? cp.result.balance : undefined,
  };
}

/** ポイント移動の取消（cancel_point・hid指定）。返品/注文キャンセル時の戻し。 */
export async function cancelPoint(args: {
  hid: string;
  shopid: string;
  reqid: string;
  reason?: string;
}): Promise<GrantResult> {
  const cp = await cpssCall(BRAND, CPSS_ENV, "cancelPoint", {
    hid: args.hid,
    shopid: args.shopid,
    reqid: args.reqid,
    reason: args.reason ?? "order canceled/refunded",
  });
  if (!cp.ok) return { ok: false, error: cp.cpssMsg || cp.error };
  return { ok: true, hid: cp.result?.hid };
}
