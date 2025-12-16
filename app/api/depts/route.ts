// app/api/depts/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// ★★★ 修正箇所: 認証情報の設定 ★★★
const ACCESS_KEY_ID = process.env.APP_AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.APP_AWS_SECRET_ACCESS_KEY;
// ★★★

// us-east-1 で作っていると言ってたのでデフォルトはそれ
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  // ★★★ 修正: 環境変数が存在する場合にcredentialsを設定 ★★★
  ...(ACCESS_KEY_ID && SECRET_ACCESS_KEY 
    ? { credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY } } 
    : {}),
});

const TABLE_NAME =
  process.env.DYNAMO_DEPTS_TABLE || "yamauchi-Depts";

export async function GET() {
  try {
    const command = new ScanCommand({
      TableName: TABLE_NAME,
    });

    const result = await client.send(command);
    const depts = (result.Items || []).map((item) => unmarshall(item));

    return NextResponse.json({ depts });
  } catch (err: any) {
    console.error("Failed to fetch depts:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch depts",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}