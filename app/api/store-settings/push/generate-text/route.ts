// app/api/store-settings/push/generate-text/route.ts
// PUSH通知/お知らせの「タイトル」「本文」に加え、お知らせ欄の「おしゃれHTML」も
// Claude on Bedrock で生成する。title/body は入力欄へ、html はお知らせ本文として使う。
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateText, generateHtml } from "@/lib/bedrockHtml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { prompt?: string; subject?: string; body?: string; imageUrl?: string; brand?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // タイトル/本文プレーンテキストと、お知らせ欄のHTML(notice)を同時生成する。
  // HTML生成が失敗しても text は返す(逆も可)。
  const [textResult, htmlResult] = await Promise.all([
    generateText({ prompt: body.prompt, subject: body.subject, body: body.body, brand: body.brand }),
    generateHtml("notice", body),
  ]);
  if (!textResult.ok && !htmlResult.ok) {
    return NextResponse.json({ ok: false, error: textResult.error }, { status: textResult.status });
  }
  return NextResponse.json({
    ok: true,
    title: textResult.ok ? textResult.title : undefined,
    body: textResult.ok ? textResult.body : undefined,
    html: htmlResult.ok ? htmlResult.html : undefined,
  });
}
