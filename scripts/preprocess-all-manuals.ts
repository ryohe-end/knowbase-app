/**
 * scripts/preprocess-all-manuals.ts
 *
 * DynamoDB の yamauchi-Manuals テーブルを Scan し、各マニュアルの embedUrl を
 * 既存の preprocessOne() で Markdown 化する。
 *
 * 使い方:
 *   npx tsx scripts/preprocess-all-manuals.ts                        # 全件
 *   npx tsx scripts/preprocess-all-manuals.ts --limit=10              # 10 件だけ
 *   npx tsx scripts/preprocess-all-manuals.ts --dry-run               # 何が処理対象かだけ出力
 *   npx tsx scripts/preprocess-all-manuals.ts --force                 # 既存出力を上書き
 *   npx tsx scripts/preprocess-all-manuals.ts --filter=入会            # title / desc / biz にキーワード一致するもののみ
 *   npx tsx scripts/preprocess-all-manuals.ts --skip-video             # 動画はスキップ (S3/Transcribe 未設定環境向け)
 *   npx tsx scripts/preprocess-all-manuals.ts --skip-youtube           # YouTube はスキップ
 *
 * 出力:
 *   output/<manualId>.md            ... 各マニュアルの変換結果
 *   output/index.json               ... 全体サマリ
 *   output/preprocess.log           ... 進捗ログ (タイムスタンプ付き)
 */

import fs from "node:fs";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { preprocessOne, extractDriveFileId, extractYouTubeId } from "./preprocess-manual";

// =====================================================================
// .env.local 読み込み (preprocess-manual と同じ)
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
// DynamoDB クライアント
// =====================================================================
const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);

async function scanAllManuals(): Promise<any[]> {
  const items: any[] = [];
  let ExclusiveStartKey: any = undefined;
  do {
    const res = await ddbDoc.send(
      new ScanCommand({ TableName: MANUALS_TABLE, ExclusiveStartKey })
    );
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// =====================================================================
// embedUrl 種別判定
// =====================================================================
type UrlKind =
  | "drive-file"      // drive.google.com/file/d/...
  | "drive-doc"       // docs.google.com/document/d/...
  | "drive-slides"    // docs.google.com/presentation/d/...
  | "drive-sheet"     // docs.google.com/spreadsheets/d/...
  | "youtube"
  | "canva"
  | "empty"
  | "unsupported";

function detectUrlKind(url: string | null | undefined): { kind: UrlKind; sourceId?: string } {
  const u = (url || "").trim();
  if (!u) return { kind: "empty" };

  if (/drive\.google\.com\/file\/d\//.test(u)) {
    return { kind: "drive-file", sourceId: extractDriveFileId(u) ?? undefined };
  }
  if (/docs\.google\.com\/presentation\/d\//.test(u)) {
    return { kind: "drive-slides", sourceId: extractDriveFileId(u) ?? undefined };
  }
  if (/docs\.google\.com\/document\/d\//.test(u)) {
    return { kind: "drive-doc", sourceId: extractDriveFileId(u) ?? undefined };
  }
  if (/docs\.google\.com\/spreadsheets\/d\//.test(u)) {
    return { kind: "drive-sheet", sourceId: extractDriveFileId(u) ?? undefined };
  }
  if (/youtube\.com|youtu\.be/.test(u)) {
    return { kind: "youtube", sourceId: extractYouTubeId(u) ?? undefined };
  }
  if (/canva\.com\//.test(u)) {
    return { kind: "canva" };
  }
  return { kind: "unsupported" };
}

// =====================================================================
// CLI フラグ解析
// =====================================================================
type Args = {
  limit?: number;
  dryRun: boolean;
  force: boolean;
  filter?: string;
  skipVideo: boolean;
  skipYoutube: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limit: number | undefined;
  let filter: string | undefined;
  let dryRun = false;
  let force = false;
  let skipVideo = false;
  let skipYoutube = false;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--force") force = true;
    else if (a === "--skip-video") skipVideo = true;
    else if (a === "--skip-youtube") skipYoutube = true;
    else if (a.startsWith("--limit=")) limit = Number(a.slice("--limit=".length)) || undefined;
    else if (a.startsWith("--filter=")) filter = a.slice("--filter=".length);
  }
  return { limit, dryRun, force, filter, skipVideo, skipYoutube };
}

// =====================================================================
// ログ
// =====================================================================
type LogEntry = (msg: string) => void;
function createLogger(filePath: string) {
  const stream = fs.createWriteStream(filePath, { flags: "a" });
  const log: LogEntry = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    stream.write(line + "\n");
  };
  return { log, close: () => new Promise<void>((r) => stream.end(r)) };
}

// =====================================================================
// メイン
// =====================================================================
type ResultEntry = {
  manualId: string;
  title?: string;
  embedUrl?: string;
  urlKind?: UrlKind;
  sourceType?: string;
  status: "ok" | "skipped" | "failed";
  reason?: string;
  outputPath?: string;
  chars?: number;
  elapsedMs?: number;
};

