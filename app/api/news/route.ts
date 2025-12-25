// app/api/news/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";

const TABLE_NAME = "yamauchi-News";

// フロントエンドで使う型
type NewsRecord = {
  newsId: string;
  title: string;
  body: string;
  fromDate?: string | null;
  toDate?: string | null;
  brandId?: string | null;
  deptId?: string | null;
  targetGroupIds?: string[];
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  isHidden?: boolean; // ★ 追加
};

// DynamoDBの項目名に合わせた型
type NewsDbRecord = {
  news_id: string;
  title: string;
  body: string;
  start: string | null; // fromDateに対応
  end: string | null;   // toDateに対応
  brand_id: string | null;
  dept_id: string | null;
  target_group_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  is_hidden: boolean; // ★ 追加
};

function getClient() {
  return new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
}

// DBのレコードをフロントエンド用の型に変換するヘルパー
function mapDbToRecord(db: any): NewsRecord {
  const item = unmarshall(db);
  return {
    newsId: item.news_id,
    title: item.title,
    body: item.body,
    fromDate: item.start,
    toDate: item.end,
    brandId: item.brand_id,
    deptId: item.dept_id,
    targetGroupIds: item.target_group_ids || [],
    tags: item.tags || [],
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    isHidden: item.is_hidden || false,
  };
}

// GET /api/news
export async function GET(req: NextRequest) {
  const client = getClient();

  try {
    const url = new URL(req.url);
    const onlyActiveParam = url.searchParams.get("onlyActive");
    const onlyActive = onlyActiveParam === "1" || onlyActiveParam === "true";

    const res = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    let items: NewsRecord[] = (res.Items || []).map(mapDbToRecord);

    // 公開中のみフィルタリング
    if (onlyActive) {
      const today = new Date().toISOString().slice(0, 10);
      items = items.filter((n) => {
        if (n.isHidden) return false; // ★ 非表示フラグがONなら除外
        const fromOk = !n.fromDate || n.fromDate <= today;
        const toOk = !n.toDate || n.toDate >= today;
        return fromOk && toOk;
      });
    }

    // 新しい順にソート
    items.sort((a, b) => {
      const aKey = a.fromDate || a.createdAt || "";
      const bKey = b.fromDate || b.createdAt || "";
      return aKey < bKey ? 1 : -1;
    });

    return NextResponse.json({ news: items });
  } catch (err) {
    console.error("GET /api/news error:", err);
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}

// POST /api/news
export async function POST(req: NextRequest) {
  const client = getClient();

  try {
    const payload = await req.json();

    const title: string = payload.title;
    const bodyText: string = payload.body;
    const fromDate: string | null = payload.fromDate || null;
    const toDate: string | null = payload.toDate || null;
    const brandId: string = payload.brandId || "ALL";
    const deptId: string = payload.deptId || "ALL";
    const isHidden: boolean = !!payload.isHidden; // ★ 追加
    const targetGroupIds: string[] = Array.isArray(payload.targetGroupIds)
        ? payload.targetGroupIds.map((t: any) => String(t)).filter(Boolean)
        : [];

    let tags: string[] = [];
    if (Array.isArray(payload.tags)) {
      tags = payload.tags.map((t: any) => String(t)).filter(Boolean);
    }

    if (!title || !bodyText) {
      return NextResponse.json({ error: "title と body は必須です" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const newsId = uuidv4();

    // DBの項目名に合わせてマッピング
    const dbItem: NewsDbRecord = {
      news_id: newsId,
      title,
      body: bodyText,
      start: fromDate,
      end: toDate,
      brand_id: brandId,
      dept_id: deptId,
      target_group_ids: targetGroupIds,
      tags,
      is_hidden: isHidden, // ★ 保存
      created_at: now,
      updated_at: now,
    };

    await client.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(dbItem),
      })
    );

    // レスポンスはフロントエンド用の型で返す
    return NextResponse.json({ news: mapDbToRecord(marshall(dbItem)) }, { status: 201 });
  } catch (err) {
    console.error("POST /api/news error:", err);
    return NextResponse.json({ error: "Failed to create news" }, { status: 500 });
  }
}