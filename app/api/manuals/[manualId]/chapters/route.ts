// app/api/manuals/[manualId]/chapters/route.ts
// 動画マニュアルのチャプター(章立て)。
//   GET  … 保存済みチャプターを返す (ログインユーザー)
//   POST … 前処理済みMarkdown(文字起こし+時間別セグメント)から AI でチャプター生成し保存 (管理者)
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getSessionUser, isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";
const OUTPUT_BUCKET = process.env.PREPROCESS_OUTPUT_BUCKET || "knowbie-preprocessed-manuals";
const MODEL_ID = process.env.KB_MODEL_ID || "us.anthropic.claude-sonnet-4-6";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3 = new S3Client({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });

type Chapter = { t: number; title: string };

async function getManual(manualId: string): Promise<any> {
  const res = await ddb.send(new GetCommand({ TableName: MANUALS_TABLE, Key: { manualId }, ProjectionExpression: "manualId, #t, chapters, preprocessedKey, embedUrl", ExpressionAttributeNames: { "#t": "type" } }));
  return res.Item;
}

export async function GET(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  const chapters: Chapter[] = Array.isArray(m?.chapters) ? m.chapters : [];
  return NextResponse.json({ ok: true, chapters });
}

export async function POST(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  if (!m) return NextResponse.json({ ok: false, error: "manual not found" }, { status: 404 });
  const key = m.preprocessedKey || `manuals/${manualId}.md`;

  // 前処理済みMarkdownを取得
  let md = "";
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: OUTPUT_BUCKET, Key: key }));
    md = await obj.Body!.transformToString();
  } catch {
    return NextResponse.json({ ok: false, error: "前処理済みデータが見つかりません（先にMarkdown化が必要）" }, { status: 400 });
  }
  // 「時間別セグメント」を優先的に渡す。無ければ全文。
  const segIdx = md.indexOf("## 時間別セグメント");
  const source = segIdx >= 0 ? md.slice(segIdx, segIdx + 16000) : md.slice(0, 16000);
  if (!/\d+:\d{2}/.test(source)) {
    return NextResponse.json({ ok: false, error: "時刻情報が無いため章立てできません（動画のみ対応）" }, { status: 400 });
  }

  const system = `あなたは研修動画のチャプター(章立て)を作る編集者です。
与えられた「時間別セグメント(mm:ss または h:mm:ss と発話)」から、視聴者が目次として使える章を作ります。
制約:
- 出力は JSON 配列のみ。前置き/説明/コードフェンス禁止。
- 形式: [{"t": 開始秒(整数), "title": "章タイトル(全角20文字以内・内容を的確に)"}]
- 章は 4〜12 個。最初の章は t:0 付近から。時系列で昇順。実際の発話内容に忠実に。`;
  const user = `# 時間別セグメント\n${source}\n\n上記から動画のチャプターを JSON 配列で作成してください。`;

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID, contentType: "application/json", accept: "application/json",
      body: JSON.stringify({ anthropic_version: "bedrock-2023-05-31", max_tokens: 1500, system, messages: [{ role: "user", content: [{ type: "text", text: user }] }] }),
    }));
    let text = JSON.parse(new TextDecoder().decode(res.body)).content?.map((b: any) => b.text).join("") || "";
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const mArr = text.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(mArr ? mArr[0] : text);
    const chapters: Chapter[] = (Array.isArray(parsed) ? parsed : [])
      .map((c: any) => ({ t: Math.max(0, Math.floor(Number(c.t) || 0)), title: String(c.title || "").slice(0, 40) }))
      .filter((c: Chapter) => c.title)
      .sort((a: Chapter, b: Chapter) => a.t - b.t)
      .slice(0, 20);
    if (chapters.length === 0) return NextResponse.json({ ok: false, error: "章を生成できませんでした" }, { status: 502 });

    await ddb.send(new UpdateCommand({
      TableName: MANUALS_TABLE, Key: { manualId },
      UpdateExpression: "SET chapters = :c, chaptersAt = :a",
      ExpressionAttributeValues: { ":c": chapters, ":a": new Date().toISOString() },
    }));
    return NextResponse.json({ ok: true, chapters });
  } catch (e: any) {
    console.error("[chapters] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "生成に失敗しました" }, { status: 500 });
  }
}