async function main() {
  const args = parseArgs();
  const outDir = path.resolve(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const indexPath = path.join(outDir, "index.json");
  const logPath = path.join(outDir, "preprocess.log");
  const { log, close } = createLogger(logPath);

  log(`==== preprocess-all-manuals start ====`);
  log(`args: ${JSON.stringify(args)}`);

  log("DynamoDB から全マニュアルを取得中...");
  const allManuals = await scanAllManuals();
  log(`取得: ${allManuals.length} 件`);

  // フィルタリング: isHidden=true 除外、--filter
  const filtered = allManuals.filter((m: any) => {
    if (m.isHidden === true) return false;
    if (!args.filter) return true;
    const kw = args.filter.toLowerCase();
    return (
      String(m.title ?? "").toLowerCase().includes(kw) ||
      String(m.desc ?? "").toLowerCase().includes(kw) ||
      String(m.biz ?? "").toLowerCase().includes(kw) ||
      String(m.brand ?? "").toLowerCase().includes(kw)
    );
  });

  let queue = filtered;
  if (args.limit && args.limit > 0) {
    queue = queue.slice(0, args.limit);
    log(`--limit=${args.limit} 適用: 処理対象 ${queue.length} 件`);
  } else {
    log(`処理対象 (isHidden 除外後): ${queue.length} 件`);
  }

  const results: ResultEntry[] = [];
  let okCount = 0,
    skipCount = 0,
    failCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const m = queue[i];
    const manualId = String(m.manualId ?? `unknown-${i}`);
    const title = m.title ? String(m.title) : undefined;
    const embedUrl = m.embedUrl ? String(m.embedUrl) : undefined;
    const detected = detectUrlKind(embedUrl);
    const baseEntry: ResultEntry = {
      manualId,
      title,
      embedUrl,
      urlKind: detected.kind,
      status: "skipped",
    };

    const tag = `[${i + 1}/${queue.length}]`;
    log(`${tag} ${manualId} "${title ?? "(no title)"}" — ${detected.kind}`);

    // スキップ判定
    if (detected.kind === "empty") {
      results.push({ ...baseEntry, reason: "embedUrl 未設定" });
      skipCount++;
      continue;
    }
    if (detected.kind === "canva") {
      results.push({ ...baseEntry, reason: "Canva 未対応" });
      skipCount++;
      continue;
    }
    if (detected.kind === "unsupported") {
      results.push({ ...baseEntry, reason: `未対応 URL: ${embedUrl}` });
      skipCount++;
      continue;
    }
    if (args.skipYoutube && detected.kind === "youtube") {
      results.push({ ...baseEntry, reason: "--skip-youtube" });
      skipCount++;
      continue;
    }

    const outputPath = path.join(outDir, `${manualId}.md`);
    if (!args.force && fs.existsSync(outputPath)) {
      results.push({ ...baseEntry, status: "ok", reason: "既存ファイルあり (--force でスキップ無効化可能)", outputPath });
      log(`  ↳ 既存スキップ: ${outputPath}`);
      okCount++;
      continue;
    }

    if (args.dryRun) {
      log(`  ↳ dry-run: 処理対象として認識 (kind=${detected.kind}, sourceId=${detected.sourceId})`);
      results.push({ ...baseEntry, status: "ok", reason: "dry-run", outputPath });
      okCount++;
      continue;
    }

    // 実処理
    const startedAt = Date.now();
    try {
      const input = detected.kind === "youtube" ? embedUrl! : (detected.sourceId ?? embedUrl!);

      // 動画スキップオプション (mimeType ベースの判定は preprocessOne 内なので、ここでは通す)
      // → 中で video/* と判定された場合、PREPROCESS_TRANSCRIBE_BUCKET 未設定なら例外が出るのを catch する

      const result = await preprocessOne(input);

      // --skip-video の場合は事後判定でファイル削除 (簡易対応)
      if (args.skipVideo && result.sourceType === "video") {
        results.push({ ...baseEntry, status: "skipped", reason: "--skip-video" });
        skipCount++;
        continue;
      }

      fs.writeFileSync(outputPath, result.markdown, "utf8");
      const elapsedMs = Date.now() - startedAt;
      log(`  ↳ ✅ 出力 ${outputPath} (${result.markdown.length} chars, ${elapsedMs}ms)`);
      results.push({
        ...baseEntry,
        status: "ok",
        sourceType: result.sourceType,
        outputPath,
        chars: result.markdown.length,
        elapsedMs,
      });
      okCount++;
    } catch (e: any) {
      const elapsedMs = Date.now() - startedAt;
      const msg = e?.message ?? String(e);
      log(`  ↳ ❌ 失敗: ${msg}`);
      results.push({
        ...baseEntry,
        status: "failed",
        reason: msg,
        elapsedMs,
      });
      failCount++;
    }
  }

  // index.json
  fs.writeFileSync(indexPath, JSON.stringify(results, null, 2), "utf8");

  log(`==== サマリ ====`);
  log(`✅ 成功: ${okCount}`);
  log(`⏭  スキップ: ${skipCount}`);
  log(`❌ 失敗: ${failCount}`);
  log(`index.json: ${indexPath}`);
  log(`log: ${logPath}`);

  await close();
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
