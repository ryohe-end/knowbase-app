// app/api/contacts/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";

const region = "us-east-1";
const TABLE_CONTACTS = "yamauchi-Contacts";

// ★★★ 修正箇所: 認証情報の設定 ★★★
const ACCESS_KEY_ID = process.env.APP_AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.APP_AWS_SECRET_ACCESS_KEY;
// ★★★

const ddbClient = new DynamoDBClient({ 
  region,
  ...(ACCESS_KEY_ID && SECRET_ACCESS_KEY 
    ? { credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY } } 
    : {}) 
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

export async function GET() {
  try {
    const cmd = new ScanCommand({
      TableName: TABLE_CONTACTS,
    });

    const data = await docClient.send(cmd);
    const items = (data.Items || []) as any[];

    items.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );

    return NextResponse.json({ contacts: items });
  } catch (err: any) {
    console.error("GET /api/contacts error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch contacts",
        detail: String(err?.message || err),
        name: err?.name ?? undefined,
      },
      { status: 500 }
    );
  }
}