// app/api/store-settings/refund-payment/me/route.ts
// 返金メニューの出し分け用に、ログインユーザーのロールと可否を返す。
//   store(店舗)=申請のみ / admin(管理者)=申請+承認 / finance(経理)=経理のみ
import { NextResponse } from "next/server";
import { getRefundUser, canApply, canApprove, canFinance } from "@/lib/refundAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getRefundUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    role: user.role,
    name: user.name,
    canApply: canApply(user),
    canApprove: canApprove(user),
    canFinance: canFinance(user),
  });
}
