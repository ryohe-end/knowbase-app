// app/api/preprocess/run/route.ts
//
// マニュアル 1 本を AI 検索可能な Markdown に前処理して S3 に保存する。
//
// 起動経路:
//   1. EventBridge Rule からの API destination 呼び出し (POST /api/manuals 後に PutEvents)
//   2. 管理画面の「前処理を実行」ボタンからの手動呼び出し
//   3. CLI からの curl ?token=<KB_ADMIN_API_KEY>&manualId=XXX
//
// 認可: isAdminRequest (cookie kb_admin or x-kb-admin-key or ?token=)
//
// 処理長: 最大 15 分 (Vision LLM が遅い場合の余裕)

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { isAdminRequest } from "@/lib/auth";
import fs from "node:fs";
import path from "node:path";

// Lambda タイムアウトを 15 分に延長 (Vision LLM 込みで 5 分程度かかる想定)
export const maxDuration = 900;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Amplify SSR ランタイムでは Amplify 環境変数が process.env に載らないため、
// buildSpec が生成する runtime-env.txt を読み、前処理に必要な値を process.env へ注入する。
// (preprocessOne は process.env.GOOGLE_SERVICE_ACCOUNT_JSON 等を直接参照するため)
let _runtimeEnvLoaded = false;
function loadRuntimeEnvIntoProcess() {
  if (_runtimeEnvLoaded) return;
  _runtimeEnvLoaded = true;
  const keys = ["GOOGLE_SERVICE_ACCOUNT_JSON", "PREPROCESS_TRANSCRIBE_BUCKET", "BEDROCK_MODEL_ID", "YOUTUBE_API_KEY"];
  try {
    const p = path.join(process.cwd(), ".next", "server", "runtime-env.txt");
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const i = s.indexOf("=");
      if (i <= 0) continue;
      const k = s.slice(0, i).trim();
      if (!keys.includes(k)) continue;
      let v = s.slice(i + 1);
      v = v.replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
      if (v && !process.env[k]) process.env[k] = v;
    }
  } catch (e) {
    console.warn("[preprocess] runtime-env load failed:", (e as Error)?.message);
  }
}

const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";
const OUTPUT_BUCKET = process.env.PREPROCESS_OUTPUT_BUCKET || "knowbie-preprocessed-manuals";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);
const s3 = new S3Client({ region: REGION });

// preprocess-manual スクリプトの core 関数を再利用
// (CLI guard で main は走らないので import 副作用なし)
import { preprocessOne } from "@/scripts/preprocess-manual";

async function updateManualMeta(
  manualId: string,
  patch: Partial<{
    preprocessedAt: string | null;
    preprocessedEmbedUrl: string | null;
    preprocessedKey: string | null;
    preprocessedStatus: "ok" | "failed" | "pending" | null;
    preprocessedError: string | null;
  }>
) {
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, any> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    exprNames[`#${k}`] = k;
    exprValues[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  if (sets.length === 0) return;
  await ddbDoc.send(
    new UpdateCommand({
      TableName: MANUALS_TABLE,
      Key: { manualId },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
    })
  );
}

async function runPreprocess(manualId: string) {
  // 0) 認証情報など runtime-env を process.env へ注入 (preprocessOne が参照)
  loadRuntimeEnvIntoProcess();
  // 1) マニュアル取得
  const getRes = await ddbDoc.send(
    new GetCommand({ TableName: MANUALS_TABLE, Key: { manualId } })
  );
  const manual = getRes.Item as any;
  if (!manual) throw new Error(`manual not found: ${manualId}`);
  const embedUrl: string = manual.embedUrl ? String(manual.embedUrl) : "";
  if (!embedUrl) {
    throw new Error("embedUrl が未設定のため前処理対象外");
  }

  // 2) 既に同じ embedUrl で処理済みならスキップ
  if (
    manual.preprocessedStatus === "ok" &&
    manual.preprocessedEmbedUrl === embedUrl
  ) {
    return { skipped: true, reason: "already processed (same embedUrl)" };
  }

  // 3) pending マークを付ける
  await updateManualMeta(manualId, {
    preprocessedStatus: "pending",
    preprocessedError: null,
  });

  // 4) preprocessOne で実処理
  const result = await preprocessOne(embedUrl);

  // 5) S3 へアップロード
  const s3Key = `manuals/${manualId}.md`;
  await s3.send(
    new PutObjectCommand({
      Bucket: OUTPUT_BUCKET,
      Key: s3Key,
      Body: Buffer.from(result.markdown, "utf-8"),
      ContentType: "text/markdown; charset=utf-8",
      Metadata: {
        manualId,
        sourceType: result.sourceType,
        sourceId: result.sourceId ?? "",
      },
    })
  );

  // 6) DDB に成功マーク
  await updateManualMeta(manualId, {
    preprocessedAt: new Date().toISOString(),
    preprocessedEmbedUrl: embedUrl,
    preprocessedKey: s3Key,
    preprocessedStatus: "ok",
    preprocessedError: null,
  });

  return {
    ok: true,
    s3Key,
    bucket: OUTPUT_BUCKET,
    sourceType: result.sourceType,
    chars: result.markdown.length,
  };
}

/** GET: ?manualId=XXX で 1 件処理 */
export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const manualId = searchParams.get("manualId");
  if (!manualId) {
    return NextResponse.json({ ok: false, error: "manualId required" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await runPreprocess(manualId);
    const elapsedMs = Date.now() - started;
    return NextResponse.json({ ...result, manualId, elapsedMs });
  } catch (e: any) {
    const elapsedMs = Date.now() - started;
    const msg = e?.message ?? String(e);
    console.error(`[PREPROCESS] failed manualId=${manualId}:`, msg);
    // 失敗マークを DDB へ
    try {
      await updateManualMeta(manualId, {
        preprocessedStatus: "failed",
        preprocessedError: msg.slice(0, 1000),
      });
    } catch {}
    return NextResponse.json(
      { ok: false, manualId, error: msg, elapsedMs },
      { status: 500 }
    );
  }
}

/**
 * POST: EventBridge の API destination から呼ばれる際は POST + JSON body を想定。
 * body: { manualId: string } または EventBridge Event の detail.manualId
 */
export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // EventBridge の標準 Event 形式は {source, detail: {...}}。それも拾う。
  const manualId = body?.manualId || body?.detail?.manualId;
  if (!manualId) {
    return NextResponse.json({ ok: false, error: "manualId required" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await runPreprocess(String(manualId));
    const elapsedMs = Date.now() - started;
    return NextResponse.json({ ...result, manualId, elapsedMs });
  } catch (e: any) {
    const elapsedMs = Date.now() - started;
    const msg = e?.message ?? String(e);
    console.error(`[PREPROCESS] failed manualId=${manualId}:`, msg);
    try {
      await updateManualMeta(String(manualId), {
        preprocessedStatus: "failed",
        preprocessedError: msg.slice(0, 1000),
      });
    } catch {}
    return NextResponse.json(
      { ok: false, manualId, error: msg, elapsedMs },
      { status: 500 }
    );
  }
}
