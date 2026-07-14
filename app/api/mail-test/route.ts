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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/mail-test
 * テストメールを送信する。
 *   to      : string | string[] (カンマ/改行/セミコロン区切りも可) — 複数宛先対応
 *   subject : 任意。件名
 *   message : 任意。本文(プレーン)。未指定なら既定のテストテンプレ
 *   sendAt  : 任意。JST 'YYYY-MM-DD HH:mm' — 指定するとタイマー(予約)配信
 */
export async function POST(req: NextRequest) {
  try {
    const { to, subject: customSubject, message, sendAt } = await req.json();

    // 宛先を配列へ正規化 (文字列は区切りで分割) + 検証 + 重複排除
    const rawList: string[] = Array.isArray(to)
      ? to.map((x) => String(x))
      : typeof to === "string"
      ? to.split(/[,\n;]+/)
      : [];
    const seen = new Set<string>();
    const recipients = rawList
      .map((s) => s.trim())
      .filter((s) => s && EMAIL_RE.test(s) && !seen.has(s) && seen.add(s));

    if (recipients.length === 0) {
      return NextResponse.json({ ok: false, reason: "有効なメールアドレスを入力してください" }, { status: 400 });
    }

    const sg = initSendGrid();
    if (!sg.ok) {
      return NextResponse.json({ ok: false, reason: sg.reason }, { status: 500 });
    }

    // タイマー配信: JST 'YYYY-MM-DD HH:mm' → unix秒。SendGrid は72時間先まで許容。
    let sendAtUnix: number | undefined;
    if (typeof sendAt === "string" && sendAt.trim()) {
      const ms = Date.parse(sendAt.replace(" ", "T") + "+09:00");
      if (!Number.isFinite(ms)) {
        return NextResponse.json({ ok: false, reason: "配信日時の形式が正しくありません" }, { status: 400 });
      }
      if (ms < Date.now() - 60_000) {
        return NextResponse.json({ ok: false, reason: "配信日時は現在より後を指定してください" }, { status: 400 });
      }
      sendAtUnix = Math.floor(ms / 1000);
    }

    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const custom = typeof message === "string" ? message.trim() : "";

    // 本文HTML: 任意メッセージ or 既定テンプレ
    const html = custom
      ? `<div style="font-family:'Helvetica Neue',Arial,'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;padding:8px;">
          <div style="padding:24px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;color:#374151;line-height:1.7;font-size:15px;">${custom
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</div>
        </div>`
      : `<div style="font-family: 'Helvetica Neue', Arial, 'Noto Sans JP', sans-serif; max-width: 640px; margin: 0 auto; padding: 8px;">
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
              <div style="font-size: 13px; color: #374151;">送信先: ${recipients.join(", ")}</div>
            </div>
            <div style="margin-top: 16px; font-size: 12px; color: #9ca3af;">
              ※ このメールはテスト送信です。返信の必要はありません。
            </div>
          </div>
        </div>`;

    const subject = (typeof customSubject === "string" && customSubject.trim())
      || (custom ? custom.slice(0, 40) : "【KnowBase】メール送信テスト");

    // 複数宛先は sendMultiple で個別配信 (受信者同士にアドレスが見えない)
    await sgMail.sendMultiple({
      to: recipients,
      from: { email: sg.fromEmail, name: "KnowBase運営事務局" },
      subject,
      html,
      ...(sendAtUnix ? { sendAt: sendAtUnix } : {}),
    });

    return NextResponse.json({ ok: true, count: recipients.length, scheduled: !!sendAtUnix });
  } catch (err: any) {
    const detail = err?.response?.body?.errors?.[0]?.message ?? err?.message ?? "不明なエラー";
    console.error("[Mail Test Error]", { name: err?.name, message: err?.message, body: err?.response?.body });
    return NextResponse.json({ ok: false, reason: detail }, { status: 500 });
  }
}
