// app/api/shopify/loyalty/demo-link/route.ts
// ★デモ専用★ App Proxy を使わずにテーマから直接呼ぶための入口。
//   本番では使わないこと（署名検証なし・customer_id をbodyで信頼＝安全でない）。
//   目的: minefit-test（Adminトークンあり／App Proxyアプリ無し）で会員連携の実機デモを行う。
//   本番は /link-account（App Proxy署名 + logged_in_customer_id）を使う。
import { NextResponse } from "next/server";
import { setLoyaltyMetafields } from "@/lib/shopify";
import { fetchLoyalty, isValidMemberId } from "@/lib/loyaltyCpss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  let body: { member_id?: string; customer_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400, headers: CORS });
  }
  const memberId = String(body.member_id || "").trim();
  const customerId = String(body.customer_id || "").trim();
  if (!isValidMemberId(memberId)) {
    return NextResponse.json({ ok: false, error: "invalid member_id" }, { status: 400, headers: CORS });
  }
  if (!customerId) {
    return NextResponse.json({ ok: false, error: "customer_id required" }, { status: 400, headers: CORS });
  }

  let info;
  try {
    info = await fetchLoyalty(memberId);
  } catch {
    return NextResponse.json({ ok: false, error: "cpss_unavailable" }, { status: 502, headers: CORS });
  }
  if (!info.exists) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 200, headers: CORS });
  }

  try {
    await setLoyaltyMetafields(customerId, {
      member_id: memberId,
      rank: info.rank ?? undefined,
      rank_name: info.rankName ?? undefined,
      points: info.balance ?? undefined,
      synced_at: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "shopify_error" }, { status: 502, headers: CORS });
  }

  return NextResponse.json(
    { ok: true, member_id: memberId, rank: info.rank, rank_name: info.rankName, points: info.balance },
    { headers: CORS }
  );
}
