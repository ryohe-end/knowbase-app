import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";

const REGION = process.env.AWS_REGION || "us-east-1";
const LOGS_TABLE = "yamauchi-SearchLogs";

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export async function POST(req: Request) {
  try {
    const { keyword, userId } = await req.json();

    // 空白や未入力の場合は記録せずにそのまま正常終了
    const trimmedKeyword = keyword?.trim();
    if (!trimmedKeyword) {
      return NextResponse.json({ ok: true }); 
    }

    const now = new Date().toISOString();

    await docClient.send(
      new PutCommand({
        TableName: LOGS_TABLE,
        Item: {
          logId: uuidv4(),
          keyword: trimmedKeyword,
          userId: userId || "anonymous",
          searchedAt: now,
          searchedDate: now.slice(0, 10),
        },
      })
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("POST /api/search/log error", error);
    return NextResponse.json({ error: "Failed to record search log" }, { status: 500 });
  }
}