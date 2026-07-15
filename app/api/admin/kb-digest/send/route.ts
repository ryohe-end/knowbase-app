// app/api/admin/kb-digest/send/route.ts
// KB通信を今すぐ配信。生成+全員送信は重いため Lambda(knowbie-kb-digest) に非同期投入し、即座に返す。
import { NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.KB_DIGEST_FUNCTION || "knowbie-kb-digest";
const lambda = new LambdaClient({ region: REGION });

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: { subject?: string; html?: string } = {};
  try { body = await req.json(); } catch {}
  try {
    await lambda.send(new InvokeCommand({
      FunctionName: FN,
      InvocationType: "Event", // 非同期(生成+配信をLambdaが実行)
      Payload: Buffer.from(JSON.stringify({ action: "send", subject: body.subject, html: body.html })),
    }));
    return NextResponse.json({ ok: true, started: true });
  } catch (e: any) {
    console.error("[kb-digest/send] invoke error:", e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "配信の起動に失敗しました" }, { status: 500 });
  }
}
