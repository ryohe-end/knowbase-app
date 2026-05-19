/**
 * scripts/preprocess-manual.ts
 *
 * Google Drive (or YouTube URL) のマニュアルを AI が読みやすい Markdown に変換する。
 *
 * 対応形式:
 *   - Google Slides (native)
 *   - PowerPoint PPTX     … Drive で Slides に変換してから処理
 *   - Google Docs (native)
 *   - Word DOCX           … Drive で Docs に変換してから処理
 *   - PDF                 … pdf-parse でテキスト抽出、空ならば Textract OCR
 *   - Google Sheets       … Sheets API で全シートを Markdown 表に
 *   - Excel XLSX          … xlsx ライブラリで Markdown 表に
 *   - mp4 / mov / webm    … S3 へ一時アップロード → AWS Transcribe で字幕化
 *   - YouTube URL         … YouTube Data API で字幕取得
 *
 * 使い方:
 *   npx tsx scripts/preprocess-manual.ts <DriveFileId|YouTubeURL> [--out=path.md]
 *
 * 必要な環境変数 (.env.local):
 *   GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_PATH … Drive 認証
 *   AWS_REGION (省略時 us-east-1) … Bedrock / Textract / S3 / Transcribe
 *   BEDROCK_MODEL_ID (省略時 us.anthropic.claude-sonnet-4-6)
 *   PREPROCESS_TRANSCRIBE_BUCKET … 動画文字起こし用 S3 バケット (mp4 処理時のみ必須)
 *   YOUTUBE_API_KEY … YouTube Data API v3 のキー (YouTube URL 処理時のみ必須)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { google } from "googleapis";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
} from "@aws-sdk/client-transcribe";
import * as XLSX from "xlsx";

// =====================================================================
// .env.local をシンプルに読み込む (dotenv なしで動かす)
// =====================================================================
function loadEnvFromFile() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  const txt = fs.readFileSync(file, "utf8");
  for (const rawLine of txt.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFromFile();

// =====================================================================
// Google API 認証
// =====================================================================
type SAJson = { client_email: string; private_key: string };

function loadServiceAccount(): SAJson {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim().startsWith("{")) {
    const json = JSON.parse(raw) as SAJson;
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  }
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(abs)) throw new Error(`Service account JSON not found at: ${abs}`);
    const json = JSON.parse(fs.readFileSync(abs, "utf8")) as SAJson;
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  }
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac && fs.existsSync(gac)) {
    const json = JSON.parse(fs.readFileSync(gac, "utf8")) as SAJson;
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  }
  throw new Error(
    "Service account credentials not found. Set GOOGLE_SERVICE_ACCOUNT_JSON (JSON), GOOGLE_SERVICE_ACCOUNT_JSON_PATH (file path), or GOOGLE_APPLICATION_CREDENTIALS (file path)"
  );
}

export function getGoogleAuth() {
  const sa = loadServiceAccount();
  return new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/presentations.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  });
}

// =====================================================================
// AWS クライアント
// =====================================================================
const AWS_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-4-6";

const bedrock = new BedrockRuntimeClient({ region: AWS_REGION });
const textract = new TextractClient({ region: AWS_REGION });
const s3 = new S3Client({ region: AWS_REGION });
const transcribe = new TranscribeClient({ region: AWS_REGION });

async function describeImageWithClaude(
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg",
  instruction: string
): Promise<string> {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: instruction },
        ],
      },
    ],
  };

  const cmd = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    body: JSON.stringify(body),
    contentType: "application/json",
    accept: "application/json",
  });
  const res = await bedrock.send(cmd);
  const decoded = JSON.parse(Buffer.from(res.body).toString("utf-8"));
  const text = decoded?.content?.[0]?.text ?? decoded?.completion ?? "";
  return String(text || "").trim();
}

// =====================================================================
// ユーティリティ
// =====================================================================
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    const u8: Uint8Array = Buffer.isBuffer(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : new Uint8Array(chunk);
    chunks.push(u8);
  }
  return Buffer.concat(chunks as any);
}

function nowIso() {
  return new Date().toISOString();
}

function buildFrontMatter(props: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") lines.push(`${k}: ${JSON.stringify(v)}`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function extractYouTubeId(input: string): string | null {
  const u = input.trim();
  // raw 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(u)) return u;
  const m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? null;
}

// =====================================================================
// Slides 処理 (PoC で実装済み)
// =====================================================================
export async function processSlides(auth: any, fileId: string, fileMeta: any): Promise<string> {
  const slides = google.slides({ version: "v1", auth });
  console.log("📄 Google Slides を取得しています...");
  const pres = await slides.presentations.get({ presentationId: fileId });
  const pageCount = pres.data.slides?.length ?? 0;
  console.log(`   ${pageCount} 枚のスライド`);

  const sections: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const slide = pres.data.slides![i];
    const objectId = slide.objectId!;
    console.log(`   [${i + 1}/${pageCount}] スライド処理中 (id=${objectId})`);

    const extractedText = extractTextFromSlide(slide).trim();
    const notes = extractNotes(slide).trim();

    const thumb = await slides.presentations.pages.getThumbnail({
      presentationId: fileId,
      pageObjectId: objectId,
      "thumbnailProperties.mimeType": "PNG",
      "thumbnailProperties.thumbnailSize": "LARGE",
    });
    const imgRes = await fetch(thumb.data.contentUrl!);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const imgB64 = imgBuf.toString("base64");

    const instruction = [
      "あなたは社内マニュアルを AI 検索可能な Markdown に変換するアシスタントです。",
      "このスライドの内容を、見出し・箇条書き・表を適切に使った Markdown で詳しく説明してください。",
      "スクリーンショットや図がある場合は、何が映っているか具体的に記述してください。",
      "スライド内のテキストは可能な限り正確に文字起こししてください。",
      "出力は Markdown 本文のみ。前置きは不要。",
    ].join("\n");

    let visionMd = "";
    try {
      visionMd = await describeImageWithClaude(imgB64, "image/png", instruction);
    } catch (e: any) {
      visionMd = `> ⚠️ Vision LLM 呼び出し失敗: ${e?.message ?? String(e)}`;
    }

    const block: string[] = [];
    block.push(`# スライド ${i + 1}`, "");
    if (extractedText) {
      block.push("## 抽出テキスト (Slides API)", "", "```", extractedText, "```", "");
    }
    block.push("## 内容 (Vision LLM 解析)", "", visionMd, "");
    if (notes) {
      block.push("## スピーカーノート", "", notes, "");
    }
    sections.push(block.join("\n"));
  }

  return (
    buildFrontMatter({
      source_file_id: fileId,
      title: fileMeta.name ?? "",
      mime_type: fileMeta.mimeType,
      processed_at: nowIso(),
      processor: "preprocess-manual.ts",
      bedrock_model: BEDROCK_MODEL_ID,
      slide_count: pageCount,
    }) + sections.join("\n---\n\n")
  );
}

function extractTextFromSlide(slide: any): string {
  const lines: string[] = [];
  const visit = (el: any) => {
    const textEls = el?.shape?.text?.textElements;
    if (Array.isArray(textEls)) {
      for (const t of textEls) {
        const c = t?.textRun?.content;
        if (typeof c === "string") lines.push(c);
      }
    }
    if (Array.isArray(el?.elementGroup?.children)) for (const c of el.elementGroup.children) visit(c);
    if (Array.isArray(el?.table?.tableRows)) {
      for (const row of el.table.tableRows) {
        const rowCells: string[] = [];
        for (const cell of row.tableCells ?? []) {
          const cellEls = cell?.text?.textElements ?? [];
          rowCells.push(cellEls.map((te: any) => te?.textRun?.content ?? "").join("").trim());
        }
        if (rowCells.some(Boolean)) lines.push(rowCells.join(" | "));
      }
    }
  };
  for (const el of slide?.pageElements ?? []) visit(el);
  return lines.join("").replace(/\n{3,}/g, "\n\n");
}

function extractNotes(slide: any): string {
  const notesPage = slide?.slideProperties?.notesPage;
  if (!notesPage) return "";
  return extractTextFromSlide(notesPage);
}

// =====================================================================
// PPTX (uploaded) → Slides に変換してから処理
// =====================================================================
export async function convertToNative(
  auth: any,
  fileId: string,
  name: string,
  targetMime: string
): Promise<{ tmpId: string; cleanup: () => Promise<void> }> {
  const drive = google.drive({ version: "v3", auth });
  console.log(`🔄 ${targetMime} に変換中...`);
  const copy = await drive.files.copy({
    fileId,
    supportsAllDrives: true,
    requestBody: { name: `${name} (preprocess-tmp)`, mimeType: targetMime },
  });
  const tmpId = copy.data.id!;
  console.log(`   変換完了 (tmp id=${tmpId})`);
  return {
    tmpId,
    cleanup: async () => {
      try {
        await drive.files.delete({ fileId: tmpId, supportsAllDrives: true });
        console.log(`🧹 tmp ファイル削除 (${tmpId})`);
      } catch (e: any) {
        console.warn(`tmp ファイル削除失敗: ${e?.message ?? String(e)}`);
      }
    },
  };
}

// =====================================================================
// Docs 処理
// =====================================================================
export async function processDocs(auth: any, fileId: string, fileMeta: any): Promise<string> {
  const docs = google.docs({ version: "v1", auth });
  console.log("📝 Google Docs を取得しています...");
  const doc = await docs.documents.get({ documentId: fileId });

  const lines: string[] = [];
  const body = doc.data.body?.content ?? [];
  for (const el of body) {
    const para = el.paragraph;
    if (!para) continue;
    const style = para.paragraphStyle?.namedStyleType ?? "";
    const text = (para.elements ?? [])
      .map((e: any) => e?.textRun?.content ?? "")
      .join("")
      .replace(/\n+$/, "");
    if (!text) continue;
    if (style === "TITLE") lines.push(`# ${text}`);
    else if (style === "HEADING_1") lines.push(`## ${text}`);
    else if (style === "HEADING_2") lines.push(`### ${text}`);
    else if (style === "HEADING_3") lines.push(`#### ${text}`);
    else lines.push(text);
    lines.push("");
  }

  return (
    buildFrontMatter({
      source_file_id: fileId,
      title: fileMeta.name ?? "",
      mime_type: fileMeta.mimeType,
      processed_at: nowIso(),
      processor: "preprocess-manual.ts",
    }) + lines.join("\n")
  );
}

// =====================================================================
// PDF 処理 (pdf-parse → 空なら Textract OCR フォールバック)
// =====================================================================
export async function processPdf(auth: any, fileId: string, fileMeta: any): Promise<string> {
  const drive = google.drive({ version: "v3", auth });
  console.log("📕 PDF をダウンロードしています...");
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  const buf = await streamToBuffer(res.data as any);

  // 1) pdf-parse でテキスト抽出を試す
  let extracted = "";
  let extractionMethod = "pdf-parse";
  try {
    const mod = (await import("pdf-parse" as any));
    const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string; numpages: number }>;
    const result = await pdfParse(buf);
    extracted = String(result.text || "").trim();
    console.log(`   ${result.numpages} ページ / pdf-parse 抽出 ${extracted.length} 文字`);
  } catch (e: any) {
    console.warn(`   pdf-parse エラー: ${e?.message ?? String(e)}`);
  }

  // 2) テキスト抽出が空 (=スキャン PDF の可能性) なら Textract で OCR
  // 注: Textract DetectDocumentText は単ページ用なので PDF 全体を渡せないが、簡易フォールバックとして
  // 最初の数ページ相当の画像化が必要。簡単のため PoC では「pdf-parse でゼロ文字」の場合のみ警告として残す。
  if (extracted.length === 0) {
    console.log("   ⚠️ pdf-parse で抽出ゼロ。Textract OCR フォールバックを試行...");
    try {
      // Textract DetectDocumentText は PDF を直接食わせると 5MB / 1ページ制限がある。
      // 大きい PDF は事前に S3 へ置いて StartDocumentTextDetection (async) が本来の作法。
      // PoC では同期 API を直で叩いて Bytes フィールドに PDF を渡す (5MB 以内なら動く)。
      if (buf.byteLength < 5 * 1024 * 1024) {
        const cmd = new DetectDocumentTextCommand({ Document: { Bytes: new Uint8Array(buf) } });
        const r = await textract.send(cmd);
        const blocks = r.Blocks ?? [];
        extracted = blocks
          .filter((b: any) => b.BlockType === "LINE")
          .map((b: any) => b.Text ?? "")
          .join("\n");
        extractionMethod = "textract-sync";
        console.log(`   ✅ Textract 抽出 ${extracted.length} 文字`);
      } else {
        extracted = `> ⚠️ Textract 同期 API は 5MB 以上の PDF に未対応。非同期 (S3 経由 StartDocumentTextDetection) の実装が必要。\n> ファイルサイズ: ${buf.byteLength} bytes`;
        extractionMethod = "skipped-large";
      }
    } catch (e: any) {
      extracted = `> ⚠️ Textract 呼び出し失敗: ${e?.message ?? String(e)}`;
      extractionMethod = "textract-failed";
    }
  }

  return (
    buildFrontMatter({
      source_file_id: fileId,
      title: fileMeta.name ?? "",
      mime_type: fileMeta.mimeType,
      processed_at: nowIso(),
      processor: "preprocess-manual.ts",
      extraction_method: extractionMethod,
      pdf_bytes: buf.byteLength,
    }) + "## 抽出テキスト\n\n```\n" + extracted.slice(0, 100000) + "\n```\n"
  );
}

// =====================================================================
// Google Sheets 処理
// =====================================================================
export async function processSheets(auth: any, fileId: string, fileMeta: any): Promise<string> {
  const sheetsApi = google.sheets({ version: "v4", auth });
  console.log("📊 Google Sheets を取得しています...");

  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: fileId });
  const sheetNames = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((n): n is string => !!n);
  console.log(`   ${sheetNames.length} シート: ${sheetNames.join(", ")}`);

  const sections: string[] = [];
  for (const sheetName of sheetNames) {
    const valuesRes = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: fileId,
      range: `'${sheetName}'`,
    });
    const rows = valuesRes.data.values ?? [];
    const md = rowsToMarkdownTable(rows);
    sections.push(`## ${sheetName}\n\n${md}\n`);
  }

  return (
    buildFrontMatter({
      source_file_id: fileId,
      title: fileMeta.name ?? "",
      mime_type: fileMeta.mimeType,
      processed_at: nowIso(),
      processor: "preprocess-manual.ts",
      sheet_count: sheetNames.length,
    }) + sections.join("\n---\n\n")
  );
}

// =====================================================================
// XLSX (uploaded) 処理
// =====================================================================
export async function processXlsx(auth: any, fileId: string, fileMeta: any): Promise<string> {
  const drive = google.drive({ version: "v3", auth });
  console.log("📊 XLSX をダウンロードしています...");
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  const buf = await streamToBuffer(res.data as any);

  const wb = XLSX.read(buf, { type: "buffer" });
  console.log(`   ${wb.SheetNames.length} シート: ${wb.SheetNames.join(", ")}`);

  const sections: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
    const md = rowsToMarkdownTable(rows as any[][]);
    sections.push(`## ${sheetName}\n\n${md}\n`);
  }

  return (
    buildFrontMatter({
      source_file_id: fileId,
      title: fileMeta.name ?? "",
      mime_type: fileMeta.mimeType,
      processed_at: nowIso(),
      processor: "preprocess-manual.ts",
      sheet_count: wb.SheetNames.length,
    }) + sections.join("\n---\n\n")
  );
}

function rowsToMarkdownTable(rows: any[][]): string {
  if (!rows || rows.length === 0) return "_(空のシート)_";
  // 列数を均す
  const maxCols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => Array.from({ length: maxCols }, (_, i) => formatCell(r[i])));

  const head = norm[0];
  const body = norm.slice(1);

  const headerLine = `| ${head.join(" | ")} |`;
  const separator = `| ${head.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map((r) => `| ${r.join(" | ")} |`);

  // 大きいシートは末尾省略
  const MAX_ROWS = 200;
  if (bodyLines.length > MAX_ROWS) {
    return [headerLine, separator, ...bodyLines.slice(0, MAX_ROWS), `| ... | _(${bodyLines.length - MAX_ROWS} 行省略)_ |`].join("\n");
  }
  return [headerLine, separator, ...bodyLines].join("\n");
}

function formatCell(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  // Markdown のテーブル区切り文字をエスケープ
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// =====================================================================
// 動画 (mp4 / mov / webm) 処理 — S3 + Transcribe
// =====================================================================
export async function processVideo(auth: any, fileId: string, fileMeta: any): Promise<string> {
  const bucket = process.env.PREPROCESS_TRANSCRIBE_BUCKET;
  if (!bucket) {
    throw new Error(
      "PREPROCESS_TRANSCRIBE_BUCKET が未設定。動画文字起こしには S3 バケット名を環境変数に設定してください (例: knowbie-transcribe-tmp)"
    );
  }

  const drive = google.drive({ version: "v3", auth });
  console.log("🎬 動画をダウンロードしています...");
  const dlRes = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  const buf = await streamToBuffer(dlRes.data as any);
  console.log(`   サイズ: ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB`);

  // 1) S3 へアップロード
  const ext = (fileMeta.name?.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".mp4").toLowerCase();
  const objectKey = `preprocess/${fileId}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  console.log(`   S3 へアップロード: s3://${bucket}/${objectKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buf,
      ContentType: fileMeta.mimeType,
    })
  );

  // 2) Transcribe ジョブ開始
  const jobName = `preprocess-${fileId.slice(0, 16)}-${Date.now()}`;
  const mediaUri = `s3://${bucket}/${objectKey}`;
  const mediaFormat = ext.replace(".", "").toLowerCase().replace("mov", "mp4");
  console.log(`   Transcribe ジョブ開始: ${jobName}`);
  await transcribe.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: "ja-JP",
      Media: { MediaFileUri: mediaUri },
      MediaFormat: mediaFormat as any,
      OutputBucketName: bucket,
      OutputKey: `preprocess/transcripts/${jobName}.json`,
      Settings: { ShowSpeakerLabels: false },
    })
  );

  // 3) ポーリングで完了待ち
  let transcriptText = "";
  let transcriptSegments: Array<{ start: number; end: number; text: string }> = [];
  let pollCount = 0;
  const maxPoll = 360; // 30 分 (5秒間隔)
  while (pollCount < maxPoll) {
    await sleep(5000);
    pollCount++;
    const status = await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    const s = status.TranscriptionJob?.TranscriptionJobStatus;
    if (pollCount % 6 === 0) console.log(`   ジョブ状態: ${s} (${(pollCount * 5)}s 経過)`);
    if (s === "COMPLETED") {
      const transcriptUri = status.TranscriptionJob?.Transcript?.TranscriptFileUri;
      if (!transcriptUri) throw new Error("Transcript URI 未取得");
      console.log(`   ✅ 文字起こし完了`);
      const r = await fetch(transcriptUri);
      const j: any = await r.json();
      transcriptText = j?.results?.transcripts?.[0]?.transcript ?? "";
      const items: any[] = j?.results?.items ?? [];
      // 連続発話で簡易セグメント化
      let buffer: any[] = [];
      let lastEndSec = 0;
      for (const it of items) {
        if (it.type === "punctuation" && buffer.length > 0) {
          buffer.push(it);
          continue;
        }
        if (it.type === "pronunciation") {
          buffer.push(it);
          const startSec = parseFloat(it.start_time ?? "0");
          if (startSec - lastEndSec > 3 && buffer.length > 4) {
            const segText = buffer.map((b) => b.alternatives?.[0]?.content ?? "").join("");
            const start = parseFloat(buffer[0].start_time ?? "0");
            const end = parseFloat(buffer[buffer.length - 1].end_time ?? "0");
            transcriptSegments.push({ start, end, text: segText });
            buffer = [];
          }
          lastEndSec = parseFloat(it.end_time ?? "0");
        }
      }
      if (buffer.length > 0) {
        const segText = buffer.map((b) => b.alternatives?.[0]?.content ?? "").join("");
        const start = parseFloat(buffer[0].start_time ?? "0");
        const end = parseFloat(buffer[buffer.length - 1].end_time ?? "0");
        transcriptSegments.push({ start, end, text: segText });
      }
      break;
    }
    if (s === "FAILED") {
      throw new Error(`Transcribe ジョブ失敗: ${status.TranscriptionJob?.FailureReason ?? "unknown"}`);
    }
  }
  if (!transcriptText) throw new Error("Transcribe ジョブがタイムアウトしました (30 分超)");

  // 4) クリーンアップ (S3 オブジェクトと Transcribe ジョブ)
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    console.log(`🧹 S3 オブジェクト削除`);
  } catch {}
  try {
    await transcribe.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    console.log(`🧹 Transcribe ジョブ削除`);
  } catch {}

  const segMd = transcriptSegments
    .map((s) => `- ${formatTimestamp(s.start)}–${formatTimestamp(s.end)}  ${s.text}`)
    .join("\n");

  return (
    buildFrontMatter({
      source_file_id: fileId,
      title: fileMeta.name ?? "",
      mime_type: fileMeta.mimeType,
      processed_at: nowIso(),
      processor: "preprocess-manual.ts",
      transcribe_job: jobName,
      duration_segments: transcriptSegments.length,
    }) +
    "## 全文字起こし\n\n```\n" +
    transcriptText +
    "\n```\n\n## 時間別セグメント\n\n" +
    segMd +
    "\n"
  );
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// =====================================================================
// YouTube URL 処理
// =====================================================================
export async function processYouTube(input: string): Promise<string> {
  const videoId = extractYouTubeId(input);
  if (!videoId) throw new Error("YouTube video ID を抽出できませんでした");
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY 未設定。YouTube Data API v3 のキーを環境変数に設定してください");
  }

  console.log(`📺 YouTube: videoId=${videoId}`);

  // 動画メタ取得
  const youtube = google.youtube({ version: "v3", auth: apiKey });
  const videoRes = await youtube.videos.list({ part: ["snippet"], id: [videoId] });
  const v = videoRes.data.items?.[0];
  if (!v) throw new Error("動画が見つかりません (公開設定確認)");
  const title = v.snippet?.title ?? "";
  const description = v.snippet?.description ?? "";

  // 字幕トラック一覧
  const capRes = await youtube.captions.list({ part: ["snippet"], videoId });
  const tracks = capRes.data.items ?? [];
  console.log(`   字幕トラック ${tracks.length} 個`);

  let captionText = "";
  if (tracks.length === 0) {
    captionText = "> ⚠️ 字幕トラックが存在しません。Transcribe による文字起こしを別途検討してください。";
  } else {
    // 日本語があれば優先、なければ最初の自動生成 (asr) を採用
    const preferred =
      tracks.find((t) => t.snippet?.language === "ja" && t.snippet?.trackKind !== "asr") ??
      tracks.find((t) => t.snippet?.language === "ja") ??
      tracks[0];
    const captionId = preferred.id!;
    try {
      const dl = await youtube.captions.download({ id: captionId, tfmt: "srt" });
      captionText = String((dl.data as any) || "");
    } catch (e: any) {
      captionText = `> ⚠️ 字幕ダウンロード失敗 (一般に Service Account では取得できない / 動画所有者の OAuth が必要)。\n> エラー: ${e?.message ?? String(e)}\n> 代替案: \`yt-dlp\` でローカル取得するか、Transcribe を使う。`;
    }
  }

  return (
    buildFrontMatter({
      source_youtube_id: videoId,
      title,
      processed_at: nowIso(),
      processor: "preprocess-manual.ts",
    }) +
    `## 動画情報\n\n- **タイトル**: ${title}\n- **YouTube URL**: https://www.youtube.com/watch?v=${videoId}\n\n## 概要 (description)\n\n${description}\n\n## 字幕 (caption)\n\n${captionText}\n`
  );
}

// =====================================================================
// 汎用エントリ: バッチからも呼べる
// =====================================================================
export type PreprocessResult = {
  markdown: string;
  sourceType:
    | "google-slides"
    | "pptx"
    | "google-docs"
    | "docx"
    | "pdf"
    | "google-sheets"
    | "xlsx"
    | "video"
    | "youtube"
    | "unsupported";
  sourceId?: string;
  fileName?: string;
};

/**
 * 任意の入力 (Drive ファイル ID, URL, YouTube URL) を Markdown に変換。
 * バッチ処理から再利用するためのトップレベル関数。
 */
