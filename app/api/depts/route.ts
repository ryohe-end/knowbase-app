// app/api/depts/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// us-east-1 で作っていると言ってたのでデフォルトはそれ
// ★★★ 修正箇所: 認証情報の明示的設定を削除し、オリジナルの形に戻す ★★★
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
// ★★★

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