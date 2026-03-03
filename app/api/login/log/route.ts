// app/api/login/log/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const TABLE = "yamauchi-LoginLogs";

export async function POST() {
  try {
    const c = await cookies();

    // ✅ kb_uid を優先（なければ旧 kb_user も一応見る）
    const userId = c.get("kb_uid")?.value || c.get("kb_user")?.value;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "NOT_LOGGED_IN" }, { status: 401 });
    }

    await docClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          logId: randomUUID(),
          userId,
          loggedAt: new Date().toISOString(),
        },
      })
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("LoginLog error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "FAILED" }, { status: 500 });
  }
}