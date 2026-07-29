// lib/refundNotify.ts
// 返金ワークフローの通知 (メール)。SendGrid 経由。送信失敗しても遷移処理は継続する
// (呼び出し側で catch する前提)。
import sgMail from "@sendgrid/mail";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
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

// ── 役割ベース宛先解決 (yamauchi-Users) ──────────────────────────
const REGION = process.env.AWS_REGION || "us-east-1";
const USERS_TABLE = "yamauchi-Users";
const ddbUsers = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const FINANCE_ALLOW = (process.env.ACCOUNTING_ALLOW_EMAILS || "r-endo@okamoto-group.co.jp")
  .split(",").map((s) => s.trim()).filter(Boolean);

function normArr(raw: any): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((x) => (typeof x === "string" ? x : x?.S ?? String(x))).map((s: string) => String(s).trim()).filter(Boolean);
}

async function scanActiveUsers(): Promise<any[]> {
  const out: any[] = [];
  let lastKey: any;
  try {
    do {
      const r: any = await ddbUsers.send(new ScanCommand({
        TableName: USERS_TABLE, ExclusiveStartKey: lastKey,
        ProjectionExpression: "email, #r, clubCodes, #p, isActive",
        ExpressionAttributeNames: { "#r": "role", "#p": "permissions" },
      }));
      for (const u of r.Items || []) out.push(u);
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);
  } catch (e) { console.error("[refundNotify] user scan failed", e); }
  return out;
}

// 承認者(admin/sv/approver)で、対象クラブがスコープ内(clubCodes空=全) の email。
async function resolveApproverEmails(clubCode: string): Promise<string[]> {
  const set = new Set<string>();
  for (const u of await scanActiveUsers()) {
    if (u.isActive === false || !u.email) continue;
    if (!["admin", "sv", "approver"].includes(String(u.role || ""))) continue;
    const clubs = normArr(u.clubCodes);
    if (clubs.length > 0 && !clubs.includes(String(clubCode))) continue;
    set.add(String(u.email));
  }
  return [...set];
}

// 経理(finance role / accounting権限 / 許可メール) の email。
async function resolveFinanceEmails(): Promise<string[]> {
  const set = new Set<string>();
  for (const u of await scanActiveUsers()) {
    if (u.isActive === false || !u.email) continue;
    if (String(u.role || "") === "finance" || normArr(u.permissions).includes("accounting")) set.add(String(u.email));
  }
  for (const e of FINANCE_ALLOW) set.add(e);
  return [...set];
}

// 共通: 複数宛先へ SendGrid 送信 (個別 personalizations)。未設定/宛先0は no-op。
async function sendTo(emails: string[], subject: string, html: string): Promise<void> {
  const sg = initSendGrid();
  if (!sg) return;
  const to = [...new Set(emails.map((e) => String(e).trim()).filter(Boolean))];
  if (to.length === 0) return;
  await sgMail.send({
    from: { email: sg.fromEmail, name: "返金申請ワークフロー" },
    subject, html,
    personalizations: to.map((e) => ({ to: [{ email: e }] })),
  });
}

function appLink(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "";
  return base ? `${base}${path}` : "";
}

function actionCard(title: string, color: string, app: RefundApplication, note: string, linkPath: string, linkLabel: string): string {
  const link = appLink(linkPath);
  return `
    <div style="font-family:'Helvetica Neue',Arial,'Noto Sans JP',sans-serif;max-width:600px;margin:0 auto;padding:8px;">
      <div style="padding:24px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;">
        <h2 style="margin:0 0 16px;font-size:18px;color:${color};">${esc(title)}</h2>
        <table style="font-size:13px;color:#374151;line-height:1.8;border-collapse:collapse;">
          <tr><td style="color:#6b7280;padding-right:16px;">申請ID</td><td>${esc(app.applicationId)}</td></tr>
          <tr><td style="color:#6b7280;padding-right:16px;">店舗</td><td>${esc(String(app.clubCode))}</td></tr>
          <tr><td style="color:#6b7280;padding-right:16px;">会員</td><td>${esc(app.memberName)}（${esc(app.memberNo)}）</td></tr>
          <tr><td style="color:#6b7280;padding-right:16px;">返金額</td><td>¥${(app.totalAmount ?? 0).toLocaleString()}</td></tr>
        </table>
        <p style="font-size:13px;color:#374151;margin:16px 0;">${esc(note)}</p>
        ${link ? `<p><a href="${link}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;">${esc(linkLabel)}</a></p>` : ""}
      </div>
    </div>`;
}

// 申請/再申請 → 承認者へ「承認依頼」
export async function notifyRefundSubmitted(app: RefundApplication): Promise<void> {
  const to = await resolveApproverEmails(String(app.clubCode));
  await sendTo(to, `【承認依頼】返金申請 ${app.applicationId}（${app.memberName}）`,
    actionCard("返金申請の承認をお願いします", "#0f172a", app,
      "新しい返金申請が承認待ちです。内容を確認し、承認または差戻しを行ってください。",
      "/store-settings/refund-payment/refund/approver", "承認画面を開く"));
}

// 承認者承認 → 経理へ「経理処理依頼」
export async function notifyRefundReadyForFinance(app: RefundApplication): Promise<void> {
  const to = await resolveFinanceEmails();
  await sendTo(to, `【経理処理依頼】返金申請 ${app.applicationId}（${app.memberName}）`,
    actionCard("返金の経理処理をお願いします", "#2563eb", app,
      "承認済みの返金申請が経理処理待ちです。CSV出力・振込手配を行ってください。",
      "/store-settings/refund-payment/refund/finance", "経理処理を開く"));
}

// 振込完了 → 申請者へ「完了」
export async function notifyRefundCompleted(app: RefundApplication): Promise<void> {
  const applicant = app.steps?.find((s) => s.role === "applicant");
  if (!applicant?.email) return;
  await sendTo([applicant.email], `【振込完了】返金申請 ${app.applicationId}`,
    actionCard("返金の振込が完了しました", "#059669", app,
      "経理処理が完了し、ご指定口座への返金振込が実行されました。",
      "/store-settings/refund-payment/refund", "返金申請画面を開く"));
}
