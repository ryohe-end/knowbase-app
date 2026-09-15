// app/api/shopify/loyalty/link/route.ts
// 登録フォーム送信時にテーマ(customer-membership.js)から呼ばれる。
// { member_id, email } を受け、会員実在チェック後に email→会員番号 を一時保存する。
// 顧客確定・メタフィールド書込は customers/create webhook 側で行う。
// 設計: docs/shopify-loyalty-integration.md §4.1
import { NextResponse } from "next/server";
import { verifyAppProxySignature } from "@/lib/shopify";
import { stashMemberLink } from "@/lib/shopifyLinkStore";
import { fetchLoyalty, isValidMemberId } from "@/lib/loyaltyCpss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!verifyAppProxySignature(url)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  let body: { member_id?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const memberId = String(body.member_id || "").trim();
  const email = String(body.email || "").trim();
  if (!isValidMemberId(memberId)) {
    return NextResponse.json({ ok: false, error: "invalid member_id" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ ok: false, error: "email required" }, { status: 400 });
  }

  // 会員実在チェック（CPSS障害は 502 で返し、テーマ側はUXを止めない）
  let info;
  try {
    info = await fetchLoyalty(memberId);
  } catch {
    return NextResponse.json({ ok: false, error: "cpss_unavailable" }, { status: 502 });
  }
  if (!info.exists) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 200 });
  }

  await stashMemberLink(email, memberId);
  return NextResponse.json({ ok: true });
}
