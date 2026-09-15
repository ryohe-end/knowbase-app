// app/api/shopify/loyalty/link-account/route.ts
// マイページ（ログイン済み）からの会員番号登録/変更。
// logged_in_customer_id で顧客が確定しているため、CPSS照合後にメタフィールドを直書きする
// （登録フォームの stash+webhook 方式は不要）。
// 設計: docs/shopify-loyalty-integration.md §4.1b
import { NextResponse } from "next/server";
import { verifyAppProxySignature, setLoyaltyMetafields } from "@/lib/shopify";
import { fetchLoyalty, isValidMemberId } from "@/lib/loyaltyCpss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!verifyAppProxySignature(url)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) {
    return NextResponse.json({ ok: false, error: "not logged in" }, { status: 401 });
  }

  let body: { member_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const memberId = String(body.member_id || "").trim();
  if (!isValidMemberId(memberId)) {
    return NextResponse.json({ ok: false, error: "invalid member_id" }, { status: 400 });
  }

  // CPSS 実在チェック
  let info;
  try {
    info = await fetchLoyalty(memberId);
  } catch {
    return NextResponse.json({ ok: false, error: "cpss_unavailable" }, { status: 502 });
  }
  if (!info.exists) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 200 });
  }

  // ログイン顧客へメタフィールド直書き
  try {
    await setLoyaltyMetafields(customerId, {
      member_id: memberId,
      rank: info.rank ?? undefined,
      rank_name: info.rankName ?? undefined,
      points: info.balance ?? undefined,
      synced_at: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "shopify_error" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    member_id: memberId,
    rank: info.rank,
    rank_name: info.rankName,
    points: info.balance,
  });
}