export async function preprocessOne(input: string): Promise<PreprocessResult> {
  const ytId = extractYouTubeIfApplicable(input);
  if (ytId) {
    return {
      markdown: await processYouTube(input),
      sourceType: "youtube",
      sourceId: ytId,
    };
  }

  // Drive ファイル ID もしくは Drive URL からファイル ID 抽出
  const fileId = extractDriveFileId(input) ?? input;

  const auth = getGoogleAuth();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });

  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, modifiedTime, owners, size",
    supportsAllDrives: true,
  });
  const m = meta.data;
  const mime = m.mimeType ?? "";
  const fileName = m.name ?? "";

  let markdown = "";
  let cleanup: (() => Promise<void>) | null = null;
  let sourceType: PreprocessResult["sourceType"] = "unsupported";

  try {
    if (mime === "application/vnd.google-apps.presentation") {
      sourceType = "google-slides";
      markdown = await processSlides(auth, fileId, m);
    } else if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      sourceType = "pptx";
      const conv = await convertToNative(auth, fileId, m.name ?? "tmp", "application/vnd.google-apps.presentation");
      cleanup = conv.cleanup;
      markdown = await processSlides(auth, conv.tmpId, { ...m, mimeType: `${mime} (converted)` });
    } else if (mime === "application/vnd.google-apps.document") {
      sourceType = "google-docs";
      markdown = await processDocs(auth, fileId, m);
    } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      sourceType = "docx";
      const conv = await convertToNative(auth, fileId, m.name ?? "tmp", "application/vnd.google-apps.document");
      cleanup = conv.cleanup;
      markdown = await processDocs(auth, conv.tmpId, { ...m, mimeType: `${mime} (converted)` });
    } else if (mime === "application/pdf") {
      sourceType = "pdf";
      markdown = await processPdf(auth, fileId, m);
    } else if (mime === "application/vnd.google-apps.spreadsheet") {
      sourceType = "google-sheets";
      markdown = await processSheets(auth, fileId, m);
    } else if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      sourceType = "xlsx";
      markdown = await processXlsx(auth, fileId, m);
    } else if (mime.startsWith("video/")) {
      sourceType = "video";
      markdown = await processVideo(auth, fileId, m);
    } else {
      throw new Error(`未対応の mimeType: ${mime}`);
    }
    return { markdown, sourceType, sourceId: fileId, fileName };
  } finally {
    if (cleanup) {
      try { await cleanup(); } catch (e: any) { console.warn(`tmp 削除エラー: ${e?.message ?? String(e)}`); }
    }
  }
}

