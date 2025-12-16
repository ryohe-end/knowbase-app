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

type NewsRecord = {
  newsId: string;
  title: string;
  body: string;
  fromDate?: string | null;
  toDate?: string | null;
  brandId?: string | null;
  deptId?: string | null;
  targetGroupIds?: string[]; // ★ 追加: ターゲット属性グループID
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

function getClient() {
  // ★★★ 修正箇所: 認証情報の設定 ★★★
  const ACCESS_KEY_ID = process.env.APP_AWS_ACCESS_KEY_ID;
  const SECRET_ACCESS_KEY = process.env.APP_AWS_SECRET_ACCESS_KEY;
  // ★★★

  return new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    // ★★★ 修正: 環境変数が存在する場合にcredentialsを設定 ★★★
    ...(ACCESS_KEY_ID && SECRET_ACCESS_KEY 
      ? { credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY } } 
      : {}),
  });
}

// GET /api/news?onlyActive=1 で「今だけ」
// それ以外は全件（管理画面向け）
export async function GET(req: NextRequest) {
  const client = getClient();

  try {
    const url = new URL(req.url);
    const onlyActiveParam = url.searchParams.get("onlyActive");
    const onlyActive =
      onlyActiveParam === "1" ||
      onlyActiveParam === "true" ||
      onlyActiveParam === "yes";

    const res = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    let items: NewsRecord[] = (res.Items || []).map((it) =>
      unmarshall(it) as NewsRecord
    );

    // 公開中のみ
    if (onlyActive) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      items = items.filter((n) => {
        const fromOk = !n.fromDate || n.fromDate <= today;
        const toOk = !n.toDate || n.toDate >= today;
        return fromOk && toOk;
      });
    }

    // 新しい順（fromDate優先 → createdAt）
    items.sort((a, b) => {
      const aKey = (a.fromDate || a.createdAt || "").toString();
      const bKey = (b.fromDate || b.createdAt || "").toString();
      return aKey < bKey ? 1 : -1;
    });

    return NextResponse.json({ news: items });
  } catch (err) {
    console.error("GET /api/news error:", err);
    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 500 }
    );
  }
}

// POST /api/news
// body: { title, body, fromDate?, toDate?, brandId?, deptId?, targetGroupIds?, tags? }
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
    const targetGroupIds: string[] = Array.isArray(payload.targetGroupIds)
        ? payload.targetGroupIds.map((t: any) => String(t)).filter(Boolean)
        : []; // ★ 追加: グループIDを配列として取得

    let tags: string[] = [];
    if (Array.isArray(payload.tags)) {
      tags = payload.tags.map((t: any) => String(t)).filter(Boolean);
    } else if (typeof payload.tags === "string") {
      tags = payload.tags
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }

    if (!title || !bodyText) {
      return NextResponse.json(
        { error: "title と body は必須です" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const newsId = uuidv4();

    const item: NewsRecord = {
      newsId,
      title,
      body: bodyText,
      fromDate,
      toDate,
      brandId,
      deptId,
      targetGroupIds, // ★ 追加: 保存
      tags,
      createdAt: now,
      updatedAt: now,
    };

    await client.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(item),
      })
    );

    return NextResponse.json({ news: item }, { status: 201 });
  } catch (err) {
    console.error("POST /api/news error:", err);
    return NextResponse.json(
      { error: "Failed to create news" },
      { status: 500 }
    );
  }
}