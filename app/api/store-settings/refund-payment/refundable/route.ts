// app/api/store-settings/refund-payment/refundable/route.ts
//
// 返金可能項目の取得スタブ。本番では Oracle 連携 (member-search 風の API Gateway)
// もしくは PG 経由で会員ごとの請求履歴を返すよう実装する。
// 当面はスキーマ互換のダミーデータを返し、UI/契約を本番形のまま固定化する。

import { NextResponse } from "next/server";
import { getRefundUser } from "@/lib/refundAuth";
import type { RefundItem, BankAccount } from "@/types/refundApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 会員番号 → 返金可能項目 のダミーマップ
const STUB: Record<string, { items: RefundItem[]; account?: BankAccount; member?: { name: string; kana: string; phone: string; plan: string } }> = {
  M0001234: {
    member: { name: "山田 太郎", kana: "ヤマダ タロウ", phone: "090-1234-5678", plan: "プレミアム" },
    items: [
      { id: "i1a", label: "月会費（2月分）", amount: 7980, paidAt: "2026-02-01", targetMonth: "2026-02", category: "月会費" },
      { id: "i1", label: "月会費（3月分）", amount: 7980, paidAt: "2026-03-01", targetMonth: "2026-03", category: "月会費" },
      { id: "i1b", label: "月会費（4月分）", amount: 7980, paidAt: "2026-04-01", targetMonth: "2026-04", category: "月会費" },
      { id: "i2", label: "FIT365あんしんサポート", amount: 550, paidAt: "2026-04-01", targetMonth: "2026-04", category: "オプション" },
      { id: "i3", label: "レディースエリア", amount: 550, paidAt: "2026-04-01", targetMonth: "2026-04", category: "オプション" },
    ],
    account: { bankCode: "0001", bankName: "みずほ銀行", branchName: "旭川支店", accountType: "普通", accountNumber: "1234567", holderName: "ヤマダ タロウ", source: "登録済み（引落口座）" },
  },
  M0002345: {
    member: { name: "佐藤 花子", kana: "サトウ ハナコ", phone: "080-9876-5432", plan: "スタンダード" },
    items: [
      { id: "i4", label: "月会費（4月分）", amount: 5980, paidAt: "2026-04-01", targetMonth: "2026-04", category: "月会費" },
      { id: "i5", label: "事務手数料", amount: 3300, paidAt: "2026-04-01", targetMonth: "2026-04", category: "事務手数料" },
    ],
    account: { bankCode: "0116", bankName: "北海道銀行", branchName: "本店営業部", accountType: "普通", accountNumber: "7654321", holderName: "サトウ ハナコ", source: "登録済み（引落口座）" },
  },
};

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const memberNo = sp.get("memberNo") || "";
  if (!memberNo) {
    return NextResponse.json({ ok: false, error: "memberNo required" }, { status: 400 });
  }

  const entry = STUB[memberNo];
  if (!entry) {
    return NextResponse.json({ ok: true, items: [], account: null, member: null, _stub: true });
  }
  return NextResponse.json({
    ok: true,
    items: entry.items,
    account: entry.account ?? null,
    member: entry.member ?? null,
    _stub: true,
  });
}
