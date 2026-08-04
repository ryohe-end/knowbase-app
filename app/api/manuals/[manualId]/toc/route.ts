// app/api/manuals/[manualId]/toc/route.ts
// マニュアル(ドキュメント)の目次(TOC)。
//   GET  … 保存済み目次を返す (ログインユーザー)
//   POST … 前処理済みMarkdownから AI で見出し(目次)を生成し保存 (管理者)
// チャプター(動画)と対をなす。目次は時刻を持たず、章立て見出しの一覧。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getSessionUser } from "@/lib/auth";
import { readPreprocessedMd, genToc, triggerPreprocess, type TocItem } from "@/lib/manualOutline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function getManual(manualId: string): Promise<any> {
  const res = await ddb.send(new GetCommand({ TableName: MANUALS_TABLE, Key: { manualId }, ProjectionExpression: "manualId, #t, toc, preprocessedKey, embedUrl, outlineNone", ExpressionAttributeNames: { "#t": "type" } }));
  return res.Item;
}

export async function GET(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  const toc: TocItem[] = Array.isArray(m?.toc) ? m.toc : [];
  return NextResponse.json({ ok: true, toc, outlineNone: !!m?.outlineNone });
}

// プレビュー閲覧時に未生成なら自動生成される(ログインユーザー)。ボタン操作は不要。
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
    const toc = await genToc(md);
    if (toc.length === 0) {
      // 生成対象が無い(目次化に向かない)。以後の自動再試行を止める。
      await ddb.send(new UpdateCommand({ TableName: MANUALS_TABLE, Key: { manualId }, UpdateExpression: "SET outlineNone = :y", ExpressionAttributeValues: { ":y": true } }));
      return NextResponse.json({ ok: true, toc: [] });
    }
    await ddb.send(new UpdateCommand({
      TableName: MANUALS_TABLE, Key: { manualId },
      UpdateExpression: "SET toc = :c, tocAt = :a REMOVE outlineNone",
      ExpressionAttributeValues: { ":c": toc, ":a": new Date().toISOString() },
    }));
    return NextResponse.json({ ok: true, toc });
  } catch (e: any) {
    console.error("[toc] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "生成に失敗しました" }, { status: 500 });
  }
}
