// app/api/manuals/[manualId]/chapters/route.ts
// 動画マニュアルのチャプター(章立て)。
//   GET  … 保存済みチャプターを返す (ログインユーザー)
//   POST … 前処理済みMarkdown(文字起こし+時間別セグメント)から AI でチャプター生成し保存
//          プレビュー閲覧時に未生成なら自動生成される(ログインユーザー)。ボタン操作は不要。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getSessionUser } from "@/lib/auth";
import { readPreprocessedMd, genChapters, triggerPreprocess, type Chapter } from "@/lib/manualOutline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function getManual(manualId: string): Promise<any> {
  const res = await ddb.send(new GetCommand({ TableName: MANUALS_TABLE, Key: { manualId }, ProjectionExpression: "manualId, #t, chapters, preprocessedKey, embedUrl, outlineNone", ExpressionAttributeNames: { "#t": "type" } }));
  return res.Item;
}

export async function GET(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  const chapters: Chapter[] = Array.isArray(m?.chapters) ? m.chapters : [];
  return NextResponse.json({ ok: true, chapters, outlineNone: !!m?.outlineNone });
}

export async function POST(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  if (!m) return NextResponse.json({ ok: false, error: "manual not found" }, { status: 404 });

  const md = await readPreprocessedMd(manualId, m.preprocessedKey);
  if (!md) {
    // 未MD: 前処理(Markdown化)を自動起動。完了後に再度開けば自動生成される。
    const fired = await triggerPreprocess(manualId, m.embedUrl);
    return NextResponse.json({ ok: false, preprocessing: fired, error: fired ? "前処理(Markdown化)を開始しました。数分後に再度開いてください。" : "前処理対象がありません" }, { status: 202 });
  }

  try {
    const chapters = await genChapters(md);
    if (!chapters || chapters.length === 0) {
      // 時刻情報が無い等で章立て不可。以後の自動再試行を止める。
      await ddb.send(new UpdateCommand({ TableName: MANUALS_TABLE, Key: { manualId }, UpdateExpression: "SET outlineNone = :y", ExpressionAttributeValues: { ":y": true } }));
      return NextResponse.json({ ok: true, chapters: [] });
    }
    await ddb.send(new UpdateCommand({
      TableName: MANUALS_TABLE, Key: { manualId },
      UpdateExpression: "SET chapters = :c, chaptersAt = :a REMOVE outlineNone",
      ExpressionAttributeValues: { ":c": chapters, ":a": new Date().toISOString() },
    }));
    return NextResponse.json({ ok: true, chapters });
  } catch (e: any) {
    console.error("[chapters] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "生成に失敗しました" }, { status: 500 });
  }
}
