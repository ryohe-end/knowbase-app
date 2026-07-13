// app/api/store-settings/unpaid/month-detail/route.ts
// 未納ダッシュボード 月次ドリルダウン。指定月の 未納者(入金区分4) と 後日回収者(区分3) を返す。
//   ?clubCode= | ?clubCodes= (エリア) & ?ym=YYYYMM
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { callMemberSearch, resolveClubCodes } from "@/lib/unpaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const ym = (sp.get("ym") || "").replace("-", "").trim();
  if (!/^\d{6}$/.test(ym)) return NextResponse.json({ ok: false, error: "ym (YYYYMM) required" }, { status: 400 });

  const clubCodesParam = sp.get("clubCodes");
  try {
    const { clubCodes } = await resolveClubCodes({
      scope: user.clubCodes,
      clubCode: sp.get("clubCode"),
      group: sp.get("group"),
      brand: sp.get("brand"),
      clubCodes: clubCodesParam ? clubCodesParam.split(",").map((s) => s.trim()).filter(Boolean) : null,
    });
    if (clubCodes.length === 0) return NextResponse.json({ ok: true, ym, unpaid: [], recovered: [] });
    const data = await callMemberSearch({ type: "unpaid_month_detail", clubCodes: clubCodes.join(","), ym });
    return NextResponse.json({ ok: true, ym, unpaid: data.unpaid ?? [], recovered: data.recovered ?? [] });
  } catch (e: any) {
    console.error("[unpaid/month-detail] error", e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 502 });
  }
}
