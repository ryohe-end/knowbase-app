// app/api/store-settings/unpaid/writeoff-schedule/route.ts
// 貸倒償却予定 (年度別・月別)。償却予定 = 振替年月 + 12ヶ月。
//   ?clubCode= | ?group= | ?brand=
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { callMemberSearch, resolveClubCodes } from "@/lib/unpaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  try {
    const clubCodesParam = sp.get("clubCodes");
    const { clubCodes } = await resolveClubCodes({
      scope: user.clubCodes,
      clubCode: sp.get("clubCode"),
      group: sp.get("group"),
      brand: sp.get("brand"),
      clubCodes: clubCodesParam ? clubCodesParam.split(",").map((s) => s.trim()).filter(Boolean) : null,
    });
    if (clubCodes.length === 0) {
      return NextResponse.json({ ok: true, empty: true, schedule: null });
    }
    const schedule = await callMemberSearch({ type: "unpaid_writeoff_schedule", clubCodes: clubCodes.join(",") });
    return NextResponse.json({ ok: true, clubCount: clubCodes.length, schedule });
  } catch (e: any) {
    console.error("[unpaid/writeoff-schedule] error", e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 502 });
  }
}
