// app/api/store-settings/members/contract-types/route.ts
// ターゲット抽出の「契約種別」母集合。
// 指定店舗(clubCode)に属する契約種別(会員区分)を member-search(Oracle) から取得する。
// フロントの契約種別サジェスト/フィルタの選択肢になる。
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
  // 担当外クラブは禁止 (clubCodes 空 = admin 全クラブ)
  if (user.clubCodes.length > 0 && !user.clubCodes.includes(clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
  }

  try {
    const data = await callMemberSearch({ type: "contract_types", clubCode });
    const results: Array<{ code: string; name: string; totalCount: number; activeCount: number }> =
      Array.isArray(data?.results) ? data.results : [];
    return NextResponse.json({
      ok: true,
      clubCode,
      contractTypes: results.map((r) => ({
        code: String(r.code ?? ""),
        name: String(r.name ?? "").trim(),
        totalCount: Number(r.totalCount ?? 0),
        activeCount: Number(r.activeCount ?? 0),
      })).filter((r) => r.name && !["7", "8", "9", "90"].includes(r.code)), // スタッフ(7)/タイム会員(8)/他店舗会員(9)/オプション契約(90)は除外
    });
  } catch (e: any) {
    console.error("[contract-types] error", e?.message || e);
    return NextResponse.json({ ok: false, error: "member_search_failed" }, { status: 502 });
  }
}
