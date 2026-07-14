// app/api/manual-categories/route.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { isAdminRequest } from "@/lib/auth";
import type { ManualCategory } from "@/types/manualCategory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.KB_MANUAL_CATEGORIES_TABLE || "yamauchi-ManualCategories";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);

function normalizeYmd(v: any): string | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function mapItem(item: any): ManualCategory {
  return {
    categoryId: String(item.categoryId),
    name: String(item.name ?? ""),
    parentId: item.parentId ? String(item.parentId) : null,
    sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : Number(item.sortOrder) || 0,
    description: item.description ? String(item.description) : null,
    bizId: item.bizId ? String(item.bizId) : null,
    biz: item.biz ? String(item.biz) : null,
    publishedAt: normalizeYmd(item.publishedAt),
    thumbnailUrl: item.thumbnailUrl ? String(item.thumbnailUrl) : null,
    links: sanitizeLinks(item.links),
    createdAt: item.createdAt ? String(item.createdAt) : undefined,
    updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
  };
}

// 外部リンク配列を { label, url } の妥当なものだけに整形する
function sanitizeLinks(raw: any): { label: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l: any) => ({
      label: String(l?.label ?? "").trim(),
      url: String(l?.url ?? "").trim(),
    }))
    .filter((l) => l.url && /^https?:\/\//i.test(l.url))
    .map((l) => ({ label: l.label || l.url, url: l.url }))
    .slice(0, 20);
}

function buildDbItem(input: any, existingCreatedAt?: string): any {
  const categoryId = String(input.categoryId || "").trim();
  const name = String(input.name || "").trim();
  if (!categoryId) throw new Error("categoryId is required");
  if (!name) throw new Error("name is required");

  const parentId = input.parentId ? String(input.parentId).trim() : null;
  const sortOrder =
    typeof input.sortOrder === "number"
      ? input.sortOrder
      : Number(input.sortOrder) || 0;

  const description = input.description ? String(input.description).trim() : null;
  const bizId = input.bizId ? String(input.bizId).trim() : null;
  const biz = input.biz ? String(input.biz).trim() : null;
  const publishedAt = normalizeYmd(input.publishedAt);
  const thumbnailUrl = input.thumbnailUrl ? String(input.thumbnailUrl).trim() : null;
  const links = sanitizeLinks(input.links);

  const now = new Date().toISOString();
  return {
    categoryId,
    name,
    parentId,
    sortOrder,
    description,
    bizId,
    biz,
    publishedAt,
    thumbnailUrl,
    links,
    createdAt: existingCreatedAt ?? now,
    updatedAt: now,
  };
}

/** GET: 全カテゴリを返す (読み取りはログインユーザー全員に許可) */
export async function GET() {
  try {
    const result = await ddbDoc.send(new ScanCommand({ TableName: TABLE_NAME }));
    const categories = (result.Items || []).map(mapItem);
    categories.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return Response.json({ ok: true, categories });
  } catch (error: any) {
    console.error("GET /api/manual-categories error", error);
    return Response.json(
      { ok: false, error: "Failed to fetch categories", detail: error?.message },
      { status: 500 }
    );
  }
}

/** POST: 新規作成 (管理者のみ) */
export async function POST(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const item = buildDbItem(body);
    await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return Response.json({ ok: true, category: mapItem(item) });
  } catch (error: any) {
    console.error("POST /api/manual-categories error", error);
    return Response.json(
      { ok: false, error: error?.message || "Failed to create category" },
      { status: 400 }
    );
  }
}

/** PUT: 更新 (管理者のみ) */
export async function PUT(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    if (!body?.categoryId) {
      return Response.json({ ok: false, error: "categoryId is required" }, { status: 400 });
    }

    // 親子の循環を防止: parentId が自分自身、または自分の子孫だったらエラー
    if (body.parentId && String(body.parentId) === String(body.categoryId)) {
      return Response.json({ ok: false, error: "自分自身を親にできません" }, { status: 400 });
    }

    // 既存 createdAt を保持するため一度取得
    const existing = await ddbDoc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "categoryId = :id",
        ExpressionAttributeValues: { ":id": String(body.categoryId) },
        Limit: 1,
      })
    );
    const prev = existing.Items?.[0];
    const item = buildDbItem(body, prev?.createdAt ? String(prev.createdAt) : undefined);

    await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return Response.json({ ok: true, category: mapItem(item) });
  } catch (error: any) {
    console.error("PUT /api/manual-categories error", error);
    return Response.json(
      { ok: false, error: error?.message || "Failed to update category" },
      { status: 400 }
    );
  }
}

/** DELETE: 削除 (管理者のみ) — 子カテゴリ or 紐づくマニュアルがある場合は拒否 */
export async function DELETE(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get("categoryId");
    if (!categoryId) {
      return Response.json({ ok: false, error: "categoryId is required" }, { status: 400 });
    }

    // 子カテゴリチェック
    const children = await ddbDoc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "parentId = :pid",
        ExpressionAttributeValues: { ":pid": categoryId },
        Limit: 1,
      })
    );
    if ((children.Items?.length ?? 0) > 0) {
      return Response.json(
        { ok: false, error: "子カテゴリが残っています。先に削除してください。" },
        { status: 409 }
      );
    }

    // マニュアル紐付けチェック
    const used = await ddbDoc.send(
      new ScanCommand({
        TableName: MANUALS_TABLE,
        FilterExpression: "categoryId = :cid",
        ExpressionAttributeValues: { ":cid": categoryId },
        Limit: 1,
      })
    );
    if ((used.Items?.length ?? 0) > 0) {
      return Response.json(
        { ok: false, error: "このカテゴリを使用しているマニュアルがあります。先に外してください。" },
        { status: 409 }
      );
    }

    await ddbDoc.send(
      new DeleteCommand({ TableName: TABLE_NAME, Key: { categoryId } })
    );
    return Response.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/manual-categories error", error);
    return Response.json(
      { ok: false, error: error?.message || "Failed to delete category" },
      { status: 500 }
    );
  }
}
