// app/api/admin/kb-digest/generate/route.ts
// KB通信のプレビュー生成 (管理者専用)。下書きがあればそれ軸、無ければアクセス動向から自動。
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { getConfig, gatherTrends, generateDigest } from "@/lib/kbDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: { cfg?: any; periodDays?: number } = {};
  try { body = await req.json(); } catch {}
  try {
    const saved = await getConfig();
    // UIの未保存編集(body.cfg)を優先してプレビュー
    const cfg = { ...saved, ...(body.cfg || {}), sections: { ...saved.sections, ...(body.cfg?.sections || {}) } };
    const trends = await gatherTrends(body.periodDays || (cfg.frequency === "monthly" ? 30 : cfg.frequency === "biweekly" ? 14 : 7));
    const { subject, html } = await generateDigest({ cfg, trends });
    return NextResponse.json({ ok: true, subject, html, trends });
  } catch (e: any) {
    console.error("[kb-digest/generate] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "生成に失敗しました" }, { status: 500 });
  }
}
