import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_MANUALS = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";
const region = process.env.AWS_REGION || "us-east-1";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { manualId } = body;

    if (!manualId) {
      return NextResponse.json({ error: "manualId is required" }, { status: 400 });
    }

    // readCount を +1 する（アトミックカウンタ）
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_MANUALS,
        Key: { manualId },
        UpdateExpression: "SET readCount = if_not_exists(readCount, :start) + :inc",
        ExpressionAttributeValues: {
          ":start": 0,
          ":inc": 1,
        },
      })
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Failed to increment readCount:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}