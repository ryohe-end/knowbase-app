import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";

const REGION = process.env.AWS_REGION || "us-east-1";
const LOGS_TABLE = "yamauchi-NewsViewLogs";

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export async function POST(req: Request) {
  try {
    const { newsId, userId } = await req.json();

    if (!newsId) {
      return NextResponse.json({ error: "newsId is required" }, { status: 400 });
    }

    const now = new Date().toISOString();

    await docClient.send(
      new PutCommand({
        TableName: LOGS_TABLE,
        Item: {
          logId: uuidv4(),
          newsId,
          userId: userId || "anonymous",
          viewedAt: now,
          viewedDate: now.slice(0, 10), // 日別集計用
        },
      })
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("POST /api/news/view error", error);
    return NextResponse.json({ error: "Failed to record news view" }, { status: 500 });
  }
}