// app/api/login/log/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE = "yamauchi-LoginLogs";

export async function POST() {
  try {
    // ✅ 既存のログイン状態（kb_user）から userId を取る
    const userId = cookies().get("kb_user")?.value;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "NOT_LOGGED_IN" }, { status: 401 });
    }

    const loggedAt = new Date().toISOString();

    await docClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          logId: randomUUID(),
          userId,
          loggedAt,
        },
      })
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("LoginLog error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "FAILED" }, { status: 500 });
  }
}