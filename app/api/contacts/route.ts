import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";

const region = "us-east-1";
const TABLE_CONTACTS = "yamauchi-Contacts";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// 一覧取得
export async function GET() {
  try {
    const cmd = new ScanCommand({ TableName: TABLE_CONTACTS });
    const data = await docClient.send(cmd);
    const items = (data.Items || []) as any[];

    items.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "ja")
    );

    return NextResponse.json({ contacts: items });
  } catch (err: any) {
    console.error("GET /api/contacts error:", err);
    return NextResponse.json({ error: "取得失敗", detail: err.message }, { status: 500 });
  }
}

// 新規作成・更新 (DynamoDBのPutは上書き保存のため共通)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.contactId) throw new Error("contactId is required");

    const cmd = new PutCommand({
      TableName: TABLE_CONTACTS,
      Item: {
        ...body,
        updatedAt: new Date().toISOString(), // 追跡用に更新日時を入れるのがおすすめ
      },
    });

    await docClient.send(cmd);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("POST /api/contacts error:", err);
    return NextResponse.json({ error: "保存失敗", detail: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  return POST(req);
}

// 削除
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const contactId = searchParams.get("contactId");

    if (!contactId) {
      return NextResponse.json({ error: "contactIdが必要です" }, { status: 400 });
    }

    const cmd = new DeleteCommand({
      TableName: TABLE_CONTACTS,
      Key: { contactId },
    });

    await docClient.send(cmd);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/contacts error:", err);
    return NextResponse.json({ error: "削除失敗", detail: err.message }, { status: 500 });
  }
}