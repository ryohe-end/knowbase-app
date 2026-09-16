// lib/storeCampaigns.ts
// 店舗ごとのキャンペーン(CP)＋入会完了メールの管理と送信。
// - 管理: DynamoDB knowbie-store-campaigns (PK=campaignId, GSI clubCode-index)。店舗設定画面から CRUD。
// - 送信: 外部の入会システムが campaignId + email + variables を公開API(/api/public/enrollmentMail)へ渡すと、
//         当該CPの件名/本文を差し込み描画して SendGrid で送る。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import sgMail from "@sendgrid/mail";

const REGION = process.env.AWS_REGION || "us-east-1";
export const CAMPAIGNS_TABLE = process.env.STORE_CAMPAIGNS_TABLE || "knowbie-store-campaigns";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface StoreCampaign {
  campaignId: string;   // 一意ID (cp-xxxxxxxx)。入会システムがAPIに渡す
  clubCode: string;     // 店舗コード
  name: string;         // CP名(管理用)
  enabled: boolean;     // 有効/無効(無効なら送信しない)
  subject: string;      // メール件名({{var}}使用可)
  bodyHtml: string;     // メール本文HTML({{var}}使用可)
  fromName?: string;    // 差出人表示名(既定: 運営事務局)
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

function strArrToItem(c: StoreCampaign): StoreCampaign { return c; }

// ---- CRUD ----
export async function getCampaign(campaignId: string): Promise<StoreCampaign | null> {
  const r = await ddb.send(new GetCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId } }));
  return (r.Item as StoreCampaign) || null;
}

export async function listCampaignsByClub(clubCode: string): Promise<StoreCampaign[]> {
  const r = await ddb.send(new QueryCommand({
    TableName: CAMPAIGNS_TABLE, IndexName: "clubCode-index",
    KeyConditionExpression: "clubCode = :c", ExpressionAttributeValues: { ":c": String(clubCode) },
  }));
  const items = (r.Items as StoreCampaign[]) || [];
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return items;
}

export async function listCampaignsAll(): Promise<StoreCampaign[]> {
  const items: StoreCampaign[] = [];
  let key: any;
  do {
    const r: any = await ddb.send(new ScanCommand({ TableName: CAMPAIGNS_TABLE, ExclusiveStartKey: key }));
    if (Array.isArray(r.Items)) items.push(...(r.Items as StoreCampaign[]));
    key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

export async function saveCampaign(input: Partial<StoreCampaign> & { clubCode: string; name: string; subject: string; bodyHtml: string }, actor?: string): Promise<StoreCampaign> {
  const now = new Date().toISOString();
  const isNew = !input.campaignId;
  let existing: StoreCampaign | null = null;
  if (!isNew) existing = await getCampaign(String(input.campaignId));
  const c: StoreCampaign = {
    campaignId: isNew ? `cp-${randomUUID().slice(0, 8)}` : String(input.campaignId),
    clubCode: String(input.clubCode),
    name: String(input.name).trim(),
    enabled: input.enabled !== false,
    subject: String(input.subject),
    bodyHtml: String(input.bodyHtml),
    fromName: input.fromName ? String(input.fromName).trim() : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: existing?.createdBy ?? actor,
  };
  await ddb.send(new PutCommand({ TableName: CAMPAIGNS_TABLE, Item: strArrToItem(c) }));
  return c;
}

export async function deleteCampaign(campaignId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId } }));
}

// ---- 差し込み描画 ----
// {{key}} を variables[key] で置換。未指定の変数は空文字。HTMLエスケープしてインジェクションを防ぐ。
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}
export function renderTemplate(template: string, variables: Record<string, any> = {}, escape = true): string {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = variables[key];
    if (v === undefined || v === null) return "";
    return escape ? escapeHtml(String(v)) : String(v);
  });
}

// ---- 送信 ----
export interface SendResult { ok: boolean; sent: boolean; to: string; subject: string; error?: string; messageId?: string }

export async function sendEnrollmentMail(opts: { campaign: StoreCampaign; email: string; variables?: Record<string, any> }): Promise<SendResult> {
  const key = (process.env.SENDGRID_API_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");
  const from = (process.env.SENDGRID_FROM_EMAIL ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!key.startsWith("SG.") || !from) return { ok: false, sent: false, to: opts.email, subject: "", error: "SendGrid 未設定" };
  const email = String(opts.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, sent: false, to: email, subject: "", error: "invalid email" };

  const vars = opts.variables || {};
  // 件名はエスケープ不要(プレーン)、本文はHTMLエスケープ。
  const subject = renderTemplate(opts.campaign.subject, vars, false);
  const html = renderTemplate(opts.campaign.bodyHtml, vars, true);

  sgMail.setApiKey(key);
  try {
    const [res] = await sgMail.send({
      to: email,
      from: { email: from, name: opts.campaign.fromName || "運営事務局" },
      subject,
      html,
      trackingSettings: { openTracking: { enable: false }, clickTracking: { enable: false } },
      categories: ["enrollment-mail", `cp:${opts.campaign.campaignId}`],
    });
    const messageId = (res?.headers?.["x-message-id"] as string) || undefined;
    return { ok: true, sent: true, to: email, subject, messageId };
  } catch (e: any) {
    const msg = e?.response?.body ? JSON.stringify(e.response.body).slice(0, 300) : (e?.message || String(e));
    return { ok: false, sent: false, to: email, subject, error: msg };
  }
}
