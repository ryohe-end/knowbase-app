// app/api/store-settings/refund-payment/deposit/unpaid/route.ts
// 入金画面の未納項目取得 (Lambda 中継)。member-detail と対の API。

import { NextRequest, NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";

export async function GET(req: NextRequest) {
  const user = await getRefundUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const memberNo = (sp.get("memberNo") || "").trim();
  const clubCode = (sp.get("clubCode") || "").trim();
  if (!memberNo) return NextResponse.json({ ok: false, error: "memberNo required" }, { status: 400 });
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
  }
  if (!API_BASE || !API_KEY) {
    return NextResponse.json({ ok: false, error: "member_search_api_not_configured" }, { status: 500 });
  }

  const url = new URL(`${API_BASE}/members/search`);
  url.searchParams.set("type", "unpaid");
  url.searchParams.set("memberNo", memberNo);
  url.searchParams.set("clubCode", clubCode);
  const fromMonth = sp.get("fromMonth");
  const toMonth = sp.get("toMonth");
  if (fromMonth) url.searchParams.set("fromMonth", fromMonth);
  if (toMonth) url.searchParams.set("toMonth", toMonth);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-key": API_KEY },
      cache: "no-store",
    });
  } catch (err) {
    console.error("upstream fetch failed", err);
    return NextResponse.json({ ok: false, error: "upstream_unreachable" }, { status: 502 });
  }
  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("upstream error", upstream.status, text);
    return NextResponse.json(
      { ok: false, error: "upstream_error", status: upstream.status },
      { status: 502 }
    );
  }

  const payload = await upstream.json() as { results?: { member?: any; items?: any[] } };
  const r = payload.results || {};
  return NextResponse.json({
    ok: true,
    member: r.member ?? null,
    items: Array.isArray(r.items) ? r.items : [],
  });
}
