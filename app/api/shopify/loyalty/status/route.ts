// app/api/shopify/loyalty/status/route.ts
// アカウント画面のランク/残高ライブ表示用。App Proxy 署名 + logged_in_customer_id 必須。
// synced_at が閾値内ならメタフィールド値を返し CPSS を叩かない（レート保護）。
// 設計: docs/shopify-loyalty-integration.md §4.2
import { NextResponse } from "next/server";
import { verifyAppProxySignature, getLoyaltyMetafields, setLoyaltyMetafields } from "@/lib/shopify";
import { fetchLoyalty } from "@/lib/loyaltyCpss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FRESH_MS = 10 * 60 * 1000; // 10分キャッシュ

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!verifyAppProxySignature(url)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) {
    return NextResponse.json({ ok: false, error: "not logged in" }, { status: 401 });
  }

  let mf;
  try {
    mf = await getLoyaltyMetafields(customerId);
  } catch {
    return NextResponse.json({ ok: false, error: "shopify_error" }, { status: 502 });
  }
  if (!mf.member_id) {
    return NextResponse.json({ ok: true, linked: false });
  }

  const fresh = mf.synced_at && Date.now() - new Date(mf.synced_at).getTime() < FRESH_MS;
  if (fresh) {
    return NextResponse.json({
      ok: true,
      linked: true,
      cached: true,
      member_id: mf.member_id,
      rank: mf.rank ?? null,
      rank_name: mf.rank_name ?? null,
      points: mf.points ?? null,
    });
  }

  // 古ければ CPSS から取得し、メタフィールドへ書き戻す
  try {
    const info = await fetchLoyalty(mf.member_id);
    const syncedAt = new Date().toISOString();
    await setLoyaltyMetafields(customerId, {
      rank: info.rank ?? undefined,
      rank_name: info.rankName ?? undefined,
      points: info.balance ?? undefined,
      synced_at: syncedAt,
    });
    return NextResponse.json({
      ok: true,
      linked: true,
      cached: false,
      member_id: mf.member_id,
      rank: info.rank,
      rank_name: info.rankName,
      points: info.balance,
    });
  } catch {
    // CPSS障害時は古いキャッシュを返す（表示を壊さない）
    return NextResponse.json({
      ok: true,
      linked: true,
      cached: true,
      stale: true,
      member_id: mf.member_id,
      rank: mf.rank ?? null,
      rank_name: mf.rank_name ?? null,
      points: mf.points ?? null,
    });
  }
}
