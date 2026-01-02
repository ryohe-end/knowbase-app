// app/api/me/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const region = process.env.AWS_REGION || "us-east-1";
const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export async function GET() {
  const cookieStore = await cookies();
  const email = cookieStore.get("kb_user")?.value || null;

  if (!email) {
    return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  try {
    // DynamoDBからユーザー詳細を取得
    const params = {
      TableName: TABLE_USERS,
      IndexName: EMAIL_GSI_NAME,
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: { ":email": email },
      Limit: 1,
    };

    const result = await docClient.send(new QueryCommand(params));
    const user = result.Items?.[0];

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    // フロントエンドが期待する形式 (meRes.user.name) で返す
    return NextResponse.json({
      ok: true,
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        groupId: user.groupId,
      },
    });
  } catch (error) {
    console.error("API Me Error:", error);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}