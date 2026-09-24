// app/api/shopify/loyalty/account-link/route.ts
// Customer Account UI Extension（マイページ内の「会員情報」）から呼ばれる CPSS 照合エンドポイント。
// 方式A: メタフィールドの読み書きは拡張が Customer Account API で顧客自身の権限で行うため、
// このバックエンドは「会員番号が CPSS に実在するか照合して rank/points を返すだけ」。
// → Shopify Admin トークン不要（このorgが静的トークンを出せない制約を回避）。
//   POST … 会員番号を検証し CPSS 照合。存在すれば rank/rank_name/points を返す。
//   OPTIONS … CORS プリフライト（拡張は null origin の Web Worker から fetch する）。
// 認証: minefit-loyalty アプリのセッショントークン(JWT)。設計: docs/shopify-loyalty-integration.md §4.1c
import { NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/shopify";
import { fetchLoyalty, isValidMemberId } from "@/lib/loyaltyCpss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// テスト用の会員番号→ランク対応（CPSSを経由せず固定値を返す）。
// 各ランクの表示・割引をテスト/デモするための番号。※本番運用時は削除 or 環境変数でガードする。
const TEST_MEMBERS: Record<string, { rank: string; rankName: string; balance: number }> = {
  "1000000001": { rank: "0001", rankName: "ブロンズ", balance: 450 },
  "1000000002": { rank: "0002", rankName: "シルバー", balance: 1200 },
  "1000000003": { rank: "0003", rankName: "ゴールド", balance: 5000 },
  "1000000004": { rank: "0004", rankName: "プラチナ", balance: 12000 },
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
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

  // テスト用会員番号は CPSS を経由せず固定ランクを返す
  const test = TEST_MEMBERS[memberId];
  if (test) {
    return json({
      ok: true,
      exists: true,
      member_id: memberId,
      rank: test.rank,
      rank_name: test.rankName,
      points: test.balance,
    });
  }

  // CPSS 実在チェック（Shopify には触れない）
  let info;
  try {
    info = await fetchLoyalty(memberId);
  } catch {
    return json({ ok: false, error: "cpss_unavailable" }, 502);
  }
  if (!info.exists) {
    return json({ ok: true, exists: false, reason: "not_found" });
  }

  // 実在。書き込みは拡張側（Customer Account API）が顧客権限で行う。
  return json({
    ok: true,
    exists: true,
    member_id: memberId,
    rank: info.rank,
    rank_name: info.rankName,
    points: info.balance,
  });
}
