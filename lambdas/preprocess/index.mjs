// lambdas/preprocess/index.mjs
// マニュアル1本を AI 検索可能な Markdown に前処理し S3 + DDB へ反映する Lambda。
// 起動: EventBridge "ManualSaved" (Source=knowbie.manual.saved) / 直接invoke {manualId}
// Amplify SSR では長時間処理が完走できないため、専用Lambda(15分)に切り出したもの。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { preprocessOne } from "./preprocess.mjs";

const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";
const OUTPUT_BUCKET = process.env.PREPROCESS_OUTPUT_BUCKET || "knowbie-preprocessed-manuals";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3 = new S3Client({ region: REGION });

async function updateMeta(manualId, patch) {
  const names = {}, values = {}, sets = [];
  for (const [k, v] of Object.entries(patch)) {
    names[`#${k}`] = k; values[`:${k}`] = v; sets.push(`#${k} = :${k}`);
  }
  if (!sets.length) return;
  await ddb.send(new UpdateCommand({
    TableName: MANUALS_TABLE, Key: { manualId },
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values,
  }));
}

async function runOne(manualId) {
  const getRes = await ddb.send(new GetCommand({ TableName: MANUALS_TABLE, Key: { manualId } }));
  const manual = getRes.Item;
  if (!manual) throw new Error(`manual not found: ${manualId}`);
  const embedUrl = manual.embedUrl ? String(manual.embedUrl) : "";
  if (!embedUrl) throw new Error("embedUrl 未設定のため対象外");

  if (manual.preprocessedStatus === "ok" && manual.preprocessedEmbedUrl === embedUrl) {
    return { skipped: true, reason: "already processed (same embedUrl)" };
  }
  await updateMeta(manualId, { preprocessedStatus: "pending", preprocessedError: null });

  const result = await preprocessOne(embedUrl);
  const s3Key = `manuals/${manualId}.md`;
  await s3.send(new PutObjectCommand({
    Bucket: OUTPUT_BUCKET, Key: s3Key,
    Body: Buffer.from(result.markdown, "utf-8"),
    ContentType: "text/markdown; charset=utf-8",
    Metadata: { manualId, sourceType: result.sourceType || "", sourceId: result.sourceId || "" },
  }));
  await updateMeta(manualId, {
    preprocessedAt: new Date().toISOString(),
    preprocessedEmbedUrl: embedUrl,
    preprocessedKey: s3Key,
    preprocessedStatus: "ok",
    preprocessedError: null,
  });
  return { ok: true, s3Key, chars: result.markdown.length, sourceType: result.sourceType };
}

export const handler = async (event) => {
  // manualId を EventBridge(detail) / 直接invoke から取り出す
  let manualId = event?.manualId;
  if (!manualId && event?.detail) {
    const d = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
    manualId = d?.manualId;
  }
  if (!manualId) {
    console.error("[preprocess] no manualId in event", JSON.stringify(event)?.slice(0, 300));
    return { ok: false, error: "manualId required" };
  }
  const started = Date.now();
  try {
    const result = await runOne(String(manualId));
    console.log(`[preprocess] done manualId=${manualId}`, JSON.stringify(result), `${Date.now() - started}ms`);
    return { ok: true, manualId, ...result };
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.error(`[preprocess] failed manualId=${manualId}: ${msg}`);
    try { await updateMeta(String(manualId), { preprocessedStatus: "failed", preprocessedError: msg.slice(0, 1000) }); } catch {}
    return { ok: false, manualId, error: msg };
  }
};
