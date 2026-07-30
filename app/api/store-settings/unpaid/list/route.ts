// app/api/store-settings/unpaid/list/route.ts
// 未納者一覧 / CSV出力の元データ。member-search(振替契約別) から会員単位で取得。
//   ?clubCode= 必須
//   ?bucket=current(既定, 貸倒予定除外) | writeoff(貸倒予定=強制退会) | paid(振替失敗→入金)
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { callMemberSearch } from "@/lib/unpaid";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface UnpaidMember {
  memberNo: string;
  memberName: string | null;
  kana: string | null;
  email: string | null;
  phone: string | null;
  clubCode: string | null;
  plan: string | null;                 // ① 会員区分 = 会員区分1(基本会費)の契約形態名
  status: string;                      // ② 1か月目/2か月目/貸倒予定
  outstanding: number;                 // ④ 未納合計
  unpaidCount: number;
  unpaidMonths: number;
  monthlyBreakdown: { month: string; amount: number }[]; // ④ 月別内訳
  // 契約形態別内訳: 基本会費(区分1)＋オプション(区分90等)ごとの 会費金額・未納純額
  formBreakdown: { formName: string; planCode: number | null; isBase: boolean; feeAmount: number; outstanding: number }[];
  annualFeeTotal: number;              // ⑦ FIT365 セキュリティ費(=年管理費)
  hasSecurityFee: boolean;
  contractCount: number;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  const clubCodesParam = (sp.get("clubCodes") || "").trim();
  const bucket = sp.get("bucket") || "current";
  // reason=csv は CSV出力(PII持ち出し)。一覧表示の再描画ノイズと区別して監査アクションを分ける。
  const isCsv = sp.get("reason") === "csv";

  // 単一 or 複数(エリアCSV)。全て担当スコープ内であることを検証。
  let clubs = clubCodesParam ? clubCodesParam.split(",").map((s) => s.trim()).filter(Boolean) : (clubCode ? [clubCode] : []);
  if (clubs.length === 0) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  if (user.clubCodes.length > 0) {
    const scope = new Set(user.clubCodes);
    clubs = clubs.filter((c) => scope.has(c));
    if (clubs.length === 0) return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
  }

  const typeMap: Record<string, string> = {
    current: "unpaid_current",
    writeoff: "unpaid_writeoff",
    paid: "unpaid_paid",
  };
  const type = typeMap[bucket] || "unpaid_current";

  try {
    const data = await callMemberSearch({ type, clubCodes: clubs.join(",") });
    void writeAudit({
      userId: (user as any).email || (user as any).userId || "unknown",
      userName: (user as any).name,
      action: isCsv ? "unpaid.csv" : "unpaid.list",
      clubCodes: clubs,
      targetCount: bucket === "paid" ? (data.items?.length ?? 0) : (data.totalMembers ?? 0),
      detail: { bucket, ...(isCsv ? { reason: "csv" } : {}) },
      ip: clientIp(req),
    });
    if (bucket === "paid") {
      return NextResponse.json({ ok: true, bucket, items: data.items ?? [] });
    }
    return NextResponse.json({
      ok: true,
      bucket,
      members: (data.members ?? []) as UnpaidMember[],
      totalMembers: data.totalMembers ?? 0,
      totalOutstanding: data.totalOutstanding ?? 0,
    });
  } catch (e: any) {
    console.error("[unpaid/list] error", e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 502 });
  }
}
