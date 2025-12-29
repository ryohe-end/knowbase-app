import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient, ScanCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";

const TABLE_NAME = "yamauchi-News";

function getClient() {
  return new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
}

export async function GET(req: NextRequest) {
  const client = getClient();
  try {
    const url = new URL(req.url);
    const onlyActive = url.searchParams.get("onlyActive") === "true";

    const res = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
    // unmarshallしてそのまま返却
    let items = (res.Items || []).map(item => unmarshall(item));

    if (onlyActive) {
      const today = new Date().toISOString().slice(0, 10);
      items = items.filter((n: any) => {
        if (n.is_hidden) return false;
        return (!n.start || n.start <= today) && (!n.end || n.end >= today);
      });
    }

    items.sort((a, b) => (b.start || b.created_at || "") > (a.start || a.created_at || "") ? 1 : -1);
    return NextResponse.json({ news: items });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const client = getClient();
  try {
    const payload = await req.json();
    const now = new Date().toISOString();
    // 物理名 news_id を使用
    const news_id = payload.news_id || uuidv4();

    const dbItem = {
      ...payload,
      news_id,
      created_at: payload.created_at || now,
      updated_at: now,
    };

    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(dbItem, { removeUndefinedValues: true }),
    }));

    return NextResponse.json({ news: dbItem }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to create news" }, { status: 500 });
  }
}