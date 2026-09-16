// app/api/public/enrollmentMail/route.ts
// 公開API: 入会完了メール送信。外部の入会システムが、入会完了時に campaignId(店舗のCP) と
// 会員のメールアドレス・差し込み変数を渡すと、KnowBase上でCP単位に設定された件名/本文を
// 差し込み描画して SendGrid で送信する。
//   認証: x-api-key ヘッダ(KB_PUBLIC_API_KEY と照合)
//   メソッド: POST
//   リクエスト(JSON): { campaignId, email, variables?: { name, clubName, ... } }
//   レスポンス(JSON): { ok, sent, campaignId, to, subject, messageId? } / エラー時 { ok:false, error }
import { NextResponse } from "next/server";
import { requirePublicApiKey } from "@/lib/publicApiAuth";
import { getCampaign, sendEnrollmentMail } from "@/lib/storeCampaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;

  let body: { campaignId?: string; email?: string; variables?: Record<string, any> } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }

  const campaignId = String(body.campaignId ?? "").trim();
  const email = String(body.email ?? "").trim();
  const variables = (body.variables && typeof body.variables === "object") ? body.variables : {};
  if (!campaignId) return NextResponse.json({ ok: false, error: "campaignId required" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: "valid email required" }, { status: 400 });

  let campaign;
  try {
    campaign = await getCampaign(campaignId);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "campaign_lookup_failed", message: e?.message || null }, { status: 502 });
  }
  if (!campaign) return NextResponse.json({ ok: false, error: "campaign_not_found", campaignId }, { status: 404 });
  if (campaign.enabled === false) {
    return NextResponse.json({ ok: false, sent: false, error: "campaign_disabled", campaignId }, { status: 409 });
  }

  const result = await sendEnrollmentMail({ campaign, email, variables });
  if (!result.ok) {
    return NextResponse.json({ ok: false, sent: false, campaignId, to: email, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true, campaignId, clubCode: campaign.clubCode, to: result.to, subject: result.subject, messageId: result.messageId });
}
