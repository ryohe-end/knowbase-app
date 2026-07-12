// lib/refundNotify.ts
// 返金ワークフローの通知 (メール)。SendGrid 経由。送信失敗しても遷移処理は継続する
// (呼び出し側で catch する前提)。
import sgMail from "@sendgrid/mail";
import type { RefundApplication } from "@/types/refundApplication";

function initSendGrid(): { fromEmail: string } | null {
  const key = (process.env.SENDGRID_API_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!key || !key.startsWith("SG.")) return null;
  const fromEmail = (process.env.SENDGRID_FROM_EMAIL ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!fromEmail) return null;
  sgMail.setApiKey(key);
  return { fromEmail };
}

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 差戻し → 申請者へ通知。applicant ステップの email 宛に送る。
 * SendGrid 未設定 / 宛先不明時は何もしない (no-op)。
 */
export async function notifyRefundRejected(app: RefundApplication, comment: string): Promise<void> {
  const sg = initSendGrid();
  if (!sg) return;
  const applicant = app.steps?.find((s) => s.role === "applicant");
  const to = applicant?.email;
  if (!to) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const link = appUrl ? `${appUrl}/store-settings/refund-payment/refund` : "";

  await sgMail.send({
    to,
    from: { email: sg.fromEmail, name: "返金申請ワークフロー" },
    subject: `【差戻し】返金申請 ${app.applicationId} が差戻されました`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,'Noto Sans JP',sans-serif;max-width:600px;margin:0 auto;padding:8px;">
        <div style="padding:24px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;">
          <h2 style="margin:0 0 16px;font-size:18px;color:#b91c1c;">返金申請が差戻されました</h2>
          <table style="font-size:13px;color:#374151;line-height:1.8;border-collapse:collapse;">
            <tr><td style="color:#6b7280;padding-right:16px;">申請ID</td><td>${esc(app.applicationId)}</td></tr>
            <tr><td style="color:#6b7280;padding-right:16px;">会員</td><td>${esc(app.memberName)}（${esc(app.memberNo)}）</td></tr>
            <tr><td style="color:#6b7280;padding-right:16px;">返金額</td><td>¥${(app.totalAmount ?? 0).toLocaleString()}</td></tr>
          </table>
          <div style="margin:16px 0;padding:12px;background:#fef2f2;border:1px solid #fee2e2;border-radius:10px;">
            <div style="font-weight:700;color:#991b1b;margin-bottom:4px;">差戻し理由</div>
            <div style="font-size:13px;color:#374151;white-space:pre-wrap;">${esc(comment)}</div>
          </div>
          <p style="font-size:13px;color:#374151;">内容を修正のうえ、再申請してください。</p>
          ${link ? `<p><a href="${link}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;">返金申請画面を開く</a></p>` : ""}
        </div>
      </div>`,
  });
}
