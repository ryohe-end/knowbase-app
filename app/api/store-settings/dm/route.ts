// app/api/store-settings/dm/route.ts
//
// DM(メール)配信の本番実装。SendGrid で個別一括送信する。
// 宛先は2系統: (1) 会員抽出(/members/extract deliveryType=dm, 個人テーブルのメール)
//              (2) CSV アップロード(会員番号/メール/氏名)
// どちらもフロントで宛先リスト(recipients)に集約してここへ渡す。
//
// - isDraft=true: 送信せず OK を返す(下書き。DM履歴の永続化は今回スコープ外)
// - scheduledAt(JST): 指定時は SendGrid の send_at で予約送信
// - 画像は本文HTMLに <img> で埋め込む
// - 担当外クラブ(clubCode)への送信は 403
import { NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import { getSessionUser } from "@/lib/auth";
import {
  createCampaign,
  updateCampaignSendResult,
  listCampaigns,
  newCampaignId,
  type DmCampaign,
} from "@/lib/dmStore";
import type { DmNotification } from "@/types/dmNotification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BATCH = 1000; // SendGrid personalizations 上限

function initSendGrid(): { ok: true; fromEmail: string } | { ok: false; reason: string } {
  const key = (process.env.SENDGRID_API_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!key || !key.startsWith("SG.")) return { ok: false, reason: "SENDGRID_API_KEY 不正" };
  const fromEmail = (process.env.SENDGRID_FROM_EMAIL ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!fromEmail) return { ok: false, reason: "SENDGRID_FROM_EMAIL 未設定" };
  sgMail.setApiKey(key);
  return { ok: true, fromEmail };
}

function buildHtml(subject: string, body: string, imageUrl?: string): string {
  const safeBody = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  const img = imageUrl
    ? `<img src="${imageUrl}" alt="" style="max-width:100%;height:auto;border-radius:8px;margin-bottom:16px;" />`
    : "";
  return `<div style="font-family:'Helvetica Neue',Arial,'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;padding:8px;">
    <div style="padding:24px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;">
      ${img}
      <h2 style="margin:0 0 16px;font-size:18px;color:#1e293b;">${subject}</h2>
      <div style="color:#374151;line-height:1.7;font-size:14px;">${safeBody}</div>
    </div>
  </div>`;
}

// bodyHtml(AI生成など)に画像が含まれていない場合でも、アップロード画像を
// 確実にメール先頭へ埋め込む。SendGrid配信時に画像が抜けるのを防ぐ。
function ensureImage(html: string, imageUrl?: string): string {
  if (!imageUrl) return html;
  if (html.includes(imageUrl)) return html; // 既に埋め込み済み
  const img = `<img src="${imageUrl}" alt="" style="max-width:100%;height:auto;border-radius:8px;margin-bottom:16px;" />`;
  return img + html;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// DM 履歴一覧。DynamoDB のキャンペーン集計を DmNotification 形にして返す。
// stats は SendGrid Event Webhook (app/api/webhooks/sendgrid) が更新した実データ。
function campaignToNotification(c: DmCampaign): DmNotification {
  return {
    id: c.campaignId,
    subject: c.subject,
    body: c.body || "",
    imageUrl: c.imageUrl,
    targetType: "ALL",
    status: c.status === "scheduled" ? "SCHEDULED" : "SENT",
    scheduledAt: c.scheduledAt || c.sentAt || c.createdAt,
    createdAt: c.createdAt,
    stats: {
      targetCount: c.targetCount,
      deliveredCount: c.delivered ?? 0,
      openCount: c.opens ?? 0,
      errorCount: (c.bounces ?? 0) + (c.dropped ?? 0),
      uniqueOpenCount: c.uniqueOpens,
      clickCount: c.clicks,
      uniqueClickCount: c.uniqueClicks,
      spamReportCount: c.spamReports,
      unsubscribeCount: c.unsubscribes,
      lastEventAt: c.lastEventAt,
    },
  };
}

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const campaigns = await listCampaigns({ clubCodes: user.clubCodes });
    return NextResponse.json({ notifications: campaigns.map(campaignToNotification) });
  } catch (e: any) {
    // テーブル未作成などでも画面を落とさない (空一覧で返す)
    console.error("[dm GET] listCampaigns failed:", e?.message || e);
    return NextResponse.json({ notifications: [] });
  }
}

