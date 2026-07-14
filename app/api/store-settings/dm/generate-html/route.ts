// app/api/store-settings/dm/generate-html/route.ts
// DM メールの「おしゃれな HTML」を Claude on Bedrock で生成する (lib/bedrockHtml)。
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateHtml, generateText } from "@/lib/bedrockHtml";

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

  // HTMLメール本体と、件名/本文プレーンテキストを同時生成する。
  // 件名・本文は入力欄へ反映するため (プレビューHTMLだけでなくフォームにも入れる)。
  const [result, textResult] = await Promise.all([
    generateHtml("email", body),
    generateText({ prompt: body.prompt, subject: body.subject, body: body.body, brand: body.brand }),
  ]);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    html: result.html,
    // 生成できた場合のみ返す (失敗しても HTML 生成は成功させる)
    subject: textResult.ok ? textResult.title : undefined,
    body: textResult.ok ? textResult.body : undefined,
  });
}
