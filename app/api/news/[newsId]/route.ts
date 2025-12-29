import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NEWS = "yamauchi-News";

function getDocClient() {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" }));
}

export async function PUT(req: NextRequest, ctx: any) {
  const params = await ctx.params;
  const newsId = String(params?.newsId ?? "").trim();

  try {
    const body = await req.json();
    const ddb = getDocClient();

    // ログで確定したDBのキー名 newsId を使用
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE_NEWS,
      Key: { newsId: newsId }, 
      UpdateExpression: `SET 
        title = :t, 
        body = :b, 
        brandId = :bid, 
        deptId = :did, 
        targetGroupIds = :tg, 
        tags = :tags, 
        isActive = :act, 
        visibleFrom = :vf, 
        visibleTo = :vt, 
        updatedAt = :u`,
      ExpressionAttributeValues: {
        ":t": body.title,
        ":b": body.body,
        ":bid": body.brandId || "ALL",
        ":did": body.deptId || "ALL",
        ":tg": body.targetGroupIds || [],
        ":tags": body.tags || [],
        ":act": body.isActive !== undefined ? body.isActive : true,
        ":vf": body.visibleFrom || null,
        ":vt": body.visibleTo || null,
        ":u": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    }));

    return NextResponse.json({ ok: true, item: res.Attributes });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: any) {
  const params = await ctx.params;
  const ddb = getDocClient();
  const res = await ddb.send(new GetCommand({ 
    TableName: TABLE_NEWS, 
    Key: { newsId: String(params.newsId) } 
  }));
  return NextResponse.json({ ok: true, item: res.Item });
}

export async function DELETE(_req: NextRequest, ctx: any) {
  const params = await ctx.params;
  const ddb = getDocClient();
  await ddb.send(new DeleteCommand({ 
    TableName: TABLE_NEWS, 
    Key: { newsId: String(params.newsId) } 
  }));
  return NextResponse.json({ ok: true });
}