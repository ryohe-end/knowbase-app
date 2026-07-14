// app/api/admin/kb-digest/route.ts
// KB通信の設定 取得/保存 (管理者専用)
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { getConfig, saveConfig, availableGroups, SECTION_DEFS, type DigestConfig } from "@/lib/kbDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const config = await getConfig();
  return NextResponse.json({ ok: true, config, groups: availableGroups(), sectionDefs: SECTION_DEFS });
}

export async function PUT(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: Partial<DigestConfig>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const patch: Partial<DigestConfig> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.frequency === "weekly" || body.frequency === "biweekly" || body.frequency === "monthly") patch.frequency = body.frequency;
  if (Number.isFinite(body.dayOfWeek as number)) patch.dayOfWeek = Math.min(6, Math.max(0, Number(body.dayOfWeek)));
  if (Number.isFinite(body.dayOfMonth as number)) patch.dayOfMonth = Math.min(28, Math.max(1, Number(body.dayOfMonth)));
  if (Number.isFinite(body.sendHour as number)) patch.sendHour = Math.min(23, Math.max(0, Number(body.sendHour)));
  if (typeof body.nextDraft === "string") patch.nextDraft = body.nextDraft.slice(0, 4000);
  if (body.targetType === "all" || body.targetType === "groups") patch.targetType = body.targetType;
  if (Array.isArray(body.targetGroupIds)) patch.targetGroupIds = body.targetGroupIds.map(String);
  if (body.sections && typeof body.sections === "object") patch.sections = body.sections as any;
  if (typeof body.updateInfo === "string") patch.updateInfo = body.updateInfo.slice(0, 4000);
  if (typeof body.staffIntroText === "string") patch.staffIntroText = body.staffIntroText.slice(0, 4000);
  if (typeof body.seminarVideoUrl === "string") patch.seminarVideoUrl = body.seminarVideoUrl.slice(0, 2000);
  const config = await saveConfig(patch);
  return NextResponse.json({ ok: true, config });
}
