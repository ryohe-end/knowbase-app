// app/api/shopify/loyalty/webhooks/customers-create/route.ts
// customers/create webhook。/link で一時保存した email→会員番号 を引き、
// 会員情報を取得して顧客メタフィールド loyalty.* を確定する。
// 設計: docs/shopify-loyalty-integration.md §4.4
import { NextResponse } from "next/server";
import { verifyWebhookHmac, setLoyaltyMetafields } from "@/lib/shopify";
import { peekMemberLink, deleteMemberLink } from "@/lib/shopifyLinkStore";
import { fetchLoyalty, isValidMemberId } from "@/lib/loyaltyCpss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(raw, hmac)) {
    return NextResponse.json({ ok: false, error: "invalid hmac" }, { status: 401 });
  }

  let payload: { id?: number | string; email?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const customerId = payload.id;
  const email = String(payload.email || "").trim();
  // webhook は常に 200 を返す（Shopify の再送を避ける）。処理不能は静かに無視。
  if (!customerId || !email) return NextResponse.json({ ok: true, skipped: "no id/email" });

  const memberId = await peekMemberLink(email);
  if (!memberId || !isValidMemberId(memberId)) {
    return NextResponse.json({ ok: true, skipped: "no pending link" });
  }

  try {
    const info = await fetchLoyalty(memberId);
    if (!info.exists) {
      // 実在しない会員番号はリトライ不要。stash を消して 200。
      await deleteMemberLink(email);
      return NextResponse.json({ ok: true, skipped: "member not found" });
    }
    await setLoyaltyMetafields(customerId, {
      member_id: memberId,
      rank: info.rank ?? undefined,
      rank_name: info.rankName ?? undefined,
      points: info.balance ?? undefined,
      synced_at: new Date().toISOString(),
    });
    await deleteMemberLink(email); // 確定成功後に消費
  } catch (e) {
    // CPSS/Shopify の一時障害は 500 を返し Shopify の再送に委ねる（stash は残す）。
    console.error("[shopify loyalty webhook] sync failed:", email, e);
    return NextResponse.json({ ok: false, error: "sync failed, will retry" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
