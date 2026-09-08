// scripts/preprocess-manual.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { google } from "googleapis";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand
} from "@aws-sdk/client-transcribe";
import * as XLSX from "xlsx";
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
    if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFromFile();
function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim().startsWith("{")) {
    const json = JSON.parse(raw);
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  }
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(abs)) throw new Error(`Service account JSON not found at: ${abs}`);
    const json = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  }
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac && fs.existsSync(gac)) {
    const json = JSON.parse(fs.readFileSync(gac, "utf8"));
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  }
  throw new Error(
    "Service account credentials not found. Set GOOGLE_SERVICE_ACCOUNT_JSON (JSON), GOOGLE_SERVICE_ACCOUNT_JSON_PATH (file path), or GOOGLE_APPLICATION_CREDENTIALS (file path)"
  );
}
function getGoogleAuth() {
  const sa = loadServiceAccount();
  return new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/presentations.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly"
    ]
  });
}
var AWS_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
var BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-4-6";
// 画像中心/抽出失敗PDFを直読みする vision は精度重視で Opus 4.8(OCRの代替。全ページを理解し「# ページN」構造で出力)。
var PDF_VISION_MODEL_ID = process.env.PDF_VISION_MODEL_ID || "us.anthropic.claude-opus-4-8";
// pptx/docx の Google native 変換コピー先。サービスアカウントは My Drive 容量が実質0のため、
// 共有ドライブ(SAがメンバー・書込可)にコピーして quota exceeded を回避する。
var CONVERT_DRIVE_ID = process.env.PREPROCESS_CONVERT_DRIVE_ID || "0AJGh0hH-_9qWUk9PVA"; // 共有ドライブ「マニュアル自動生成」
var bedrock = new BedrockRuntimeClient({ region: AWS_REGION });
var textract = new TextractClient({ region: AWS_REGION });
var s3 = new S3Client({ region: AWS_REGION });
var transcribe = new TranscribeClient({ region: AWS_REGION });
async function describeImageWithClaude(imageBase64, mediaType, instruction) {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 2e3,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: instruction }
        ]
      }
    ]
  };
  const cmd = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    body: JSON.stringify(body),
    contentType: "application/json",
    accept: "application/json"
  });
  const res = await bedrock.send(cmd);
  const decoded = JSON.parse(Buffer.from(res.body).toString("utf-8"));
  const text = decoded?.content?.[0]?.text ?? decoded?.completion ?? "";
  return String(text || "").trim();
}
// PDF(またはその抜粋)を document ブロックで Opus に投入し、startPage から連番の「# ページ N + 要約」を得る。
async function visionOnePdf(buf, startPage) {
  const b64 = Buffer.from(buf).toString("base64");
  const instruction = `これはマニュアル資料(PDF)の抜粋です。この抜粋の1ページ目は元資料の ${startPage} ページ目です。
後で目次を作るための前処理として、各ページの内容を読み取ってください。
出力は次の Markdown 形式のみ(前置き・説明・コードフェンス禁止):

# ページ ${startPage}
(このページの主題・見出し・重要な要素を日本語で簡潔に。図や画像内の文字も読み取る。1〜4行)

# ページ ${startPage + 1}
(...)

必ず ${startPage} から連番の実ページ番号で「# ページ N」を1ページずつ出力してください。空白ページは「(空白)」と書いてください。`;
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 8e3,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: instruction }
        ]
      }
    ]
  };
  const cmd = new InvokeModelCommand({
    modelId: PDF_VISION_MODEL_ID,
    body: JSON.stringify(body),
    contentType: "application/json",
    accept: "application/json"
  });
  const res = await bedrock.send(cmd);
  const decoded = JSON.parse(Buffer.from(res.body).toString("utf-8"));
  return String((decoded?.content ?? []).map((b) => b.text ?? "").join("") || "").trim();
}
// pdf-lib で [start, end) ページの部分PDFを作って Uint8Array で返す。
async function subPdfBytes(PDFDocument, src, startIdx, endIdx) {
  const doc = await PDFDocument.create();
  const idxs = [];
  for (let p = startIdx; p < endIdx; p++) idxs.push(p);
  const pages = await doc.copyPages(src, idxs);
  pages.forEach((pg) => doc.addPage(pg));
  return await doc.save();
}
// 画像中心/抽出失敗PDFを Opus vision で直読み(OCR代替)。Bedrock 同期の上限を超える大きいPDFは
// pdf-lib でページ範囲に分割し、各抜粋を実ページ番号で読み取って連結する。
async function describePdfWithClaude(buf) {
  // Bedrock InvokeModel の本文サイズ上限(実測: base64後~13MBは可/~16MBは不可)に収めるため
  // 1チャンクのPDFを ~7MB 以下(base64~9.4MB)に抑える。
  const SAFE = 7 * 1024 * 1024;
  const HARD = 9 * 1024 * 1024; // これを超えたチャンクは更に半分へ
  const safeVision = async (bytes, startPage) => {
    // 1チャンク失敗が全体を壊さないよう個別に握りつぶす。
    try { return await visionOnePdf(Buffer.from(bytes), startPage); }
    catch (e) { console.warn(`   vision失敗(page${startPage}~): ${e?.message ?? String(e)}`); return ""; }
  };
  if (buf.byteLength <= SAFE) return await safeVision(buf, 1);

  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(buf, { ignoreEncryption: true, throwOnInvalidObject: false });
  const total = src.getPageCount();
  const avg = buf.byteLength / Math.max(1, total);
  const per = Math.max(1, Math.floor(SAFE / Math.max(1, avg))); // 目標ページ/チャンク
  console.log(`   \u{1F9E9} 大きいPDF(${(buf.byteLength / 1048576).toFixed(0)}MB/${total}p) を分割: ~${per}ページ/チャンク`);
  const parts = [];
  for (let start = 0; start < total; start += per) {
    const end = Math.min(start + per, total);
    const bytes = await subPdfBytes(PDFDocument, src, start, end);
    // 単ページでも共有画像の複製で肥大するPDFがある。事前スキップせず送ってみて、
    // Bedrockが受ければ採用・拒否すれば safeVision が握りつぶす(=そのページだけ欠落)。
    // 明らかに上限外(base64で確実に超える ~16MB)だけ諦める。
    const ABS = 16 * 1024 * 1024;
    if (bytes.length > HARD && end - start > 1) {
      for (let p = start; p < end; p++) {
        const sb = await subPdfBytes(PDFDocument, src, p, p + 1);
        if (sb.length > ABS) { console.warn(`   ページ${p + 1}が巨大(${(sb.length / 1048576).toFixed(1)}MB) vision不可`); continue; }
        const md1 = await safeVision(sb, p + 1);
        if (md1) parts.push(md1);
      }
      continue;
    }
    if (bytes.length > ABS) { console.warn(`   ページ${start + 1}が巨大 vision不可`); continue; }
    const md = await safeVision(bytes, start + 1);
    if (md) parts.push(md);
  }
  return parts.join("\n\n").trim();
}
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    const u8 = Buffer.isBuffer(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : new Uint8Array(chunk);
    chunks.push(u8);
  }
  return Buffer.concat(chunks);
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function buildFrontMatter(props) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(props)) {
    if (v === void 0 || v === null) continue;
    if (typeof v === "string") lines.push(`${k}: ${JSON.stringify(v)}`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function extractYouTubeId(input) {
  const u = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(u)) return u;
  const m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? null;
}
async function processSlides(auth, fileId, fileMeta) {
  const slides = google.slides({ version: "v1", auth });
  console.log("\u{1F4C4} Google Slides \u3092\u53D6\u5F97\u3057\u3066\u3044\u307E\u3059...");
  const pres = await slides.presentations.get({ presentationId: fileId });
  const pageCount = pres.data.slides?.length ?? 0;
  console.log(`   ${pageCount} \u679A\u306E\u30B9\u30E9\u30A4\u30C9`);
  const sections = [];
  for (let i = 0; i < pageCount; i++) {
    const slide = pres.data.slides[i];
    const objectId = slide.objectId;
    console.log(`   [${i + 1}/${pageCount}] \u30B9\u30E9\u30A4\u30C9\u51E6\u7406\u4E2D (id=${objectId})`);
    const extractedText = extractTextFromSlide(slide).trim();
    const notes = extractNotes(slide).trim();
    const thumb = await slides.presentations.pages.getThumbnail({
      presentationId: fileId,
      pageObjectId: objectId,
      "thumbnailProperties.mimeType": "PNG",
      "thumbnailProperties.thumbnailSize": "LARGE"
    });
    const imgRes = await fetch(thumb.data.contentUrl);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const imgB64 = imgBuf.toString("base64");
    const instruction = [
      "\u3042\u306A\u305F\u306F\u793E\u5185\u30DE\u30CB\u30E5\u30A2\u30EB\u3092 AI \u691C\u7D22\u53EF\u80FD\u306A Markdown \u306B\u5909\u63DB\u3059\u308B\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\u3067\u3059\u3002",
      "\u3053\u306E\u30B9\u30E9\u30A4\u30C9\u306E\u5185\u5BB9\u3092\u3001\u898B\u51FA\u3057\u30FB\u7B87\u6761\u66F8\u304D\u30FB\u8868\u3092\u9069\u5207\u306B\u4F7F\u3063\u305F Markdown \u3067\u8A73\u3057\u304F\u8AAC\u660E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "\u30B9\u30AF\u30EA\u30FC\u30F3\u30B7\u30E7\u30C3\u30C8\u3084\u56F3\u304C\u3042\u308B\u5834\u5408\u306F\u3001\u4F55\u304C\u6620\u3063\u3066\u3044\u308B\u304B\u5177\u4F53\u7684\u306B\u8A18\u8FF0\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "\u30B9\u30E9\u30A4\u30C9\u5185\u306E\u30C6\u30AD\u30B9\u30C8\u306F\u53EF\u80FD\u306A\u9650\u308A\u6B63\u78BA\u306B\u6587\u5B57\u8D77\u3053\u3057\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "\u51FA\u529B\u306F Markdown \u672C\u6587\u306E\u307F\u3002\u524D\u7F6E\u304D\u306F\u4E0D\u8981\u3002"
    ].join("\n");
    let visionMd = "";
    try {
      visionMd = await describeImageWithClaude(imgB64, "image/png", instruction);
    } catch (e) {
      visionMd = `> \u26A0\uFE0F Vision LLM \u547C\u3073\u51FA\u3057\u5931\u6557: ${e?.message ?? String(e)}`;
    }
    const block = [];
    block.push(`# \u30B9\u30E9\u30A4\u30C9 ${i + 1}`, "");
    if (extractedText) {
      block.push("## \u62BD\u51FA\u30C6\u30AD\u30B9\u30C8 (Slides API)", "", "```", extractedText, "```", "");
    }
    block.push("## \u5185\u5BB9 (Vision LLM \u89E3\u6790)", "", visionMd, "");
    if (notes) {
      block.push("## \u30B9\u30D4\u30FC\u30AB\u30FC\u30CE\u30FC\u30C8", "", notes, "");
    }
    sections.push(block.join("\n"));
  }
  return buildFrontMatter({
    source_file_id: fileId,
    title: fileMeta.name ?? "",
    mime_type: fileMeta.mimeType,
    processed_at: nowIso(),
    processor: "preprocess-manual.ts",
    bedrock_model: BEDROCK_MODEL_ID,
    slide_count: pageCount
  }) + sections.join("\n---\n\n");
}
function extractTextFromSlide(slide) {
  const lines = [];
  const visit = (el) => {
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
        const rowCells = [];
        for (const cell of row.tableCells ?? []) {
          const cellEls = cell?.text?.textElements ?? [];
          rowCells.push(cellEls.map((te) => te?.textRun?.content ?? "").join("").trim());
        }
        if (rowCells.some(Boolean)) lines.push(rowCells.join(" | "));
      }
    }
  };
  for (const el of slide?.pageElements ?? []) visit(el);
  return lines.join("").replace(/\n{3,}/g, "\n\n");
}
function extractNotes(slide) {
  const notesPage = slide?.slideProperties?.notesPage;
  if (!notesPage) return "";
  return extractTextFromSlide(notesPage);
}
async function convertToNative(auth, fileId, name, targetMime) {
  const drive = google.drive({ version: "v3", auth });
  console.log(`\u{1F504} ${targetMime} \u306B\u5909\u63DB\u4E2D...`);
  const copy = await drive.files.copy({
    fileId,
    supportsAllDrives: true,
    // 共有ドライブに作成(SAのMy Drive容量0による quota exceeded を回避)。
    requestBody: { name: `${name} (preprocess-tmp)`, mimeType: targetMime, parents: [CONVERT_DRIVE_ID] }
  });
  const tmpId = copy.data.id;
  console.log(`   \u5909\u63DB\u5B8C\u4E86 (tmp id=${tmpId})`);
  return {
    tmpId,
    cleanup: async () => {
      try {
        await drive.files.delete({ fileId: tmpId, supportsAllDrives: true });
        console.log(`\u{1F9F9} tmp \u30D5\u30A1\u30A4\u30EB\u524A\u9664 (${tmpId})`);
      } catch (e) {
        console.warn(`tmp \u30D5\u30A1\u30A4\u30EB\u524A\u9664\u5931\u6557: ${e?.message ?? String(e)}`);
      }
    }
  };
}
async function processDocs(auth, fileId, fileMeta) {
  const docs = google.docs({ version: "v1", auth });
  console.log("\u{1F4DD} Google Docs \u3092\u53D6\u5F97\u3057\u3066\u3044\u307E\u3059...");
  const doc = await docs.documents.get({ documentId: fileId });
  const lines = [];
  const body = doc.data.body?.content ?? [];
  for (const el of body) {
    const para = el.paragraph;
    if (!para) continue;
    const style = para.paragraphStyle?.namedStyleType ?? "";
    const text = (para.elements ?? []).map((e) => e?.textRun?.content ?? "").join("").replace(/\n+$/, "");
    if (!text) continue;
    if (style === "TITLE") lines.push(`# ${text}`);
    else if (style === "HEADING_1") lines.push(`## ${text}`);
    else if (style === "HEADING_2") lines.push(`### ${text}`);
    else if (style === "HEADING_3") lines.push(`#### ${text}`);
    else lines.push(text);
    lines.push("");
  }
  return buildFrontMatter({
    source_file_id: fileId,
    title: fileMeta.name ?? "",
    mime_type: fileMeta.mimeType,
    processed_at: nowIso(),
    processor: "preprocess-manual.ts"
  }) + lines.join("\n");
}
async function processPdf(auth, fileId, fileMeta) {
  const drive = google.drive({ version: "v3", auth });
  console.log("\u{1F4D5} PDF \u3092\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3057\u3066\u3044\u307E\u3059...");
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  const buf = await streamToBuffer(res.data);
  let extracted = "";
  let extractionMethod = "pdf-parse";
  try {
    const mod = await import("pdf-parse");
    const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
    if (typeof PDFParse !== "function") throw new Error("PDFParse class not found in pdf-parse");
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      extracted = String(result?.text || "").trim();
      const pages = result?.total ?? result?.numpages ?? "?";
      console.log(`   ${pages} \u30DA\u30FC\u30B8 / pdf-parse \u62BD\u51FA ${extracted.length} \u6587\u5B57`);
    } finally {
      try {
        await parser.destroy?.();
      } catch {
      }
    }
  } catch (e) {
    console.warn(`   pdf-parse \u30A8\u30E9\u30FC: ${e?.message ?? String(e)}`);
  }
  if (extracted.length === 0) {
    console.log("   \u26A0\uFE0F pdf-parse \u3067\u62BD\u51FA\u30BC\u30ED\u3002Textract OCR \u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\u3092\u8A66\u884C...");
    try {
      if (buf.byteLength < 5 * 1024 * 1024) {
        const cmd = new DetectDocumentTextCommand({ Document: { Bytes: new Uint8Array(buf) } });
        const r = await textract.send(cmd);
        const blocks = r.Blocks ?? [];
        extracted = blocks.filter((b) => b.BlockType === "LINE").map((b) => b.Text ?? "").join("\n");
        extractionMethod = "textract-sync";
        console.log(`   \u2705 Textract \u62BD\u51FA ${extracted.length} \u6587\u5B57`);
      } else {
        extracted = `> \u26A0\uFE0F Textract \u540C\u671F API \u306F 5MB \u4EE5\u4E0A\u306E PDF \u306B\u672A\u5BFE\u5FDC\u3002\u975E\u540C\u671F (S3 \u7D4C\u7531 StartDocumentTextDetection) \u306E\u5B9F\u88C5\u304C\u5FC5\u8981\u3002
> \u30D5\u30A1\u30A4\u30EB\u30B5\u30A4\u30BA: ${buf.byteLength} bytes`;
        extractionMethod = "skipped-large";
      }
    } catch (e) {
      extracted = `> \u26A0\uFE0F Textract \u547C\u3073\u51FA\u3057\u5931\u6557: ${e?.message ?? String(e)}`;
      extractionMethod = "textract-failed";
    }
  }
  // \u62BD\u51FA\u304C\u307B\u307C\u7A7A(=\u753B\u50CF\u4E2D\u5FC3PDF / skipped-large \u7B49)\u306F Opus vision \u3067\u5168\u30DA\u30FC\u30B8\u3092\u76F4\u8AAD\u307F\u3057\u3066
  // \u300C# \u30DA\u30FC\u30B8 N + \u8981\u7D04\u300D\u306E Markdown \u3092\u751F\u6210\u3059\u308B\u3002\u901A\u5E38\u306E\u30C6\u30AD\u30B9\u30C8PDF\u306F\u5F93\u6765\u3069\u304A\u308A(\u8FFD\u52A0\u30B3\u30B9\u30C80)\u3002
  let visionMd = "";
  // \u5927\u304D\u3044PDF\u306F describePdfWithClaude \u5185\u3067\u30DA\u30FC\u30B8\u5206\u5272\u3057\u3066\u51E6\u7406\u3059\u308B\u306E\u3067\u4E0A\u9650\u306F\u7DE9\u3081(\u524D\u51E6\u7406\u30B3\u30B9\u30C8\u904E\u5927\u306E\u66B4\u8D70\u306E\u307F\u6291\u6B62)\u3002
  const VISION_MAX_BYTES = 150 * 1024 * 1024;
  if (extracted.replace(/\s+/g, "").length < 600 && buf.byteLength <= VISION_MAX_BYTES) {
    try {
      console.log("   \u{1F50E} \u62BD\u51FA\u4E0D\u5341\u5206\u3002Opus vision \u3067 PDF \u3092\u76F4\u8AAD\u307F...");
      visionMd = await describePdfWithClaude(buf);
      if (visionMd) {
        extractionMethod = "opus-vision";
        console.log(`   \u2705 vision \u751F\u6210 ${visionMd.length} \u6587\u5B57`);
      }
    } catch (e) {
      console.warn(`   vision \u30A8\u30E9\u30FC: ${e?.message ?? String(e)}`);
    }
  }
  const front = buildFrontMatter({
    source_file_id: fileId,
    title: fileMeta.name ?? "",
    mime_type: fileMeta.mimeType,
    processed_at: nowIso(),
    processor: "preprocess-manual.ts",
    extraction_method: extractionMethod,
    pdf_bytes: buf.byteLength
  });
  if (visionMd) return front + visionMd + "\n";
  return front + "## \u62BD\u51FA\u30C6\u30AD\u30B9\u30C8\n\n```\n" + extracted.slice(0, 1e5) + "\n```\n";
}
async function processSheets(auth, fileId, fileMeta) {
  const sheetsApi = google.sheets({ version: "v4", auth });
  console.log("\u{1F4CA} Google Sheets \u3092\u53D6\u5F97\u3057\u3066\u3044\u307E\u3059...");
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: fileId });
  const sheetNames = (meta.data.sheets ?? []).map((s) => s.properties?.title).filter((n) => !!n);
  console.log(`   ${sheetNames.length} \u30B7\u30FC\u30C8: ${sheetNames.join(", ")}`);
  const sections = [];
  for (const sheetName of sheetNames) {
    const valuesRes = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: fileId,
      range: `'${sheetName}'`
    });
    const rows = valuesRes.data.values ?? [];
    const md = rowsToMarkdownTable(rows);
    sections.push(`## ${sheetName}

${md}
`);
  }
  return buildFrontMatter({
    source_file_id: fileId,
    title: fileMeta.name ?? "",
    mime_type: fileMeta.mimeType,
    processed_at: nowIso(),
    processor: "preprocess-manual.ts",
    sheet_count: sheetNames.length
  }) + sections.join("\n---\n\n");
}
async function processXlsx(auth, fileId, fileMeta) {
  const drive = google.drive({ version: "v3", auth });
  console.log("\u{1F4CA} XLSX \u3092\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3057\u3066\u3044\u307E\u3059...");
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  const buf = await streamToBuffer(res.data);
  const wb = XLSX.read(buf, { type: "buffer" });
  console.log(`   ${wb.SheetNames.length} \u30B7\u30FC\u30C8: ${wb.SheetNames.join(", ")}`);
  const sections = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const md = rowsToMarkdownTable(rows);
    sections.push(`## ${sheetName}

${md}
`);
  }
  return buildFrontMatter({
    source_file_id: fileId,
    title: fileMeta.name ?? "",
    mime_type: fileMeta.mimeType,
    processed_at: nowIso(),
    processor: "preprocess-manual.ts",
    sheet_count: wb.SheetNames.length
  }) + sections.join("\n---\n\n");
}
function rowsToMarkdownTable(rows) {
  if (!rows || rows.length === 0) return "_(\u7A7A\u306E\u30B7\u30FC\u30C8)_";
  const maxCols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => Array.from({ length: maxCols }, (_, i) => formatCell(r[i])));
  const head = norm[0];
  const body = norm.slice(1);
  const headerLine = `| ${head.join(" | ")} |`;
  const separator = `| ${head.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map((r) => `| ${r.join(" | ")} |`);
  const MAX_ROWS = 200;
  if (bodyLines.length > MAX_ROWS) {
    return [headerLine, separator, ...bodyLines.slice(0, MAX_ROWS), `| ... | _(${bodyLines.length - MAX_ROWS} \u884C\u7701\u7565)_ |`].join("\n");
  }
  return [headerLine, separator, ...bodyLines].join("\n");
}
function formatCell(v) {
  if (v === null || v === void 0) return "";
  const s = String(v).trim();
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
async function processVideo(auth, fileId, fileMeta) {
  const bucket = process.env.PREPROCESS_TRANSCRIBE_BUCKET;
  if (!bucket) {
    throw new Error(
      "PREPROCESS_TRANSCRIBE_BUCKET \u304C\u672A\u8A2D\u5B9A\u3002\u52D5\u753B\u6587\u5B57\u8D77\u3053\u3057\u306B\u306F S3 \u30D0\u30B1\u30C3\u30C8\u540D\u3092\u74B0\u5883\u5909\u6570\u306B\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044 (\u4F8B: knowbie-transcribe-tmp)"
    );
  }
  const drive = google.drive({ version: "v3", auth });
  console.log("\u{1F3AC} \u52D5\u753B\u3092\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3057\u3066\u3044\u307E\u3059...");
  const dlRes = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  const buf = await streamToBuffer(dlRes.data);
  console.log(`   \u30B5\u30A4\u30BA: ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB`);
  const ext = (fileMeta.name?.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".mp4").toLowerCase();
  const objectKey = `preprocess/${fileId}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  console.log(`   S3 \u3078\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9: s3://${bucket}/${objectKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buf,
      ContentType: fileMeta.mimeType
    })
  );
  const jobName = `preprocess-${fileId.slice(0, 16)}-${Date.now()}`;
  const mediaUri = `s3://${bucket}/${objectKey}`;
  const mediaFormat = ext.replace(".", "").toLowerCase().replace("mov", "mp4");
  console.log(`   Transcribe \u30B8\u30E7\u30D6\u958B\u59CB: ${jobName}`);
  await transcribe.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: "ja-JP",
      Media: { MediaFileUri: mediaUri },
      MediaFormat: mediaFormat,
      OutputBucketName: bucket,
      OutputKey: `preprocess/transcripts/${jobName}.json`,
      Settings: { ShowSpeakerLabels: false }
    })
  );
  let transcriptText = "";
  let transcriptSegments = [];
  let pollCount = 0;
  const maxPoll = 360;
  while (pollCount < maxPoll) {
    await sleep(5e3);
    pollCount++;
    const status = await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    const s = status.TranscriptionJob?.TranscriptionJobStatus;
    if (pollCount % 6 === 0) console.log(`   \u30B8\u30E7\u30D6\u72B6\u614B: ${s} (${pollCount * 5}s \u7D4C\u904E)`);
    if (s === "COMPLETED") {
      console.log(`   \u2705 \u6587\u5B57\u8D77\u3053\u3057\u5B8C\u4E86`);
      const transcriptKey = `preprocess/transcripts/${jobName}.json`;
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: transcriptKey }));
      const bodyStr = await obj.Body.transformToString();
      const j = JSON.parse(bodyStr);
      transcriptText = j?.results?.transcripts?.[0]?.transcript ?? "";
      const items = j?.results?.items ?? [];
      let buffer = [];
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
      throw new Error(`Transcribe \u30B8\u30E7\u30D6\u5931\u6557: ${status.TranscriptionJob?.FailureReason ?? "unknown"}`);
    }
  }
  if (!transcriptText) throw new Error("Transcribe \u30B8\u30E7\u30D6\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F (30 \u5206\u8D85)");
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    console.log(`\u{1F9F9} S3 \u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u524A\u9664`);
  } catch {
  }
  try {
    await transcribe.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    console.log(`\u{1F9F9} Transcribe \u30B8\u30E7\u30D6\u524A\u9664`);
  } catch {
  }
  const segMd = transcriptSegments.map((s) => `- ${formatTimestamp(s.start)}\u2013${formatTimestamp(s.end)}  ${s.text}`).join("\n");
  return buildFrontMatter({
    source_file_id: fileId,
    title: fileMeta.name ?? "",
    mime_type: fileMeta.mimeType,
    processed_at: nowIso(),
    processor: "preprocess-manual.ts",
    transcribe_job: jobName,
    duration_segments: transcriptSegments.length
  }) + "## \u5168\u6587\u5B57\u8D77\u3053\u3057\n\n```\n" + transcriptText + "\n```\n\n## \u6642\u9593\u5225\u30BB\u30B0\u30E1\u30F3\u30C8\n\n" + segMd + "\n";
}
function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
async function processYouTube(input) {
  const videoId = extractYouTubeId(input);
  if (!videoId) throw new Error("YouTube video ID \u3092\u62BD\u51FA\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY \u672A\u8A2D\u5B9A\u3002YouTube Data API v3 \u306E\u30AD\u30FC\u3092\u74B0\u5883\u5909\u6570\u306B\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
  }
  console.log(`\u{1F4FA} YouTube: videoId=${videoId}`);
  const youtube = google.youtube({ version: "v3", auth: apiKey });
  const videoRes = await youtube.videos.list({ part: ["snippet"], id: [videoId] });
  const v = videoRes.data.items?.[0];
  if (!v) throw new Error("\u52D5\u753B\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093 (\u516C\u958B\u8A2D\u5B9A\u78BA\u8A8D)");
  const title = v.snippet?.title ?? "";
  const description = v.snippet?.description ?? "";
  const capRes = await youtube.captions.list({ part: ["snippet"], videoId });
  const tracks = capRes.data.items ?? [];
  console.log(`   \u5B57\u5E55\u30C8\u30E9\u30C3\u30AF ${tracks.length} \u500B`);
  let captionText = "";
  if (tracks.length === 0) {
    captionText = "> \u26A0\uFE0F \u5B57\u5E55\u30C8\u30E9\u30C3\u30AF\u304C\u5B58\u5728\u3057\u307E\u305B\u3093\u3002Transcribe \u306B\u3088\u308B\u6587\u5B57\u8D77\u3053\u3057\u3092\u5225\u9014\u691C\u8A0E\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
  } else {
    const preferred = tracks.find((t) => t.snippet?.language === "ja" && t.snippet?.trackKind !== "asr") ?? tracks.find((t) => t.snippet?.language === "ja") ?? tracks[0];
    const captionId = preferred.id;
    try {
      const dl = await youtube.captions.download({ id: captionId, tfmt: "srt" });
      captionText = String(dl.data || "");
    } catch (e) {
      captionText = `> \u26A0\uFE0F \u5B57\u5E55\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u5931\u6557 (\u4E00\u822C\u306B Service Account \u3067\u306F\u53D6\u5F97\u3067\u304D\u306A\u3044 / \u52D5\u753B\u6240\u6709\u8005\u306E OAuth \u304C\u5FC5\u8981)\u3002
> \u30A8\u30E9\u30FC: ${e?.message ?? String(e)}
> \u4EE3\u66FF\u6848: \`yt-dlp\` \u3067\u30ED\u30FC\u30AB\u30EB\u53D6\u5F97\u3059\u308B\u304B\u3001Transcribe \u3092\u4F7F\u3046\u3002`;
    }
  }
  return buildFrontMatter({
    source_youtube_id: videoId,
    title,
    processed_at: nowIso(),
    processor: "preprocess-manual.ts"
  }) + `## \u52D5\u753B\u60C5\u5831

- **\u30BF\u30A4\u30C8\u30EB**: ${title}
- **YouTube URL**: https://www.youtube.com/watch?v=${videoId}

## \u6982\u8981 (description)

${description}

## \u5B57\u5E55 (caption)

${captionText}
`;
}
async function preprocessOne(input) {
  const ytId = extractYouTubeIfApplicable(input);
  if (ytId) {
    return {
      markdown: await processYouTube(input),
      sourceType: "youtube",
      sourceId: ytId
    };
  }
  const fileId = extractDriveFileId(input) ?? input;
  const auth = getGoogleAuth();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });
  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, modifiedTime, owners, size",
    supportsAllDrives: true
  });
  const m = meta.data;
  const mime = m.mimeType ?? "";
  const fileName = m.name ?? "";
  let markdown = "";
  let cleanup = null;
  let sourceType = "unsupported";
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
      throw new Error(`\u672A\u5BFE\u5FDC\u306E mimeType: ${mime}`);
    }
    return { markdown, sourceType, sourceId: fileId, fileName };
  } finally {
    if (cleanup) {
      try {
        await cleanup();
      } catch (e) {
        console.warn(`tmp \u524A\u9664\u30A8\u30E9\u30FC: ${e?.message ?? String(e)}`);
      }
    }
  }
}
// 保存時チェック用: embedUrl のファイルにサービスアカウントがアクセスできるかだけを軽量に判定する。
// (処理はせずメタ情報 files.get のみ。YouTube/非Driveは対象外=accessible扱い)
export async function checkDriveAccess(input) {
  if (!input) return { applicable: false, accessible: false, reason: "embedUrl未設定" };
  if (extractYouTubeIfApplicable(input)) return { applicable: false, accessible: true, sourceType: "youtube" };
  const fileId = extractDriveFileId(input);
  if (!fileId) return { applicable: false, accessible: false, reason: "Driveリンクではありません" };
  try {
    const auth = getGoogleAuth();
    await auth.authorize();
    const drive = google.drive({ version: "v3", auth });
    const meta = await drive.files.get({ fileId, fields: "id,name,mimeType", supportsAllDrives: true });
    return { applicable: true, accessible: true, fileName: meta.data.name ?? "", mimeType: meta.data.mimeType ?? "" };
  } catch (e) {
    return { applicable: true, accessible: false, reason: e?.errors?.[0]?.reason || e?.message || String(e) };
  }
}
function extractYouTubeIfApplicable(input) {
  if (input.includes("youtu") || /^[A-Za-z0-9_-]{11}$/.test(input) && !input.startsWith("1")) {
    return extractYouTubeId(input);
  }
  return null;
}
function extractDriveFileId(input) {
  if (!input) return null;
  if (/^[A-Za-z0-9_-]{20,}$/.test(input)) return input;
  const m = input.match(/(?:drive\.google\.com\/file\/d\/|docs\.google\.com\/(?:presentation|document|spreadsheets)\/d\/|drive\.google\.com\/open\?id=)([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}
async function main() {
  const args = process.argv.slice(2);
  const target = args[0];
  if (!target) {
    console.error("Usage: npx tsx scripts/preprocess-manual.ts <DriveFileId|YouTubeURL> [--out=path.md]");
    process.exit(1);
  }
  const outArg = args.find((a) => a.startsWith("--out="));
  const ytId = target.includes("youtu") || /^[A-Za-z0-9_-]{11}$/.test(target) ? extractYouTubeId(target) : null;
  if (ytId) {
    const outPath2 = outArg ? outArg.slice("--out=".length) : path.resolve(process.cwd(), "output", `yt-${ytId}.md`);
    fs.mkdirSync(path.dirname(outPath2), { recursive: true });
    const md = await processYouTube(target);
    fs.writeFileSync(outPath2, md, "utf8");
    console.log(`\u2705 \u51FA\u529B\u5B8C\u4E86: ${outPath2} (${md.length} chars)`);
    return;
  }
  const fileId = target;
  const outPath = outArg ? outArg.slice("--out=".length) : path.resolve(process.cwd(), "output", `${fileId}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const auth = getGoogleAuth();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });
  console.log(`\u{1F50D} \u30E1\u30BF\u60C5\u5831\u3092\u53D6\u5F97 (fileId=${fileId})`);
  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, modifiedTime, owners, size",
    supportsAllDrives: true
  });
  const m = meta.data;
  console.log(`   name: ${m.name}`);
  console.log(`   mimeType: ${m.mimeType}`);
  console.log(`   size: ${m.size}`);
  let markdown = "";
  let cleanup = null;
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
      console.error(`\u274C \u672A\u5BFE\u5FDC\u306E mimeType: ${mime}`);
      process.exit(2);
    }
    fs.writeFileSync(outPath, markdown, "utf8");
    console.log(`\u2705 \u51FA\u529B\u5B8C\u4E86: ${outPath} (${markdown.length} chars)`);
  } finally {
    if (cleanup) {
      try {
        await cleanup();
      } catch (e) {
        console.warn(`tmp \u524A\u9664\u30A8\u30E9\u30FC: ${e?.message ?? String(e)}`);
      }
    }
  }
}
var isCliEntry = (process.argv[1] ?? "").endsWith("preprocess-manual.ts");
if (isCliEntry) {
  main().catch((err) => {
    console.error("\u274C Error:", err);
    process.exit(1);
  });
}
export {
  convertToNative,
  extractDriveFileId,
  extractYouTubeId,
  getGoogleAuth,
  preprocessOne,
  processDocs,
  processPdf,
  processSheets,
  processSlides,
  processVideo,
  processXlsx,
  processYouTube
};
