export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";

function initSendGrid(): { ok: true; fromEmail: string } | { ok: false; reason: string } {
  const raw = process.env.SENDGRID_API_KEY ?? "";
  const key = raw.trim().replace(/^['"]|['"]$/g, "");

  if (!key) return { ok: false, reason: "SENDGRID_API_KEY が設定されていません" };
  if (!key.startsWith("SG."))
    return { ok: false, reason: "SENDGRID_API_KEY が SG. で始まっていません（値が不正）" };

  const fromEmailRaw = process.env.SENDGRID_FROM_EMAIL ?? "";
  const fromEmail = fromEmailRaw.trim().replace(/^['"]|['"]$/g, "");
  if (!fromEmail) return { ok: false, reason: "SENDGRID_FROM_EMAIL が設定されていません" };

  sgMail.setApiKey(key);
  return { ok: true, fromEmail };
}

/**
 * GET /api/mail-test
 * SendGrid の環境変数が正しく設定されているかチェック（送信はしない）
 */
export async function GET() {
  const sg = initSendGrid();
  if (!sg.ok) {
    return NextResponse.json({ ok: false, reason: sg.reason });
  }
  return NextResponse.json({ ok: true, fromEmail: sg.fromEmail });
}

/**
 * POST /api/mail-test
 * テストメールを送信する
 */
export async function POST(req: NextRequest) {
  try {
    const { to } = await req.json();

    if (!to || typeof to !== "string" || !to.includes("@")) {
      return NextResponse.json({ ok: false, reason: "有効なメールアドレスを入力してください" }, { status: 400 });
    }

    const sg = initSendGrid();
    if (!sg.ok) {
      return NextResponse.json({ ok: false, reason: sg.reason }, { status: 500 });
    }

    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    const msg = {
      to: to.trim(),
      from: { email: sg.fromEmail, name: "KnowBase運営事務局" },
      subject: "【KnowBase】メール送信テスト",
      html: `
        <div style="font-family: 'Helvetica Neue', Arial, 'Noto Sans JP', sans-serif; max-width: 640px; margin: 0 auto; padding: 8px;">
          <div style="padding: 24px; border: 1px solid #e5e7eb; border-radius: 14px; background: #ffffff;">
            <h2 style="margin: 0 0 16px; font-size: 18px; color: #1e293b;">KnowBase メール送信テスト</h2>
            <p style="margin: 0 0 12px; color: #374151; line-height: 1.6;">
              このメールは KnowBase のメール送信テストです。<br>
              このメールが届いていれば、SendGrid の設定は正常です。
            </p>
            <div style="margin: 16px 0; padding: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px;">
              <div style="font-weight: 700; color: #166534; margin-bottom: 4px;">送信情報</div>
              <div style="font-size: 13px; color: #374151;">送信日時: ${now}</div>
              <div style="font-size: 13px; color: #374151;">送信元: ${sg.fromEmail}</div>
              <div style="font-size: 13px; color: #374151;">送信先: ${to.trim()}</div>
            </div>
            <div style="margin-top: 16px; font-size: 12px; color: #9ca3af;">
              ※ このメールはテスト送信です。返信の必要はありません。
            </div>
          </div>
        </div>
      `,
    };

    await sgMail.send(msg);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const detail = err?.response?.body?.errors?.[0]?.message ?? err?.message ?? "不明なエラー";
    console.error("[Mail Test Error]", { name: err?.name, message: err?.message, body: err?.response?.body });
    return NextResponse.json({ ok: false, reason: detail }, { status: 500 });
  }
}
