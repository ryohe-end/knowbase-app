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

// テーブル名
const TABLE_NEWS = "yamauchi-News";

function getDocClient() {
  const region = process.env.AWS_REGION || "us-east-1";
  const client = new DynamoDBClient({ region });
  return DynamoDBDocumentClient.from(client);
}

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * DB項目（スネークケース）をフロントエンド用（キャメルケース）に変換
 * is_hidden -> isHidden, start -> fromDate などの変換を行う
 */
function mapDbToRecord(item: any) {
  if (!item) return null;
  return {
    newsId: item.news_id, // ここが DB の news_id を参照しているか確認
    title: item.title || "",
    body: item.body || "",
    fromDate: item.start || "", // DB上の 'start' を 'fromDate' にマッピング
    toDate: item.end || "",     // DB上の 'end' を 'toDate' にマッピング
    brandId: item.brand_id || "ALL",
    deptId: item.dept_id || "ALL",
    targetGroupIds: item.target_group_ids || [], // undefined 対策
    tags: item.tags || [],
    createdAt: item.created_at || new Date().toISOString(),
    updatedAt: item.updated_at || new Date().toISOString(),
    isHidden: item.is_hidden === true, // 明確に boolean 判定
  };
}

// GET /api/news/[newsId]
export async function GET(_req: NextRequest, ctx: any) {
  try {
    // Next.js 15 では params を await する必要がある
    const params = await ctx.params;
    const newsId = String(params?.newsId ?? "").trim();
    if (!newsId) return json(400, { error: "newsId is required" });

    const ddb = getDocClient();
    const res = await ddb.send(
      new GetCommand({
        TableName: TABLE_NEWS,
        Key: { news_id: newsId }, // DBのキー名は news_id
      })
    );

    if (!res.Item) return json(404, { error: "not found", newsId });
    return json(200, { ok: true, item: mapDbToRecord(res.Item) });
  } catch (e: any) {
    console.error("GET /api/news/[newsId] error:", e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}

// PUT /api/news/[newsId]
export async function PUT(req: NextRequest, ctx: any) {
  try {
    const params = await ctx.params;
    const newsId = String(params?.newsId ?? "").trim();
    if (!newsId) return json(400, { error: "newsId is required" });

    const body = await req.json().catch(() => ({}));
    
    // 入力値の整理（フロントエンドのキャメルケースから取得）
    const title = String(body?.title ?? "").trim();
    const bodyText = String(body?.body ?? "").trim();
    const start = body?.fromDate || null;
    const end = body?.toDate || null;
    const brand_id = body?.brandId || "ALL";
    const dept_id = body?.deptId || "ALL";
    const target_group_ids = Array.isArray(body?.targetGroupIds) ? body.targetGroupIds : [];
    const tags = Array.isArray(body?.tags) ? body.tags : [];
    const is_hidden = !!body?.isHidden;

    if (!title) return json(400, { error: "title is required" });

    const ddb = getDocClient();
    const updatedAt = new Date().toISOString();

    // 更新処理。DB側の項目名（start, is_hidden 等）に合わせて保存
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NEWS,
        Key: { news_id: newsId },
        UpdateExpression: `
          SET #t = :t, 
              #b = :b, 
              #s = :s, 
              #e = :e, 
              #bid = :bid, 
              #did = :did, 
              #tg = :tg, 
              #tags = :tags, 
              #hid = :hid, 
              #u = :u
        `,
        ExpressionAttributeNames: {
          "#t": "title",
          "#b": "body",
          "#s": "start",
          "#e": "end",
          "#bid": "brand_id",
          "#did": "dept_id",
          "#tg": "target_group_ids",
          "#tags": "tags",
          "#hid": "is_hidden",
          "#u": "updated_at",
        },
        ExpressionAttributeValues: {
          ":t": title,
          ":b": bodyText,
          ":s": start,
          ":e": end,
          ":bid": brand_id,
          ":did": dept_id,
          ":tg": target_group_ids,
          ":tags": tags,
          ":hid": is_hidden,
          ":u": updatedAt,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return json(200, { ok: true, item: mapDbToRecord(res.Attributes) });
  } catch (e: any) {
    console.error("PUT /api/news/[newsId] error:", e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}

// DELETE /api/news/[newsId]
export async function DELETE(_req: NextRequest, ctx: any) {
  try {
    const params = await ctx.params;
    const newsId = String(params?.newsId ?? "").trim();
    if (!newsId) return json(400, { error: "newsId is required" });

    const ddb = getDocClient();
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NEWS,
        Key: { news_id: newsId },
      })
    );

    return json(200, { ok: true, deleted: newsId });
  } catch (e: any) {
    console.error("DELETE /api/news/[newsId] error:", e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}