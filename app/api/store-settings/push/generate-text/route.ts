// app/api/store-settings/push/generate-text/route.ts
// PUSH通知/お知らせの「タイトル」「本文」を Claude on Bedrock で生成する。
// 生成結果はフロントの title/body 入力欄へ反映して使う。
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateText } from "@/lib/bedrockHtml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { prompt?: string; subject?: string; body?: string; brand?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const result = await generateText(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, title: result.title, body: result.body });
}
