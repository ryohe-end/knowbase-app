// app/api/store-settings/dm/test/route.ts
//
// DMのテスト送信。指定した複数メールアドレスに、作成中の内容をそのまま送る(本番配信の事前確認用)。
// キャンペーン集計・開封トラッキングはせず、件名に[テスト]を付与。差出人はブランド別。
//   POST { toEmails: string[](またはtoEmail/カンマ改行区切り), subject, body, bodyHtml?, imageUrl?, brand }  → { ok, sent }
import { NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import { getSessionUser } from "@/lib/auth";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEnv = (v?: string) => (v ?? "").trim().replace(/^['"]|['"]$/g, "");
function attrEscape(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildHtml(subject: string, body: string, imageUrl?: string): string {
  const safeBody = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  const img = imageUrl ? `<img src="${attrEscape(imageUrl)}" alt="" style="max-width:100%;height:auto;border-radius:8px;margin-bottom:16px;" />` : "";
  return `<div style="font-family:'Helvetica Neue',Arial,'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;padding:8px;">
    <div style="padding:24px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;">${img}
      <h2 style="margin:0 0 16px;font-size:18px;color:#1e293b;">${subject}</h2>
      <div style="color:#374151;line-height:1.7;font-size:14px;">${safeBody}</div>
    </div></div>`;
}
function fromEmailForBrand(brand: string | undefined, fallback: string): string {
  const isJoyfit = String(brand || "").toUpperCase().startsWith("JOYFIT");
  return cleanEnv(isJoyfit ? process.env.SENDGRID_FROM_EMAIL_JOYFIT : process.env.SENDGRID_FROM_EMAIL_FIT365) || fallback;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  // 複数アドレス: 配列 or カンマ/改行/空白区切り文字列を受け付ける
  const raw: string[] = Array.isArray(body?.toEmails) ? body.toEmails : String(body?.toEmails || body?.toEmail || "").split(/[\s,;、]+/);
  const seen = new Set<string>();
  const toEmails = raw.map((e) => String(e).trim().toLowerCase()).filter((e) => e && !seen.has(e) && seen.add(e));
  const invalid = toEmails.filter((e) => !EMAIL_RE.test(e));
  if (toEmails.length === 0) return NextResponse.json({ ok: false, error: "テスト送信先のメールアドレスを入力してください" }, { status: 400 });
  if (invalid.length > 0) return NextResponse.json({ ok: false, error: `不正なメールアドレス: ${invalid.slice(0, 5).join(", ")}` }, { status: 400 });
  if (toEmails.length > 50) return NextResponse.json({ ok: false, error: "テスト送信は50件までにしてください" }, { status: 400 });
  const subject = String(body?.subject || "").trim();
  const content = String(body?.body || "").trim();
  if (!subject || !content) return NextResponse.json({ ok: false, error: "件名と本文を入力してください" }, { status: 400 });

  const key = cleanEnv(process.env.SENDGRID_API_KEY);
  const fallbackFrom = cleanEnv(process.env.SENDGRID_FROM_EMAIL);
  if (!key.startsWith("SG.") || !fallbackFrom) return NextResponse.json({ ok: false, error: "SendGrid未設定" }, { status: 500 });
  sgMail.setApiKey(key);

  const html = body?.bodyHtml && String(body.bodyHtml).trim() ? String(body.bodyHtml) : buildHtml(subject, content, body?.imageUrl);
  const fromName = `${String(body?.brand || "").toUpperCase().startsWith("JOYFIT") ? "JOYFIT" : "FIT365"} サポート`;
  const fromEmail = fromEmailForBrand(body?.brand, fallbackFrom);

  try {
    await sgMail.sendMultiple({
      to: toEmails,
      from: { email: fromEmail, name: fromName },
      subject: `[テスト] ${subject}`,
      html,
      // テストは集計しない(campaign_id無し) / トラッキングは無効
      trackingSettings: { openTracking: { enable: false }, clickTracking: { enable: false } },
      mailSettings: { bypassListManagement: { enable: true } },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `テスト送信に失敗しました: ${e?.message || e}` }, { status: 502 });
  }
  void writeAudit({
    userId: (user as any).email || (user as any).userId || "unknown", userName: (user as any).name,
    action: "dm.test", targetCount: toEmails.length, detail: { subject, brand: body?.brand, from: fromEmail, count: toEmails.length }, ip: clientIp(req),
  });
  return NextResponse.json({ ok: true, sent: toEmails.length, from: fromEmail });
}
