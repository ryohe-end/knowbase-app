// knowbie-refund-reminder
//
// 返金ワークフローの未対応を毎朝リマインド (EventBridge 日次 9:00 JST)。
//   - 承認待ち(approver step 対応中)   → 該当クラブの承認者へダイジェスト
//   - 経理待ち(finance step 対応中)    → 経理担当へダイジェスト
//   - 差戻し(status 差戻し)             → 申請者へ(自分の差戻し分)
// メールは SendGrid REST(fetch)で送信。npm 依存なし(aws-sdk はランタイム同梱)。
//
// 環境変数: SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, NEXT_PUBLIC_APP_URL,
//           ACCOUNTING_ALLOW_EMAILS(経理の追加宛先), AWS_REGION,
//           REFUND_TABLE(既定 yamauchi-RefundApplications), USERS_TABLE(既定 yamauchi-Users)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const REFUND_TABLE = process.env.REFUND_TABLE || "yamauchi-RefundApplications";
const USERS_TABLE = process.env.USERS_TABLE || "yamauchi-Users";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const FINANCE_ALLOW = (process.env.ACCOUNTING_ALLOW_EMAILS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const normArr = (raw) => {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((x) => (typeof x === "string" ? x : x?.S ?? String(x))).map((s) => String(s).trim()).filter(Boolean);
};

async function scanAll(table) {
  const out = [];
  let lastKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey }));
    for (const it of r.Items || []) out.push(it);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

async function sgSend(emails, subject, html) {
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const to = [...new Set((emails || []).map((e) => String(e).trim()).filter(Boolean))];
  if (!key || !from || to.length === 0) return { sent: 0 };
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: to.map((e) => ({ to: [{ email: e }] })),
      from: { email: from, name: "返金申請ワークフロー" },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });
  if (!res.ok) { console.error("[reminder] sendgrid", res.status, await res.text().catch(() => "")); return { sent: 0 }; }
  return { sent: to.length };
}

const stepState = (it, role) => (it.steps || []).find((s) => s.role === role)?.state;
const link = (path) => (APP_URL ? `${APP_URL}${path}` : "");

function digestHtml(title, color, items, linkPath, linkLabel) {
  const rows = items.map((it) => `
    <tr>
      <td style="padding:6px 10px;border-top:1px solid #f1f5f9;font-family:monospace;color:#94a3b8;">${esc(it.applicationId)}</td>
      <td style="padding:6px 10px;border-top:1px solid #f1f5f9;">${esc(it.memberName)} <span style="color:#94a3b8;">${esc(String(it.clubCode || ""))}</span></td>
      <td style="padding:6px 10px;border-top:1px solid #f1f5f9;text-align:right;font-weight:700;">¥${(it.totalAmount ?? 0).toLocaleString()}</td>
    </tr>`).join("");
  const url = link(linkPath);
  return `
    <div style="font-family:'Helvetica Neue',Arial,'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;padding:8px;">
      <div style="padding:24px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;">
        <h2 style="margin:0 0 4px;font-size:18px;color:${color};">${esc(title)}</h2>
        <p style="font-size:13px;color:#6b7280;margin:0 0 14px;">未対応が <strong>${items.length}件</strong> あります。ご対応をお願いします。</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151;">${rows}</table>
        ${url ? `<p style="margin-top:16px;"><a href="${url}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;">${esc(linkLabel)}</a></p>` : ""}
      </div>
    </div>`;
}

export const handler = async () => {
  const [apps, users] = await Promise.all([scanAll(REFUND_TABLE), scanAll(USERS_TABLE)]);
  const active = users.filter((u) => u.isActive !== false && u.email);

  const approverPending = apps.filter((it) => stepState(it, "approver") === "対応中");
  const financePending = apps.filter((it) => stepState(it, "finance") === "対応中");
  const rejected = apps.filter((it) => it.status === "差戻し");

  const inScope = (clubs, clubCode) => clubs.length === 0 || clubs.includes(String(clubCode));
  const out = { approverMails: 0, financeMails: 0, applicantMails: 0 };

  // 承認者: 各承認者のスコープ内の承認待ちをダイジェスト
  if (approverPending.length > 0) {
    const approvers = active.filter((u) => ["admin", "sv", "approver"].includes(String(u.role || "")));
    for (const u of approvers) {
      const clubs = normArr(u.clubCodes);
      const mine = approverPending.filter((it) => inScope(clubs, it.clubCode) && it.createdBy !== u.userId);
      if (mine.length === 0) continue;
      const r = await sgSend([u.email], `【リマインド】未承認の返金申請 ${mine.length}件`,
        digestHtml("未承認の返金申請があります", "#f59e0b", mine, "/store-settings/refund-payment/refund/approver", "承認画面を開く"));
      out.approverMails += r.sent;
    }
  }

  // 経理: 経理担当全員へ経理待ちダイジェスト
  if (financePending.length > 0) {
    const financeEmails = new Set(FINANCE_ALLOW);
    for (const u of active) {
      if (String(u.role || "") === "finance" || normArr(u.permissions).includes("accounting")) financeEmails.add(String(u.email));
    }
    const r = await sgSend([...financeEmails], `【リマインド】経理処理待ちの返金 ${financePending.length}件`,
      digestHtml("経理処理待ちの返金申請があります", "#2563eb", financePending, "/store-settings/refund-payment/refund/finance", "経理処理を開く"));
    out.financeMails += r.sent;
  }

  // 差戻し: 申請者ごとに自分の差戻し分をダイジェスト
  const byApplicant = new Map();
  for (const it of rejected) {
    const email = (it.steps || []).find((s) => s.role === "applicant")?.email;
    if (!email) continue;
    if (!byApplicant.has(email)) byApplicant.set(email, []);
    byApplicant.get(email).push(it);
  }
  for (const [email, list] of byApplicant) {
    const r = await sgSend([email], `【リマインド】差戻し中の返金申請 ${list.length}件（要 再申請）`,
      digestHtml("差戻し中の返金申請があります", "#dc2626", list, "/store-settings/refund-payment/refund", "返金申請画面を開く"));
    out.applicantMails += r.sent;
  }

  const summary = {
    approverPending: approverPending.length, financePending: financePending.length, rejected: rejected.length, ...out,
  };
  console.log("[refund-reminder]", JSON.stringify(summary));
  return { ok: true, ...summary };
};
