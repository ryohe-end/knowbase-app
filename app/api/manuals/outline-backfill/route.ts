// app/api/manuals/outline-backfill/route.ts
// 全マニュアルのチャプター(動画)/目次(doc)を一括事前生成する管理者向けバッチ。
//   POST {limit?:number, force?:boolean} … 未生成のものを limit 件だけ処理して { processed, remaining } を返す。
//   生成は重い(Bedrock)ので limit(既定5)刻み。クライアントが remaining=0 までループ呼び出しする。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { isAdminRequest } from "@/lib/auth";
import { readPreprocessedMd, genChapters, genToc } from "@/lib/manualOutline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";
const EVENT_BUS_NAME = process.env.PREPROCESS_EVENT_BUS || "default";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });
const eventBridge = new EventBridgeClient({ region: REGION });

// 未MDのマニュアルの前処理(Markdown化)を起動する。前処理完了後に再実行でアウトライン生成される。
async function triggerPreprocess(manualId: string, embedUrl?: string) {
  if (!embedUrl) return false;
  await eventBridge.send(new PutEventsCommand({ Entries: [{ EventBusName: EVENT_BUS_NAME, Source: "knowbie.manual.saved", DetailType: "ManualSaved", Detail: JSON.stringify({ manualId, embedUrl, trigger: "update" }) }] }));
  return true;
}

// このマニュアルはまだアウトライン生成が必要か
function needsGen(m: any, force: boolean): boolean {
  if (m.outlineNone) return false;               // MD無し等で処理済み扱い
  if (m.type === "video") return force || !(Array.isArray(m.chapters) && m.chapters.length > 0);
  return force || !(Array.isArray(m.toc) && m.toc.length > 0);
}

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(20, Math.max(1, Number(body.limit) || 5));
  const force = body.force === true;

  // 全件スキャン(~数百件)
  const all: any[] = [];
  let ek: any;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: MANUALS_TABLE, ProjectionExpression: "manualId, #t, chapters, toc, preprocessedKey, outlineNone, embedUrl, outlinePreprocessTriggered", ExpressionAttributeNames: { "#t": "type" } }));
    for (const it of r.Items || []) all.push(it);
    ek = r.LastEvaluatedKey;
  } while (ek);

  const pending = all.filter((m) => needsGen(m, force));
  const target = pending.slice(0, limit);
  const results: { manualId: string; kind: string; count: number; note?: string }[] = [];

  for (const m of target) {
    const isVideo = m.type === "video";
    try {
      const md = await readPreprocessedMd(m.manualId, m.preprocessedKey);
      if (!md) {
        // 未MD: 前処理を起動(未起動のときのみ)。完了後の再実行でアウトライン生成される。
        if (!m.outlinePreprocessTriggered) {
          const fired = await triggerPreprocess(m.manualId, m.embedUrl);
          if (fired) {
            await ddb.send(new UpdateCommand({ TableName: MANUALS_TABLE, Key: { manualId: m.manualId }, UpdateExpression: "SET outlinePreprocessTriggered = :y, outlineAt = :a", ExpressionAttributeValues: { ":y": true, ":a": new Date().toISOString() } }));
            results.push({ manualId: m.manualId, kind: isVideo ? "chapters" : "toc", count: 0, note: "前処理(MD化)を起動" });
          } else {
            await ddb.send(new UpdateCommand({ TableName: MANUALS_TABLE, Key: { manualId: m.manualId }, UpdateExpression: "SET outlineNone = :y", ExpressionAttributeValues: { ":y": true } }));
            results.push({ manualId: m.manualId, kind: isVideo ? "chapters" : "toc", count: 0, note: "embedUrl無し(スキップ)" });
          }
        } else {
          results.push({ manualId: m.manualId, kind: isVideo ? "chapters" : "toc", count: 0, note: "前処理待ち" });
        }
        continue;
      }
      if (isVideo) {
        const chapters = await genChapters(md);
        if (chapters && chapters.length) {
          await ddb.send(new UpdateCommand({ TableName: MANUALS_TABLE, Key: { manualId: m.manualId }, UpdateExpression: "SET chapters = :c, chaptersAt = :a", ExpressionAttributeValues: { ":c": chapters, ":a": new Date().toISOString() } }));
          results.push({ manualId: m.manualId, kind: "chapters", count: chapters.length });
        } else {
          await ddb.send(new UpdateCommand({ TableName: MANUALS_TABLE, Key: { manualId: m.manualId }, UpdateExpression: "SET outlineNone = :y", ExpressionAttributeValues: { ":y": true } }));
          results.push({ manualId: m.manualId, kind: "chapters", count: 0, note: "時刻無し(スキップ)" });
        }
      } else {
        const toc = await genToc(md);
        if (toc.length) {
          await ddb.send(new UpdateCommand({ TableName: MANUALS_TABLE, Key: { manualId: m.manualId }, UpdateExpression: "SET toc = :c, tocAt = :a", ExpressionAttributeValues: { ":c": toc, ":a": new Date().toISOString() } }));
          results.push({ manualId: m.manualId, kind: "toc", count: toc.length });
        } else {
          await ddb.send(new UpdateCommand({ TableName: MANUALS_TABLE, Key: { manualId: m.manualId }, UpdateExpression: "SET outlineNone = :y", ExpressionAttributeValues: { ":y": true } }));
          results.push({ manualId: m.manualId, kind: "toc", count: 0, note: "生成不可(スキップ)" });
        }
      }
    } catch (e: any) {
      results.push({ manualId: m.manualId, kind: isVideo ? "chapters" : "toc", count: 0, note: `失敗: ${e?.message || e}` });
    }
  }

  const generated = results.filter((r) => r.count > 0).length;
  const triggered = results.filter((r) => r.note === "前処理(MD化)を起動").length;
  const waiting = results.filter((r) => r.note === "前処理待ち").length;
  return NextResponse.json({ ok: true, total: all.length, processed: results.length, generated, triggered, waiting, remaining: pending.length - target.length, results });
}
