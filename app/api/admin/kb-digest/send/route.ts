// app/api/admin/kb-digest/send/route.ts
// KB通信を今すぐ配信 (管理者専用)。subject/html を渡せばそれを、無ければ生成して送る。
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { getConfig, gatherTrends, generateDigest, sendToAll, recordIssue, saveConfig } from "@/lib/kbDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: { subject?: string; html?: string } = {};
  try { body = await req.json(); } catch {}
  try {
    const cfg = await getConfig();
    let subject = (body.subject || "").trim();
    let html = (body.html || "").trim();
    if (!subject || !html) {
      const trends = await gatherTrends(cfg.frequency === "monthly" ? 30 : cfg.frequency === "biweekly" ? 14 : 7);
      const gen = await generateDigest({ cfg, trends });
      subject = gen.subject; html = gen.html;
    }
    const { sent, failed } = await sendToAll({ subject, html, targetType: cfg.targetType, targetGroupIds: cfg.targetGroupIds });
    await recordIssue({ subject, html, sent, auto: false });
    // 送信後: 次回下書きはクリア、最終送信を記録
    await saveConfig({ lastSentAt: new Date().toISOString(), lastSubject: subject, nextDraft: "" });
    return NextResponse.json({ ok: true, sent, failed, subject });
  } catch (e: any) {
    console.error("[kb-digest/send] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "配信に失敗しました" }, { status: 500 });
  }
}
