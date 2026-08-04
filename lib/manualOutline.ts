// lib/manualOutline.ts
// マニュアルのチャプター(動画)・目次(ドキュメント)を前処理済みMarkdownからAI生成する共有ロジック。
// per-manual API(/chapters,/toc) と 一括バックフィル の両方から使う。
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const REGION = process.env.AWS_REGION || "us-east-1";
const OUTPUT_BUCKET = process.env.PREPROCESS_OUTPUT_BUCKET || "knowbie-preprocessed-manuals";
const MODEL_ID = process.env.KB_MODEL_ID || "us.anthropic.claude-sonnet-4-6";
const EVENT_BUS_NAME = process.env.PREPROCESS_EVENT_BUS || "default";

const s3 = new S3Client({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });
const eventBridge = new EventBridgeClient({ region: REGION });

// 未MD(前処理未実施)のマニュアルの前処理(Markdown化)を起動する。完了後の閲覧でアウトラインが自動生成される。
export async function triggerPreprocess(manualId: string, embedUrl?: string): Promise<boolean> {
  if (!embedUrl) return false;
  try {
    await eventBridge.send(new PutEventsCommand({ Entries: [{ EventBusName: EVENT_BUS_NAME, Source: "knowbie.manual.saved", DetailType: "ManualSaved", Detail: JSON.stringify({ manualId, embedUrl, trigger: "update" }) }] }));
    return true;
  } catch {
    return false;
  }
}

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

// 本文を「# スライド N」でスライド単位に分解する(N は実在番号)。
function splitSlides(md: string): { n: number; text: string }[] {
  const re = /^#+\s*スライド\s*(\d+)\s*$/gm;
  const marks: { n: number; idx: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) marks.push({ n: parseInt(m[1], 10), idx: m.index, end: re.lastIndex });
  return marks.map((mk, i) => ({
    n: mk.n,
    text: md.slice(mk.end, i + 1 < marks.length ? marks[i + 1].idx : md.length).replace(/\s+/g, " ").trim().slice(0, 220),
  }));
}

// ドキュメント: 本文 → 目次。Slides(# スライド N)なら各セクションを実在スライド番号(page)に厳密対応させる。
export async function genToc(md: string): Promise<TocItem[]> {
  const segIdx = md.indexOf("## 時間別セグメント");
  const body = segIdx >= 0 ? md.slice(0, segIdx) : md;
  const slides = splitSlides(body);

  if (slides.length > 0) {
    // 実在スライド番号の集合。AIにはこの中から「章の開始スライド」を選ばせ、page は必ずこの集合に検証・スナップする。
    const validNums = slides.map((s) => s.n);
    const validSet = new Set(validNums);
    const minN = Math.min(...validNums), maxN = Math.max(...validNums);
    const listing = slides.map((s) => `スライド${s.n}: ${s.text || "(本文なし)"}`).join("\n").slice(0, 15000);
    const system = `あなたはスライド資料の目次を作る編集者です。各スライドは「スライドN: 本文」の形式で与えられます。
資料を意味のまとまり(章)に分け、各章の見出しと、その章が始まるスライド番号を出力します。
制約:
- 出力は JSON 配列のみ。前置き/説明/コードフェンス禁止。
- 形式: [{"title": "見出し(全角24文字以内・内容を的確に)", "page": 章の開始スライド番号(整数)}]
- page は必ず入力に実在するスライド番号を使う(勝手な番号を作らない)。
- 章は 4〜15 個。page は昇順で重複させない。最初の章は先頭スライド付近から。`;
    const arr = await askJsonArray(system, `# スライド一覧(番号: 本文)\n${listing}\n\n上記の目次を JSON 配列で作成してください。各章の page は開始スライド番号です。`);
    const seen = new Set<number>();
    const items = arr
      .map((c: any) => {
        const title = String(c.title || "").slice(0, 48);
        let p = Math.floor(Number(c.page));
        if (!Number.isFinite(p)) return null;
        // 実在番号にスナップ(最も近い実在スライド番号へ)。
        if (!validSet.has(p)) {
          p = Math.min(maxN, Math.max(minN, p));
          if (!validSet.has(p)) p = validNums.reduce((best, n) => (Math.abs(n - p) < Math.abs(best - p) ? n : best), validNums[0]);
        }
        return title ? { title, page: p } as TocItem : null;
      })
      .filter((c): c is TocItem => !!c && !!c.page)
      .filter((c) => (seen.has(c.page!) ? false : (seen.add(c.page!), true)))
      .sort((a, b) => (a.page! - b.page!))
      .slice(0, 20);
    return items;
  }

  // スライド構造が無い資料(PDF/Doc等): ページ対応は取れないため見出しのみ。
  const source = body.slice(0, 16000);
  const system = `あなたはマニュアル資料の目次を作る編集者です。
制約:
- 出力は JSON 配列のみ。前置き/説明/コードフェンス禁止。
- 形式: [{"title": "見出し(全角24文字以内・内容を的確に)"}]
- 見出しは 4〜15 個。資料の並び順に忠実に。`;
  const arr = await askJsonArray(system, `# 本文\n${source}\n\n上記マニュアルの目次を JSON 配列で作成してください。`);
  return arr
    .map((c: any) => ({ title: String(c.title || "").slice(0, 48) } as TocItem))
    .filter((c: TocItem) => c.title)
    .slice(0, 25);
}
