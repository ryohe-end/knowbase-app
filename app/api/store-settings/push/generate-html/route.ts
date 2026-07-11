// app/api/store-settings/push/generate-html/route.ts
// アプリ内「お知らせ欄」の HTML を Claude on Bedrock で生成する (lib/bedrockHtml, notice)。
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateHtml } from "@/lib/bedrockHtml";

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

  const result = await generateHtml("notice", body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, html: result.html });
}
