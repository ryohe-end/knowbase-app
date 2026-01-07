import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient, ScanCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";

// DynamoDBテーブル名（環境に合わせて変更してください）
const TABLE_NAME = "yamauchi-ExternalLinks";

function getClient() {
  return new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
}

/**
 * 外部リンク一覧の取得
 * GET /api/external-links
 */
export async function GET(req: NextRequest) {
  const client = getClient();
  try {
    const res = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
    let items = (res.Items || []).map(item => unmarshall(item));

    // sortOrder順（昇順）、次にタイトル順でソート
    items.sort((a, b) => {
      const orderA = a.sortOrder ?? 9999;
      const orderB = b.sortOrder ?? 9999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.title || "").localeCompare(b.title || "");
    });

    return NextResponse.json({ links: items });
  } catch (err) {
    console.error("Failed to fetch links:", err);
    return NextResponse.json({ 
    error: "外部リンクの取得に失敗しました", 
    detail: err.message, // これを追加
    stack: err.stack     // これも追加
  }, { status: 500 });
  }
}

/**
 * 外部リンクの作成・更新
 * POST /api/external-links
 */
export async function POST(req: NextRequest) {
  const client = getClient();
  try {
    const payload = await req.json();
    const now = new Date().toISOString();
    
    // linkId がなければ新規作成(uuid)、あれば更新
    const linkId = payload.linkId || uuidv4();

    const dbItem = {
      linkId: linkId,
      title: payload.title,
      url: payload.url,
      description: payload.description || "",
      sortOrder: Number(payload.sortOrder) || 0,
      isActive: payload.isActive !== undefined ? payload.isActive : true,
      updatedAt: now,
      createdAt: payload.createdAt || now,
    };

    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(dbItem, { removeUndefinedValues: true }),
    }));

    return NextResponse.json({ link: dbItem }, { status: 201 });
  } catch (err) {
    console.error("Failed to save link:", err);
    return NextResponse.json({ error: "外部リンクの保存に失敗しました" }, { status: 500 });
  }
}