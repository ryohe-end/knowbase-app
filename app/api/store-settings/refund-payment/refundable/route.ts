// app/api/store-settings/refund-payment/refundable/route.ts
//
// [非推奨] 旧・返金可能項目スタブ。本番の返金可能項目は member-search Lambda(type=refundable,
// FIT_ADMIN.会員入金歴 の実データ) を叩く下記に一本化済み:
//   GET /api/store-settings/refund-payment/member-detail?memberNo=..&clubCode=..
// このルートはダミーデータを返さないよう無効化し、正しい参照先へ誘導する。
import { NextResponse } from "next/server";
import { getRefundUser } from "@/lib/refundAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(
    {
      ok: false,
      deprecated: true,
      error: "この参照先は廃止されました。返金可能項目は member-detail (実データ) を使用してください。",
      use: "/api/store-settings/refund-payment/member-detail?memberNo=..&clubCode=..",
    },
    { status: 410 }
  );
}
