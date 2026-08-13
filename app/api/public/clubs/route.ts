// app/api/public/clubs/route.ts
// 公開API: クラブ一覧 (Oracle adb01 FIT_ADMIN.クラブ情報)。x-api-key 認証。
// 返却: クラブ(コード) / クラブ名称 / ブランド(FIT365|JOYFIT) / 業態(businessType) / 閉店フラグ(closed)。
//   ※ 閉店店舗も含めて返す(既定)。開店のみ欲しい場合は includeClosed=0。
//   ※ 住所・都道府県は現状データ未整備のため返しません(揃い次第 別途追加)。
//   GET /api/public/clubs                     … 全店(閉店含む)
//   GET /api/public/clubs?includeClosed=0     … 開店のみ
//   GET /api/public/clubs?clubCode=375        … 1店
//   GET /api/public/clubs?brand=FIT365|JOYFIT … ブランド絞り込み
import { NextResponse } from "next/server";
import { callMemberSearch } from "@/lib/unpaid";
import { requirePublicApiKey } from "@/lib/publicApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 業態(赤/青/緑/FIT365/ｼﾞｮｲﾌｨｯﾄﾌﾟﾗｽ 等)から消費者ブランドを正規化。
// FIT365 のみ FIT365、それ以外(JOYFIT系の色コード等)は JOYFIT。
function brandOf(businessType?: string | null): "FIT365" | "JOYFIT" {
  return String(businessType || "").toUpperCase().startsWith("FIT365") ? "FIT365" : "JOYFIT";
}

export async function GET(req: Request) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;
  const sp = new URL(req.url).searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  const brand = (sp.get("brand") || "").trim().toUpperCase();
  const includeClosed = (sp.get("includeClosed") || "1").trim() !== "0"; // 既定: 閉店も含む

  try {
    const data = await callMemberSearch({ type: "clubs-list" });
    let clubs = (data?.clubs || []).map((r: any) => {
      const businessType = r.GYOTAI ?? null; // 業態(生値)
      return {
        clubCode: String(r.CODE),
        clubName: r.NAME ?? null, // クラブ名称
        brand: brandOf(businessType), // ブランド
        businessType, // 業態
        closed: r.CLOSED === 1, // 閉店フラグ (1=閉店)
      };
    });

    if (clubCode) {
      const one = clubs.find((x: any) => x.clubCode === clubCode);
      if (!one) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, club: one });
    }

    if (!includeClosed) clubs = clubs.filter((c: any) => !c.closed);
    if (brand === "FIT365" || brand === "JOYFIT") clubs = clubs.filter((c: any) => c.brand === brand);
    clubs.sort((a: any, b: any) => (Number(a.clubCode) - Number(b.clubCode)) || a.clubCode.localeCompare(b.clubCode));

    const closedCount = clubs.filter((c: any) => c.closed).length;
    return NextResponse.json({ ok: true, count: clubs.length, openCount: clubs.length - closedCount, closedCount, clubs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "member_search_error" }, { status: 502 });
  }
}
