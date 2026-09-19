// app/api/shopify/loyalty/account-link/route.ts
// Customer Account UI Extension（マイページ内の「会員情報」）から呼ばれる。
// App Proxy ではなくセッショントークン(JWT)で顧客を確定する点が link-account との違い。
//   GET  … 現在の連携状態を返す（カード or フォームの出し分けに使用）
//   POST … 会員番号を CPSS 照合 → メタフィールド直書き（連携確定）
//   OPTIONS … CORS プリフライト（拡張は null origin の Web Worker から fetch する）
// 設計: docs/shopify-loyalty-integration.md §4.1c
import { NextResponse } from "next/server";
import { verifySessionToken, setLoyaltyMetafields, getLoyaltyMetafields } from "@/lib/shopify";
import { fetchLoyalty, isValidMemberId } from "@/lib/loyaltyCpss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const claims = verifySessionToken(bearer(req));
  if (!claims) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const mf = await getLoyaltyMetafields(claims.customerId);
    return json({
      ok: true,
      linked: Boolean(mf.member_id),
      member_id: mf.member_id ?? null,
      rank: mf.rank ?? null,
      rank_name: mf.rank_name ?? null,
      points: mf.points ?? null,
    });
  } catch {
    return json({ ok: false, error: "shopify_error" }, 502);
  }
}

export async function POST(req: Request) {
  const claims = verifySessionToken(bearer(req));
  if (!claims) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { member_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const memberId = String(body.member_id || "").trim();
  if (!isValidMemberId(memberId)) {
    return json({ ok: false, error: "invalid member_id" }, 400);
  }

  // CPSS 実在チェック
  let info;
  try {
    info = await fetchLoyalty(memberId);
  } catch {
    return json({ ok: false, error: "cpss_unavailable" }, 502);
  }
  if (!info.exists) {
    return json({ ok: true, linked: false, reason: "not_found" });
  }

  // ログイン顧客へメタフィールド直書き
  try {
    await setLoyaltyMetafields(claims.customerId, {
      member_id: memberId,
      rank: info.rank ?? undefined,
      rank_name: info.rankName ?? undefined,
      points: info.balance ?? undefined,
      synced_at: new Date().toISOString(),
    });
  } catch {
    return json({ ok: false, error: "shopify_error" }, 502);
  }

  return json({
    ok: true,
    linked: true,
    member_id: memberId,
    rank: info.rank,
    rank_name: info.rankName,
    points: info.balance,
  });
}
