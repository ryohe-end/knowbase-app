// app/api/admin/kb-digest/generate/route.ts
// KB通信プレビュー生成。生成は重い(数十秒)ため Lambda(knowbie-kb-digest) に投げ、
// 結果は knowbie-kb-digest テーブルに preview#<id> として保存される。UIはGETでポーリング。
//   POST → { ok, previewId }
//   GET ?previewId=xxx → { ok, status: "pending"|"ready"|"error", subject?, html?, error? }
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.KB_DIGEST_FUNCTION || "knowbie-kb-digest";
const TABLE = process.env.KB_DIGEST_TABLE || "knowbie-kb-digest";
const lambda = new LambdaClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: { cfg?: any; periodDays?: number } = {};
  try { body = await req.json(); } catch {}
  const previewId = randomUUID();
  try {
    await lambda.send(new InvokeCommand({
      FunctionName: FN,
      InvocationType: "Event", // 非同期
      Payload: Buffer.from(JSON.stringify({ action: "preview", previewId, cfg: body.cfg || {}, periodDays: body.periodDays })),
    }));
    return NextResponse.json({ ok: true, previewId });
  } catch (e: any) {
    console.error("[kb-digest/generate] invoke error:", e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "生成の起動に失敗しました" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const previewId = new URL(req.url).searchParams.get("previewId") || "";
  if (!previewId) return NextResponse.json({ ok: false, error: "previewId required" }, { status: 400 });
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id: `preview#${previewId}` } }));
  const it = res.Item;
  if (!it) return NextResponse.json({ ok: true, status: "pending" });
  return NextResponse.json({ ok: true, status: it.status, subject: it.subject, html: it.html, error: it.error });
}
