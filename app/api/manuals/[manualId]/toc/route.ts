// app/api/manuals/[manualId]/toc/route.ts
// マニュアル(ドキュメント)の目次(TOC)。
//   GET  … 保存済み目次を返す (ログインユーザー)
//   POST … 前処理済みMarkdownから AI で見出し(目次)を生成し保存 (管理者)
// チャプター(動画)と対をなす。目次は時刻を持たず、章立て見出しの一覧。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getSessionUser, isAdminRequest } from "@/lib/auth";
import { readPreprocessedMd, genToc, type TocItem } from "@/lib/manualOutline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function getManual(manualId: string): Promise<any> {
  const res = await ddb.send(new GetCommand({ TableName: MANUALS_TABLE, Key: { manualId }, ProjectionExpression: "manualId, #t, toc, preprocessedKey, embedUrl", ExpressionAttributeNames: { "#t": "type" } }));
  return res.Item;
}

export async function GET(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  const toc: TocItem[] = Array.isArray(m?.toc) ? m.toc : [];
  return NextResponse.json({ ok: true, toc });
}

export async function POST(req: Request, { params }: { params: Promise<{ manualId: string }> }) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { manualId } = await params;
  const m = await getManual(manualId);
  if (!m) return NextResponse.json({ ok: false, error: "manual not found" }, { status: 404 });

  const md = await readPreprocessedMd(manualId, m.preprocessedKey);
  if (!md) return NextResponse.json({ ok: false, error: "前処理済みデータが見つかりません（先にMarkdown化が必要）" }, { status: 400 });

  try {
    const toc = await genToc(md);
    if (toc.length === 0) return NextResponse.json({ ok: false, error: "目次を生成できませんでした" }, { status: 502 });
    await ddb.send(new UpdateCommand({
      TableName: MANUALS_TABLE, Key: { manualId },
      UpdateExpression: "SET toc = :c, tocAt = :a",
      ExpressionAttributeValues: { ":c": toc, ":a": new Date().toISOString() },
    }));
    return NextResponse.json({ ok: true, toc });
  } catch (e: any) {
    console.error("[toc] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "生成に失敗しました" }, { status: 500 });
  }
}
