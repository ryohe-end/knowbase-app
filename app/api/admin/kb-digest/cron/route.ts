// app/api/admin/kb-digest/cron/route.ts
// KB通信の自動配信 (EventBridge から毎時呼び出し想定)。
// isDue が真なら 生成→全員配信→記録 を「完全自動」で実行する。
// 認可: isAdminRequest (?token=KB_ADMIN_API_KEY / x-kb-admin-key / 管理Cookie)
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { getConfig, isDue, gatherTrends, generateDigest, sendToAll, recordIssue, saveConfig } from "@/lib/kbDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

async function run(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const cfg = await getConfig();
  const now = new Date();
  if (!isDue(cfg, now)) {
    return NextResponse.json({ ok: true, due: false, enabled: cfg.enabled });
  }
  try {
    const trends = await gatherTrends(cfg.frequency === "monthly" ? 30 : cfg.frequency === "biweekly" ? 14 : 7);
    const { subject, html } = await generateDigest({ cfg, trends });
    const { sent, failed } = await sendToAll({ subject, html, targetType: cfg.targetType, targetGroupIds: cfg.targetGroupIds });
    await recordIssue({ subject, html, sent, auto: true });
    await saveConfig({ lastSentAt: now.toISOString(), lastSubject: subject, nextDraft: "" });
    console.log(`[kb-digest/cron] sent auto digest: "${subject}" to ${sent} (failed ${failed})`);
    return NextResponse.json({ ok: true, due: true, sent, failed, subject });
  } catch (e: any) {
    console.error("[kb-digest/cron] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "auto send failed" }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