/** 入力が YouTube URL/ID なら video ID を返す。Drive 形式ならば null */
function extractYouTubeIfApplicable(input: string): string | null {
  if (input.includes("youtu") || (/^[A-Za-z0-9_-]{11}$/.test(input) && !input.startsWith("1"))) {
    return extractYouTubeId(input);
  }
  return null;
}

/** Drive URL から fileId を抽出 (URL でなく ID 直接ならそのまま返す) */
export function extractDriveFileId(input: string): string | null {
  if (!input) return null;
  // 既に fileId 形式なら (33文字程度の英数字)
  if (/^[A-Za-z0-9_-]{20,}$/.test(input)) return input;
  const m = input.match(/(?:drive\.google\.com\/file\/d\/|docs\.google\.com\/(?:presentation|document|spreadsheets)\/d\/|drive\.google\.com\/open\?id=)([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

// =====================================================================
// メイン (CLI 直接実行時のみ動作)
// =====================================================================
async function main() {
  const args = process.argv.slice(2);
  const target = args[0];
  if (!target) {
    console.error("Usage: npx tsx scripts/preprocess-manual.ts <DriveFileId|YouTubeURL> [--out=path.md]");
    process.exit(1);
  }
  const outArg = args.find((a) => a.startsWith("--out="));

  // YouTube URL / ID なら専用パス
  const ytId = target.includes("youtu") || /^[A-Za-z0-9_-]{11}$/.test(target) ? extractYouTubeId(target) : null;
  if (ytId) {
    const outPath = outArg
      ? outArg.slice("--out=".length)
      : path.resolve(process.cwd(), "output", `yt-${ytId}.md`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const md = await processYouTube(target);
    fs.writeFileSync(outPath, md, "utf8");
    console.log(`✅ 出力完了: ${outPath} (${md.length} chars)`);
    return;
  }

  // Drive ファイル系
  const fileId = target;
  const outPath = outArg
    ? outArg.slice("--out=".length)
    : path.resolve(process.cwd(), "output", `${fileId}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const auth = getGoogleAuth();
  await auth.authorize();

  const drive = google.drive({ version: "v3", auth });
  console.log(`🔍 メタ情報を取得 (fileId=${fileId})`);
  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, modifiedTime, owners, size",
    supportsAllDrives: true,
  });
  const m = meta.data;
  console.log(`   name: ${m.name}`);
  console.log(`   mimeType: ${m.mimeType}`);
  console.log(`   size: ${m.size}`);

  let markdown = "";
  let cleanup: (() => Promise<void>) | null = null;

  try {
    const mime = m.mimeType ?? "";
    if (mime === "application/vnd.google-apps.presentation") {
      markdown = await processSlides(auth, fileId, m);
    } else if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      const conv = await convertToNative(auth, fileId, m.name ?? "tmp", "application/vnd.google-apps.presentation");
      cleanup = conv.cleanup;
      markdown = await processSlides(auth, conv.tmpId, { ...m, mimeType: `${mime} (converted)` });
    } else if (mime === "application/vnd.google-apps.document") {
      markdown = await processDocs(auth, fileId, m);
    } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const conv = await convertToNative(auth, fileId, m.name ?? "tmp", "application/vnd.google-apps.document");
      cleanup = conv.cleanup;
      markdown = await processDocs(auth, conv.tmpId, { ...m, mimeType: `${mime} (converted)` });
    } else if (mime === "application/pdf") {
      markdown = await processPdf(auth, fileId, m);
    } else if (mime === "application/vnd.google-apps.spreadsheet") {
      markdown = await processSheets(auth, fileId, m);
    } else if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      markdown = await processXlsx(auth, fileId, m);
    } else if (mime.startsWith("video/")) {
      markdown = await processVideo(auth, fileId, m);
    } else {
      console.error(`❌ 未対応の mimeType: ${mime}`);
      process.exit(2);
    }

    fs.writeFileSync(outPath, markdown, "utf8");
    console.log(`✅ 出力完了: ${outPath} (${markdown.length} chars)`);
  } finally {
    if (cleanup) {
      try { await cleanup(); } catch (e: any) { console.warn(`tmp 削除エラー: ${e?.message ?? String(e)}`); }
    }
  }
}

// CLI から直接実行されたときのみ main() を呼び出す (バッチからの import 時には実行しない)
const isCliEntry = (process.argv[1] ?? "").endsWith("preprocess-manual.ts");
if (isCliEntry) {
  main().catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
}
