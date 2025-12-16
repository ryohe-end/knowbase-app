// app/api/news/[newsId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ テーブル名（あなたの既存 env 名に合わせて変えてOK）
const TABLE_NEWS = process.env.TABLE_NEWS || process.env.NEWS_TABLE || "yamauchi-News";

function getDocClient() {
  const region = process.env.AWS_REGION || process.env.APP_AWS_REGION || "us-east-1";
  const client = new DynamoDBClient({ region });
  return DynamoDBDocumentClient.from(client);
}

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

// ✅ Next.js 15 対応：第2引数の型は「書かない」 or 「any」にする（これが一番安全）
export async function GET(_req: NextRequest, ctx: any) {
  try {
    const newsId = String(ctx?.params?.newsId ?? "").trim();
    if (!newsId) return json(400, { error: "newsId is required" });

    const ddb = getDocClient();
    const res = await ddb.send(
      new GetCommand({
        TableName: TABLE_NEWS,
        Key: { newsId },
      })
    );

    if (!res.Item) return json(404, { error: "not found", newsId });
    return json(200, { ok: true, item: res.Item });
  } catch (e: any) {
    console.error("GET /api/news/[newsId] error:", e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}

export async function PUT(req: NextRequest, ctx: any) {
  try {
    const newsId = String(ctx?.params?.newsId ?? "").trim();
    if (!newsId) return json(400, { error: "newsId is required" });

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? "").trim();
    const bodyText = String(body?.body ?? "").trim();

    if (!title) return json(400, { error: "title is required" });

    const ddb = getDocClient();
    const updatedAt = new Date().toISOString();

    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NEWS,
        Key: { newsId },
        UpdateExpression: "SET #t = :t, #b = :b, #u = :u",
        ExpressionAttributeNames: {
          "#t": "title",
          "#b": "body",
          "#u": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":t": title,
          ":b": bodyText,
          ":u": updatedAt,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return json(200, { ok: true, item: res.Attributes });
  } catch (e: any) {
    console.error("PUT /api/news/[newsId] error:", e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}

export async function DELETE(_req: NextRequest, ctx: any) {
  try {
    const newsId = String(ctx?.params?.newsId ?? "").trim();
    if (!newsId) return json(400, { error: "newsId is required" });

    const ddb = getDocClient();
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NEWS,
        Key: { newsId },
      })
    );

    return json(200, { ok: true, deleted: newsId });
  } catch (e: any) {
    console.error("DELETE /api/news/[newsId] error:", e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}

