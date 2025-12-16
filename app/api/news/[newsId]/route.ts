// app/api/news/[newsId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const TABLE_NAME = process.env.NEWS_TABLE_NAME || "yamauchi-News";

type NewsRecord = {
  newsId: string;
  title: string;
  body: string;
  fromDate?: string | null;
  toDate?: string | null;
  brandId?: string | null;
  deptId?: string | null;
  targetGroupIds?: string[];
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

function getClient() {
  return new DynamoDBClient({
    region: process.env.AWS_REGION || "ap-northeast-1",
  });
}

// Next.jsが期待するRouteContext形に合わせる（型名は作らない）
type RouteContext = { params: { newsId: string } };

// GET /api/news/[newsId]
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const client = getClient();
  const newsId = String(params?.newsId ?? "");

  if (!newsId) {
    return NextResponse.json({ error: "newsId is required" }, { status: 400 });
  }

  try {
    const res = await client.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ newsId }),
      })
    );

    if (!res.Item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const item = unmarshall(res.Item) as NewsRecord;
    return NextResponse.json({ news: item });
  } catch (err) {
    console.error("GET /api/news/[newsId] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 500 }
    );
  }
}

// PUT /api/news/[newsId]
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const client = getClient();
  const newsId = String(params?.newsId ?? "");

  if (!newsId) {
    return NextResponse.json({ error: "newsId is required" }, { status: 400 });
  }

  try {
    const payload = await req.json();

    const title: string = payload.title;
    const bodyText: string = payload.body;
    const fromDate: string | null = payload.fromDate || null;
    const toDate: string | null = payload.toDate || null;
    const brandId: string = payload.brandId || "ALL";
    const deptId: string = payload.deptId || "ALL";

    const targetGroupIds: string[] = Array.isArray(payload.targetGroupIds)
      ? payload.targetGroupIds.map((t: any) => String(t)).filter(Boolean)
      : [];

    let tags: string[] = [];
    if (Array.isArray(payload.tags)) {
      tags = payload.tags.map((t: any) => String(t)).filter(Boolean);
    } else if (typeof payload.tags === "string") {
      tags = payload.tags
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }

    if (!title || !bodyText) {
      return NextResponse.json(
        { error: "title と body は必須です" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const expr =
      "SET #title = :title, #body = :body, #fromDate = :fromDate, #toDate = :toDate, #brandId = :brandId, #deptId = :deptId, #targetGroupIds = :targetGroupIds, #tags = :tags, #updatedAt = :updatedAt";

    const exprNames = {
      "#title": "title",
      "#body": "body",
      "#fromDate": "fromDate",
      "#toDate": "toDate",
      "#brandId": "brandId",
      "#deptId": "deptId",
      "#targetGroupIds": "targetGroupIds",
      "#tags": "tags",
      "#updatedAt": "updatedAt",
    };

    const exprValues = marshall({
      ":title": title,
      ":body": bodyText,
      ":fromDate": fromDate,
      ":toDate": toDate,
      ":brandId": brandId,
      ":deptId": deptId,
      ":targetGroupIds": targetGroupIds,
      ":tags": tags,
      ":updatedAt": now,
    });

    await client.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ newsId }),
        UpdateExpression: expr,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
      })
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/news/[newsId] error:", err);
    return NextResponse.json(
      { error: "Failed to update news" },
      { status: 500 }
    );
  }
}

// DELETE /api/news/[newsId]
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const client = getClient();
  const newsId = String(params?.newsId ?? "");

  if (!newsId) {
    return NextResponse.json({ error: "newsId is required" }, { status: 400 });
  }

  try {
    await client.send(
      new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ newsId }),
      })
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/news/[newsId] error:", err);
    return NextResponse.json(
      { error: "Failed to delete news" },
      { status: 500 }
    );
  }
}

