import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";

const REGION = process.env.AWS_REGION || "us-east-1";
const LOGS_TABLE = "yamauchi-ManualViewLogs";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export async function POST(req: Request) {
  try {
    const { manualId, userId } = await req.json();

    if (!manualId) {
      return NextResponse.json({ error: "manualId is required" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 1. アクセスログを記録する (yamauchi-ManualViewLogs テーブルへ)
    await docClient.send(
      new PutCommand({
        TableName: LOGS_TABLE,
        Item: {
          logId: uuidv4(),
          manualId,
          userId: userId || "anonymous",
          viewedAt: now,
          viewedDate: now.slice(0, 10), // "YYYY-MM-DD" (集計しやすいように)
        },
      })
    );

    // 2. 既存の manual テーブルの readCount も +1 しておく（累計用）
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: MANUALS_TABLE,
          Key: { manualId },
          UpdateExpression: "ADD readCount :inc",
          ExpressionAttributeValues: { ":inc": 1 },
        })
      );
    } catch (e) {
      console.warn("Failed to increment total readCount", e);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("POST /api/manuals/view error", error);
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
  }
}