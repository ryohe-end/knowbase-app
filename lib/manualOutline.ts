// lib/manualOutline.ts
// マニュアルのチャプター(動画)・目次(ドキュメント)を前処理済みMarkdownからAI生成する共有ロジック。
// per-manual API(/chapters,/toc) と 一括バックフィル の両方から使う。
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION || "us-east-1";
const OUTPUT_BUCKET = process.env.PREPROCESS_OUTPUT_BUCKET || "knowbie-preprocessed-manuals";
const MODEL_ID = process.env.KB_MODEL_ID || "us.anthropic.claude-sonnet-4-6";

const s3 = new S3Client({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });

export type Chapter = { t: number; title: string };
export type TocItem = { title: string; page?: number }; // page = Slidesのスライド番号(1始まり)。他は未設定。

export async function readPreprocessedMd(manualId: string, preprocessedKey?: string): Promise<string | null> {
  const key = preprocessedKey || `manuals/${manualId}.md`;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: OUTPUT_BUCKET, Key: key }));
    return await obj.Body!.transformToString();
  } catch {
    return null;
  }
}

async function askJsonArray(system: string, user: string, maxTokens = 1500): Promise<any[]> {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID, contentType: "application/json", accept: "application/json",
    body: JSON.stringify({ anthropic_version: "bedrock-2023-05-31", max_tokens: maxTokens, system, messages: [{ role: "user", content: [{ type: "text", text: user }] }] }),
  }));
  let text = JSON.parse(new TextDecoder().decode(res.body)).content?.map((b: any) => b.text).join("") || "";
  text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const m = text.match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(m ? m[0] : text);
  return Array.isArray(parsed) ? parsed : [];
}

// 動画: 時間別セグメント → チャプター。時刻が無ければ null(章立て不可)。
export async function genChapters(md: string): Promise<Chapter[] | null> {
  const segIdx = md.indexOf("## 時間別セグメント");
  const source = segIdx >= 0 ? md.slice(segIdx, segIdx + 16000) : md.slice(0, 16000);
  if (!/\d+:\d{2}/.test(source)) return null;
  const system = `あなたは研修動画のチャプター(章立て)を作る編集者です。
与えられた「時間別セグメント(mm:ss または h:mm:ss と発話)」から、視聴者が目次として使える章を作ります。
制約:
- 出力は JSON 配列のみ。前置き/説明/コードフェンス禁止。
- 形式: [{"t": 開始秒(整数), "title": "章タイトル(全角20文字以内・内容を的確に)"}]
- 章は 4〜12 個。最初の章は t:0 付近から。時系列で昇順。実際の発話内容に忠実に。`;
  const arr = await askJsonArray(system, `# 時間別セグメント\n${source}\n\n上記から動画のチャプターを JSON 配列で作成してください。`);
  return arr
    .map((c: any) => ({ t: Math.max(0, Math.floor(Number(c.t) || 0)), title: String(c.title || "").slice(0, 40) }))
    .filter((c: Chapter) => c.title)
    .sort((a: Chapter, b: Chapter) => a.t - b.t)
    .slice(0, 20);
}

// ドキュメント: 本文 → 目次。Slides(# スライド N)ならスライド番号(page)も付与。
export async function genToc(md: string): Promise<TocItem[]> {
  const segIdx = md.indexOf("## 時間別セグメント");
  const source = (segIdx >= 0 ? md.slice(0, segIdx) : md).slice(0, 16000);
  const hasSlides = /(^|\n)#\s*スライド\s*\d+/.test(md);
  const system = hasSlides
    ? `あなたはスライド資料の目次を作る編集者です。本文には「# スライド N」の見出しがあります。
制約:
- 出力は JSON 配列のみ。前置き/説明/コードフェンス禁止。
- 形式: [{"title": "見出し(全角24文字以内)", "page": スライド番号(整数)}]
- 見出しは 4〜15 個。各見出しに対応する「# スライド N」の N を page に入れる。並び順(page昇順)に忠実に。`
    : `あなたはマニュアル資料の目次を作る編集者です。
制約:
- 出力は JSON 配列のみ。前置き/説明/コードフェンス禁止。
- 形式: [{"title": "見出し(全角24文字以内・内容を的確に)"}]
- 見出しは 4〜15 個。資料の並び順に忠実に。`;
  const arr = await askJsonArray(system, `# 本文\n${source}\n\n上記マニュアルの目次を JSON 配列で作成してください。`);
  return arr
    .map((c: any) => {
      const item: TocItem = { title: String(c.title || "").slice(0, 48) };
      const p = Math.floor(Number(c.page));
      if (hasSlides && Number.isFinite(p) && p > 0) item.page = p;
      return item;
    })
    .filter((c: TocItem) => c.title)
    .slice(0, 25);
}