interface Recipient {
  email?: string;
  name?: string;
}
interface DmPostBody {
  clubCode?: string;
  brand?: string;
  subject?: string;
  body?: string;
  bodyHtml?: string; // AI生成などの完成HTML。あればこれをそのまま送る。
  imageUrl?: string;
  recipients?: Recipient[];
  isImmediate?: boolean;
  scheduledAt?: string; // JST 'YYYY-MM-DD HH:mm'
  isDraft?: boolean;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: DmPostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const clubCode = (body.clubCode || "").trim();
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  if (user.clubCodes.length > 0 && !user.clubCodes.includes(clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
  }

  const subject = (body.subject || "").trim();
  const content = (body.body || "").trim();
  if (!subject || !content) {
    return NextResponse.json({ ok: false, error: "subject and body are required" }, { status: 400 });
  }

  // 宛先の正規化・重複排除・メール検証
  const seen = new Set<string>();
  const recipients = (Array.isArray(body.recipients) ? body.recipients : [])
    .map((r) => ({ email: (r.email || "").trim(), name: (r.name || "").trim() }))
    .filter((r) => EMAIL_RE.test(r.email) && !seen.has(r.email) && seen.add(r.email));

  if (recipients.length === 0) {
    return NextResponse.json({ ok: false, error: "有効な宛先メールがありません" }, { status: 400 });
  }

  // 下書き: 送信せず件数だけ返す
  if (body.isDraft) {
    return NextResponse.json({ ok: true, draft: true, targetCount: recipients.length });
  }

  const sg = initSendGrid();
  if (!sg.ok) return NextResponse.json({ ok: false, error: sg.reason }, { status: 500 });

  // 予約送信 (JST → unix秒)。SendGrid は72時間先まで許容。
  let sendAt: number | undefined;
  if (!body.isImmediate && body.scheduledAt) {
    const ms = Date.parse(body.scheduledAt.replace(" ", "T") + "+09:00");
    if (Number.isFinite(ms)) sendAt = Math.floor(ms / 1000);
  }

  // 完成HTML(AI生成)があればそのまま、無ければ件名/本文/画像から組み立てる。
  // どちらの経路でもアップロード画像が必ずメールに載るよう ensureImage で保証する。
  const html = ensureImage(
    body.bodyHtml && body.bodyHtml.trim()
      ? body.bodyHtml
      : buildHtml(subject, content, body.imageUrl),
    body.imageUrl
  );
  const fromName = `${(body.brand || "").toUpperCase().startsWith("JOYFIT") ? "JOYFIT" : "FIT365"} サポート`;

  // キャンペーンを作成 (開封率集計の紐付けキー)。ベストエフォート:
  // DynamoDB 未整備でも送信自体は継続する。
  const now = new Date();
  const campaignId = newCampaignId(now);
  try {
    await createCampaign({
      campaignId,
      clubCode,
      brand: body.brand,
      subject,
      body: content,
      imageUrl: body.imageUrl,
      createdBy: user.email,
      createdByName: (user as any).name,
      targetCount: recipients.length,
      sentCount: 0,
      status: sendAt ? "scheduled" : "sending",
      scheduledAt: sendAt ? body.scheduledAt : undefined,
      createdAt: now.toISOString(),
    } as DmCampaign);
  } catch (e: any) {
    console.error("[dm POST] createCampaign failed (集計は無効化して送信継続):", e?.message || e);
  }

  let sent = 0;
  const errors: string[] = [];
  for (const group of chunk(recipients, BATCH)) {
    try {
      await sgMail.sendMultiple({
        to: group.map((r) => r.email),
        from: { email: sg.fromEmail, name: fromName },
        subject,
        html,
        ...(sendAt ? { sendAt } : {}),
        // 開封率集計用: イベントに campaign_id を echo させる + トラッキング有効化
        customArgs: { campaign_id: campaignId },
        categories: ["dm", clubCode],
        trackingSettings: {
          openTracking: { enable: true },
          clickTracking: { enable: true, enableText: false },
        },
      });
      sent += group.length;
    } catch (e: any) {
      console.error("[dm POST] sendMultiple failed:", e?.message || e);
      errors.push(String(e?.message || e));
    }
  }

  // 送信結果をキャンペーンへ反映 (ベストエフォート)
  try {
    await updateCampaignSendResult(campaignId, {
      status: sent === 0 ? "failed" : sendAt ? "scheduled" : "sent",
      sentCount: sent,
      sentAt: sendAt ? undefined : now.toISOString(),
    });
  } catch (e: any) {
    console.error("[dm POST] updateCampaignSendResult failed:", e?.message || e);
  }

  if (sent === 0) {
    return NextResponse.json({ ok: false, error: "send_failed", detail: errors[0] }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    campaignId,
    targetCount: recipients.length,
    sentCount: sent,
    scheduled: !!sendAt,
    errorCount: recipients.length - sent,
  });
}
