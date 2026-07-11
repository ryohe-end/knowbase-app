// app/api/webhooks/sendgrid/route.ts
//
// SendGrid Event Webhook 受信口。delivered/open/click/bounce/dropped 等の
// 配信イベントを受け取り、DM キャンペーンの集計 (lib/dmStore.applyEvent) に反映する。
//
// セキュリティ: SendGrid の「Signed Event Webhook」で ECDSA(P-256) 署名を検証する。
//   - SendGrid 管理画面 (Settings > Mail Settings > Event Webhook) で
//     このエンドポイント URL を登録し、Signature Verification を ON にする。
//   - 表示される Verification Key (base64) を env SENDGRID_WEBHOOK_PUBLIC_KEY に設定。
//   - custom_args.campaign_id を送信側 (dm/route.ts) で付与しているため、
//     イベントに campaign_id が echo され、どのキャンペーンかを特定できる。
//
// 署名対象は「timestampヘッダ + 生のリクエストボディ」。JSON parse 前の raw body で検証する。
import { NextResponse } from "next/server";
import crypto from "crypto";
import { applyEvent, type SgEvent } from "@/lib/dmStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIG_HEADER = "x-twilio-email-event-webhook-signature";
const TS_HEADER = "x-twilio-email-event-webhook-timestamp";

function verifySignature(rawBody: string, signature: string, timestamp: string): boolean {
  const b64Key = (process.env.SENDGRID_WEBHOOK_PUBLIC_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!b64Key) return false; // 鍵未設定なら検証不能 → 拒否 (未検証イベントは処理しない)
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(b64Key, "base64"),
      format: "der",
      type: "spki",
    });
    const verifier = crypto.createVerify("SHA256");
    verifier.update(timestamp + rawBody);
    verifier.end();
    return verifier.verify(
      { key: publicKey, dsaEncoding: "der" },
      signature,
      "base64"
    );
  } catch (e) {
    console.error("[sendgrid webhook] verify error:", e);
    return false;
  }
}

export async function POST(req: Request) {
  const signature = req.headers.get(SIG_HEADER) || "";
  const timestamp = req.headers.get(TS_HEADER) || "";
  const rawBody = await req.text();

  if (!process.env.SENDGRID_WEBHOOK_PUBLIC_KEY) {
    // 鍵未設定は設定漏れ。イベントを未検証で処理しないよう明示的に 503。
    console.warn("[sendgrid webhook] SENDGRID_WEBHOOK_PUBLIC_KEY 未設定のため拒否");
    return NextResponse.json({ ok: false, error: "webhook not configured" }, { status: 503 });
  }
  if (!signature || !timestamp || !verifySignature(rawBody, signature, timestamp)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 403 });
  }

  let events: SgEvent[];
  try {
    const parsed = JSON.parse(rawBody);
    events = Array.isArray(parsed) ? parsed : [];
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // 各イベントを集計反映。1件の失敗で全体を落とさない (SendGrid のリトライ暴発を防ぐ)。
  let applied = 0;
  for (const ev of events) {
    try {
      await applyEvent(ev);
      applied++;
    } catch (e) {
      console.error("[sendgrid webhook] applyEvent failed:", e, ev?.event, ev?.campaign_id);
    }
  }

  return NextResponse.json({ ok: true, received: events.length, applied });
}
