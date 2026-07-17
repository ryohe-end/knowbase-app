// app/api/store-settings/refund-payment/consignor/route.ts
//
// 全銀協 総合振込フォーマットの「委託者(振込元)」情報を返す。経理ロール限定。
// 本番値は環境変数で設定する(銀行口座情報のためクライアントに直書きしない)。
//   共通:      REFUND_CONSIGNOR_CODE / _KANA / _BANK_CODE / _BANK_NAME / _BRANCH_CODE / _BRANCH_NAME / _ACCT_TYPE / _ACCT
//   ブランド別: REFUND_CONSIGNOR_JOYFIT_CODE 等 (共通より優先)
// 未設定の項目は従来の仮値でフォールバックし、configured:false で UI 側に警告表示させる。
//   GET ?brand=JOYFIT|FIT365  → { ok, consignor, configured }
import { NextResponse } from "next/server";
import { getRefundUser, canFinance } from "@/lib/refundAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Consignor = {
  code: string; kana: string;
  bankCode: string; bankName: string;
  branchCode: string; branchName: string;
  acctType: string; acct: string;
};

// 本番設定が無い場合のフォールバック(仮値)。configured:false と併せて「要設定」を示す。
const FALLBACK: Consignor = {
  code: "0000001234", kana: "ｵｶﾓﾄｸﾞﾙｰﾌﾟ",
  bankCode: "0009", bankName: "ﾐﾂｲｽﾐﾄﾓ",
  branchCode: "001", branchName: "ﾎﾝﾃﾝ",
  acctType: "1", acct: "0000001",
};

function envConsignor(prefix: string): Partial<Consignor> {
  const g = (k: string) => {
    const v = process.env[`${prefix}${k}`];
    return v && v.trim() ? v.trim() : undefined;
  };
  const o: Partial<Consignor> = {
    code: g("CODE"), kana: g("KANA"),
    bankCode: g("BANK_CODE"), bankName: g("BANK_NAME"),
    branchCode: g("BRANCH_CODE"), branchName: g("BRANCH_NAME"),
    acctType: g("ACCT_TYPE"), acct: g("ACCT"),
  };
  // undefined を除去
  (Object.keys(o) as (keyof Consignor)[]).forEach((k) => { if (o[k] === undefined) delete o[k]; });
  return o;
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canFinance(user)) return NextResponse.json({ ok: false, error: "経理権限が必要です" }, { status: 403 });

  const brand = (new URL(req.url).searchParams.get("brand") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // ブランド別 → 共通 の順で解決 (ブランド別が優先)
  const base = envConsignor("REFUND_CONSIGNOR_");
  const brandCfg = brand ? envConsignor(`REFUND_CONSIGNOR_${brand}_`) : {};
  const merged: Consignor = { ...FALLBACK, ...base, ...brandCfg };

  // 主要項目(委託者コード/銀行/口座)がすべて環境変数由来なら configured
  const eff = { ...base, ...brandCfg };
  const configured = !!(eff.code && eff.bankCode && eff.acct);

  return NextResponse.json({ ok: true, consignor: merged, configured });
}
