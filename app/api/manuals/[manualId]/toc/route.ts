// app/api/manuals/[manualId]/toc/route.ts
// マニュアル(ドキュメント)の目次(TOC)。
//   GET  … 保存済み目次を返す (ログインユーザー)
//   POST … 前処理済みMarkdownから AI で見出し(目次)を生成し保存 (管理者)
// チャプター(動画)と対をなす。目次は時刻を持たず、章立て見出しの一覧。
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

type TocItem = { title: string };

async function getManual(manualId: string): Promise<any> {
  const res = await ddb.send(new GetCommand({ TableName: MANUALS_TABLE, Key: { manualId }, ProjectionExpression: "manualId, #t, toc, preprocessedKey, embedUrl", ExpressionAttributeNames: { "#t": "type" } }));
  return res.Item;
}

export async function GET(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  const toc: TocItem[] = Array.isArray(m?.toc) ? m.toc : [];
  return NextResponse.json({ ok: true, toc });
}

export async function POST(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  if (!m) return NextResponse.json({ ok: false, error: "manual not found" }, { status: 404 });
  const key = m.preprocessedKey || `manuals/${manualId}.md`;

  let md = "";
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: OUTPUT_BUCKET, Key: key }));
    md = await obj.Body!.transformToString();
  } catch {
    return NextResponse.json({ ok: false, error: "前処理済みデータが見つかりません（先にMarkdown化が必要）" }, { status: 400 });
  }
  // 時間別セグメント(動画向け)は除外し、本文から見出しを作る
  const segIdx = md.indexOf("## 時間別セグメント");
  const source = (segIdx >= 0 ? md.slice(0, segIdx) : md).slice(0, 16000);

  const system = `あなたはマニュアル資料の目次(章立て)を作る編集者です。
与えられた本文から、読者が全体像を把握できる目次を作ります。
制約:
- 出力は JSON 配列のみ。前置き/説明/コードフェンス禁止。
- 形式: [{"title": "見出し(全角24文字以内・内容を的確に)"}]
- 見出しは 4〜15 個。資料の並び順(上から)に忠実に。実際の内容に沿った具体的な見出しにする。`;
  const userPrompt = `# 本文\n${source}\n\n上記マニュアルの目次を JSON 配列で作成してください。`;

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID, contentType: "application/json", accept: "application/json",
      body: JSON.stringify({ anthropic_version: "bedrock-2023-05-31", max_tokens: 1500, system, messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }] }),
    }));
    let text = JSON.parse(new TextDecoder().decode(res.body)).content?.map((b: any) => b.text).join("") || "";
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const mArr = text.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(mArr ? mArr[0] : text);
    const toc: TocItem[] = (Array.isArray(parsed) ? parsed : [])
      .map((c: any) => ({ title: String(c.title || "").slice(0, 48) }))
      .filter((c: TocItem) => c.title)
      .slice(0, 25);
    if (toc.length === 0) return NextResponse.json({ ok: false, error: "目次を生成できませんでした" }, { status: 502 });

    await ddb.send(new UpdateCommand({
      TableName: MANUALS_TABLE, Key: { manualId },
      UpdateExpression: "SET toc = :c, tocAt = :a",
      ExpressionAttributeValues: { ":c": toc, ":a": new Date().toISOString() },
    }));
    return NextResponse.json({ ok: true, toc });
  } catch (e: any) {
    console.error("[toc] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "生成に失敗しました" }, { status: 500 });
  }
}
