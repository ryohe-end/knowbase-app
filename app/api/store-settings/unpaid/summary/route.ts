// app/api/store-settings/unpaid/summary/route.ts
// 未納管理ダッシュボード全体数値。member-search(振替契約別) を集計。
//   ?clubCode= | ?group=(エリア/companyGroup) | ?brand=(businessType)
// 回収=振替結果コード'0'(当月振替成功) / 未納=≠'0' / 貸倒予定=強制退会(退会理由=42)。
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { callMemberSearch, resolveClubCodes } from "@/lib/unpaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const clubCode = sp.get("clubCode");
  const group = sp.get("group");
  const brand = sp.get("brand");
  const fromYm = sp.get("fromYm");
  const toYm = sp.get("toYm");

  try {
    const { clubCodes, clubs } = await resolveClubCodes({
      scope: user.clubCodes, clubCode, group, brand,
    });
    if (clubCodes.length === 0) {
      return NextResponse.json({ ok: true, empty: true, clubCount: 0, summary: null });
    }
    const params: Record<string, string> = { type: "unpaid_summary", clubCodes: clubCodes.join(",") };
    if (fromYm) params.fromYm = fromYm;
    if (toYm) params.toYm = toYm;
    const summary = await callMemberSearch(params);

    return NextResponse.json({
      ok: true,
      clubCount: clubCodes.length,
      clubs: clubs.map((c) => ({ clubCode: c.clubCode, clubName: c.clubName, companyGroup: c.companyGroup, businessType: c.businessType })),
      summary,
    });
  } catch (e: any) {
    console.error("[unpaid/summary] error", e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 502 });
  }
}
