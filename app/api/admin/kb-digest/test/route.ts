// app/api/admin/kb-digest/test/route.ts
// KB通信のテスト配信。指定した複数アドレスのみへ送る(全員配信・スケジュールには影響しない)。
// 生成が重い場合があるため Lambda(knowbie-kb-digest, action=test) に非同期投入して即返す。
// preview の subject/html を渡せば生成をスキップして即送信できる。
import { NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.KB_DIGEST_FUNCTION || "knowbie-kb-digest";
const lambda = new LambdaClient({ region: REGION });

const isValidEmail = (e: unknown) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

// "a@x.com, b@y.com\nc@z.com" 等(カンマ/改行/空白/セミコロン区切り)を配列化
function parseEmails(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map(String) : String(input ?? "").split(/[\s,;]+/);
  return [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
}

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: { emails?: unknown; subject?: string; html?: string } = {};
  try { body = await req.json(); } catch {}

  const emails = parseEmails(body.emails);
  if (emails.length === 0) return NextResponse.json({ ok: false, error: "宛先メールアドレスを1件以上指定してください" }, { status: 400 });
  const invalid = emails.filter((e) => !isValidEmail(e));
  if (invalid.length) return NextResponse.json({ ok: false, error: `メールアドレスの形式が不正です: ${invalid.join(", ")}` }, { status: 400 });
  if (emails.length > 50) return NextResponse.json({ ok: false, error: "テスト配信は50件までにしてください" }, { status: 400 });

  try {
    await lambda.send(new InvokeCommand({
      FunctionName: FN,
      InvocationType: "Event", // 非同期(生成が入る場合に備える)
      Payload: Buffer.from(JSON.stringify({ action: "test", emails, subject: body.subject, html: body.html })),
    }));
    return NextResponse.json({ ok: true, started: true, count: emails.length, recipients: emails });
  } catch (e: any) {
    console.error("[kb-digest/test] invoke error:", e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "テスト配信の起動に失敗しました" }, { status: 500 });
  }
}
