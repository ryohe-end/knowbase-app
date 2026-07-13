// app/api/store-settings/members/contract-forms/route.ts
// ターゲット抽出の「契約形態」母集合。会員区分に紐づく契約形態(契約形態名)を
// member-search(Oracle: 会員契約明細→契約形態) から取得する。
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { callMemberSearch } from "@/lib/unpaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const clubCode = (new URL(req.url).searchParams.get("clubCode") || "").trim();
  if (!clubCode) {
    return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  }
  if (user.clubCodes.length > 0 && !user.clubCodes.includes(clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
  }

  try {
    const data = await callMemberSearch({ type: "contract_forms", clubCode });
    const results: Array<any> = Array.isArray(data?.results) ? data.results : [];
    return NextResponse.json({
      ok: true,
      clubCode,
      contractForms: results.map((r) => ({
        code: String(r.code ?? ""),
        name: String(r.name ?? "").trim(),
        planCode: String(r.planCode ?? ""),
        planName: String(r.planName ?? "").trim(),
        totalCount: Number(r.totalCount ?? 0),
        activeCount: Number(r.activeCount ?? 0),
      })).filter((r) => r.name),
    });
  } catch (e: any) {
    console.error("[contract-forms] error", e?.message || e);
    return NextResponse.json({ ok: false, error: "member_search_failed" }, { status: 502 });
  }
}
