// app/api/manuals/route.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = "yamauchi-Manuals";

// DynamoDBクライアントの初期化
const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);

export type ManualType = "doc" | "video";

export type Manual = {
  manualId: string;
  title: string;

  brandId?: string; // "ALL" or brandId
  brand?: string;

  bizId?: string; // deptId相当
  biz?: string;

  desc?: string | null;
  updatedAt?: string; // "YYYY-MM-DD"
  tags?: string[];

  embedUrl?: string;
  externalUrl?: string; // ★ 追加：外部サイトURL
  noDownload?: boolean;
  readCount?: number;

  startDate?: string; // 公開開始 "YYYY-MM-DD"
  endDate?: string; // 公開終了 "YYYY-MM-DD"
  type?: ManualType; // "doc" | "video"

  publishStart?: string;
  publishEnd?: string;
  isNew?: boolean;
};

/** yyyy-mm-dd をざっくり検証（空はOK） */
function normalizeYmd(v: any): string | undefined {
  if (!v) return undefined;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  return s;
}

function normalizeType(v: any): ManualType | undefined {
  const s = String(v || "").toLowerCase();
  if (s === "doc" || s === "video") return s as ManualType;
  return undefined;
}

/** DynamoDB → Manual へのマッピング */
function mapItemToManual(item: any): Manual {
  if (!item) throw new Error("Empty manual item");

  const startDate =
    normalizeYmd(item.startDate) ?? normalizeYmd(item.publishStart);
  const endDate = normalizeYmd(item.endDate) ?? normalizeYmd(item.publishEnd);

  return {
    manualId: String(item.manualId),
    title: String(item.title),

    brandId: item.brandId ? String(item.brandId) : "ALL",
    brand: item.brand ? String(item.brand) : undefined,

    bizId: item.bizId ? String(item.bizId) : undefined,
    biz: item.biz ? String(item.biz) : undefined,

    desc: item.desc ?? null,
    updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
    embedUrl: item.embedUrl ? String(item.embedUrl) : undefined,
    externalUrl: item.externalUrl ? String(item.externalUrl) : undefined, // ★ マッピングに追加

    tags: Array.isArray(item.tags) ? item.tags.map((t: any) => String(t)) : [],

    noDownload: item.noDownload === true,

    readCount:
      typeof item.readCount === "number"
        ? item.readCount
        : item.readCount != null
        ? Number(item.readCount)
        : 0,

    startDate,
    endDate,
    type: normalizeType(item.type) ?? "doc",
    isNew: item.isNew === true,
  };
}

/** POST/PUT 用：保存アイテムを整形（DynamoDBに入れる形） */
function buildDbItem(input: any): any {
  const manualId = String(input.manualId || "").trim();
  const title = String(input.title || "").trim();

  const startDate =
    normalizeYmd(input.startDate) ?? normalizeYmd(input.publishStart);
  const endDate = normalizeYmd(input.endDate) ?? normalizeYmd(input.publishEnd);

  const type = normalizeType(input.type) ?? "doc";

  const tags = Array.isArray(input.tags)
    ? input.tags.map((t: any) => String(t)).filter(Boolean)
    : [];

  const updatedAt =
    normalizeYmd(input.updatedAt) ?? new Date().toISOString().slice(0, 10);

  return {
    manualId,
    title,

    brandId: input.brandId ? String(input.brandId) : "ALL",
    brand: input.brand ? String(input.brand) : undefined,

    bizId: input.bizId ? String(input.bizId) : undefined,
    biz: input.biz ? String(input.biz) : undefined,

    desc: input.desc ?? null,
    embedUrl: input.embedUrl ? String(input.embedUrl) : undefined,
    externalUrl: input.externalUrl ? String(input.externalUrl) : undefined, // ★ 保存対象に追加

    tags,

    noDownload: input.noDownload === true,
    readCount:
      typeof input.readCount === "number"
        ? input.readCount
        : input.readCount != null
        ? Number(input.readCount)
        : 0,

    startDate,
    endDate,
    type,

    updatedAt,
  };
}

/** GET: /api/manuals */
export async function GET() {
  try {
    const result = await ddbDoc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    const items = result.Items || [];
    const manuals = items.map(mapItemToManual);

    return Response.json({ manuals });
  } catch (error: any) {
    console.error("GET /api/manuals error", error);
    return Response.json(
      {
        error: "Failed to fetch manuals",
        detail: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}

/** POST: /api/manuals 新規登録 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body?.manualId || !body?.title) {
      return Response.json(
        { error: "manualId と title は必須です。" },
        { status: 400 }
      );
    }

    const item = buildDbItem(body);

    await ddbDoc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    return Response.json({ ok: true, manualId: item.manualId });
  } catch (error: any) {
    console.error("POST /api/manuals error", error);
    return Response.json(
      {
        error: "Failed to create manual",
        detail: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}

/** PUT: /api/manuals 更新 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();

    if (!body?.manualId || !body?.title) {
      return Response.json(
        { error: "manualId と title は必須です。" },
        { status: 400 }
      );
    }

    const item = buildDbItem(body);

    await ddbDoc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    return Response.json({ ok: true, manualId: item.manualId });
  } catch (error: any) {
    console.error("PUT /api/manuals error", error);
    return Response.json(
      {
        error: "Failed to update manual",
        detail: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}

/** DELETE: /api/manuals?manualId=xxxx */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const manualId = searchParams.get("manualId");

    if (!manualId) {
      return Response.json(
        { error: "manualId が指定されていません。" },
        { status: 400 }
      );
    }

    await ddbDoc.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { manualId },
      })
    );

    return Response.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/manuals error", error);
    return Response.json(
      {
        error: "Failed to delete manual",
        detail: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}