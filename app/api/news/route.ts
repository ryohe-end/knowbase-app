// app/api/news/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_NAME = process.env.NEWS_TABLE_NAME || "yamauchi-News";
const USERS_TABLE = process.env.KB_USERS_TABLE_NAME || "yamauchi-Users";
const region = process.env.AWS_REGION || "us-east-1";

// Franchise group id
const FRANCHISE_GROUP_ID = "g002";

const ddb = new DynamoDBClient({ region });
const doc = DynamoDBDocumentClient.from(ddb);

/** =========================
 * Admin-Key Guard
 * ========================= */
function requireAdmin(req: NextRequest) {
  const expected = (process.env.KB_ADMIN_API_KEY || "").trim();

  // expected が未設定なら「ガードなし」（開発用）
  if (!expected) return null;

  const got = (req.headers.get("x-kb-admin-key") || "").trim();
  if (!got || got !== expected) {
    return NextResponse.json(
      {
        error: "Forbidden",
        detail: "x-kb-admin-key が不正、または KB_ADMIN_API_KEY が未設定/不一致です",
      },
      { status: 403 }
    );
  }
  return null;
}

/** =========================
 * Helpers / Normalizers
 * ========================= */

type NewsScope = "all" | "direct";

function normalizeViewScope(v: any): NewsScope {
  const raw = String(v || "").trim().toLowerCase();
  return raw === "direct" ? "direct" : "all";
}

function normalizeTags(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(/[,、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function toArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string") return [v];
  return [];
}

/** =========================
 * Viewer (general user) detection
 * ========================= */
async function getViewer(req: NextRequest): Promise<any | null> {
  const userId = (req.headers.get("x-kb-user-id") || "").trim();
  const email = (req.headers.get("x-kb-user-email") || "").trim();

  if (!userId && !email) return null;

  try {
    if (userId) {
      const r = await doc.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { userId },
        })
      );
      if (r.Item) return r.Item;
    }
  } catch {}

  try {
    if (email) {
      const r = await doc.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { email },
        })
      );
      if (r.Item) return r.Item;
    }
  } catch {}

  try {
    const s = await doc.send(new ScanCommand({ TableName: USERS_TABLE }));
    const users = (s.Items || []) as any[];
    if (userId) {
      const hit = users.find((u) => String(u.userId || u.user_id || "") === userId);
      if (hit) return hit;
    }
    if (email) {
      const hit = users.find((u) => String(u.email || "") === email);
      if (hit) return hit;
    }
  } catch {}

  return null;
}

function isFranchiseViewer(viewer: any | null): boolean {
  if (!viewer) return true;
  const groupIds = toArray(viewer.groupIds ?? viewer.group_ids);
  return groupIds.includes(FRANCHISE_GROUP_ID);
}

/**
 * DB(Item) → API(News)
 */
function toApiNews(item: any) {
  if (!item) return null;

  const newsId = item.newsId || item.news_id || "";
  const createdAt = item.createdAt || item.created_at || "";
  const updatedAt = item.updatedAt || item.updated_at || "";

  const startDate = item.startDate || item.start || "";
  const endDate = item.endDate || item.end || "";
  
  // ✅ 予約投稿日時
  const publishAt = item.publishAt || item.publish_at || null;

  const viewScope = normalizeViewScope(item.viewScope ?? item.view_scope ?? item.scope);

  return {
    newsId,
    title: item.title || "",
    body: item.body ?? "",
    url: item.url ?? item.externalUrl ?? "",
    tags: normalizeTags(item.tags),
    viewScope,
    startDate,
    endDate,
    publishAt,
    createdAt,
    updatedAt,
    isHidden: item.is_hidden ?? item.isHidden ?? false,
  };
}

/**
 * API(Payload) → DB(Item)
 */
function toDbNews(payload: any, mode: "create" | "update") {
  const newsId = String(payload?.newsId || payload?.news_id || "").trim();
  if (!newsId) throw new Error("newsId is required");

  const now = nowISO();

  const createdAt =
    mode === "create"
      ? String(payload?.createdAt || payload?.created_at || now)
      : String(payload?.createdAt || payload?.created_at || "");

  const updatedAt = now;

  const startDate = String(payload?.startDate || payload?.start || "").trim();
  const endDate = String(payload?.endDate || payload?.end || "").trim();

  // ✅ 予約投稿日時
  const publishAt = payload?.publishAt || null;

  const viewScope = normalizeViewScope(payload?.viewScope ?? payload?.view_scope ?? payload?.scope);

  return {
    news_id: newsId,
    title: String(payload?.title || "").trim(),
    body: payload?.body ?? "",
    url: String(payload?.url || payload?.externalUrl || "").trim(),
    tags: normalizeTags(payload?.tags),
    viewScope,
    start: startDate,
    end: endDate,
    publishAt,
    created_at: createdAt || now,
    updated_at: updatedAt,
    is_hidden: !!payload?.isHidden || !!payload?.is_hidden,
  };
}

/** onlyActive=true 用フィルタ（予約投稿対応） */
function filterOnlyActive(apiNews: any[]) {
  const today = todayYMD();
  const now = nowISO();

  return apiNews.filter((n) => {
    const hidden = !!n.isHidden;
    if (hidden) return false;

    // 1. 公開期間（日付ベース）
    const s = String(n.startDate || "").trim();
    const e = String(n.endDate || "").trim();
    if (s && s > today) return false;
    if (e && e < today) return false;

    // 2. ✅ タイマー配信フィルタ（日時ベース）
    // 指定した日時を過ぎていない場合は非表示
    if (n.publishAt && n.publishAt > now) return false;

    return true;
  });
}

/** viewScope フィルタ */
function filterByViewerScope(apiNews: any[], viewerIsFC: boolean) {
  if (!viewerIsFC) return apiNews;
  return apiNews.filter((n) => normalizeViewScope(n.viewScope) !== "direct");
}

/** ソート（予約日時、開始日、作成日の降順） */
function sortNewsDesc(apiNews: any[]) {
  const key = (n: any) => String(n.publishAt || n.startDate || n.createdAt || n.updatedAt || "");
  return apiNews.sort((a, b) => (key(b) > key(a) ? 1 : -1));
}

/** =========================
 * GET
 * ========================= */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const onlyActive = url.searchParams.get("onlyActive") === "true";

    if (!onlyActive) {
      const forbidden = requireAdmin(req);
      if (forbidden) return forbidden;
    }

    let viewerIsFC = false;
    if (onlyActive) {
      const viewer = await getViewer(req);
      viewerIsFC = isFranchiseViewer(viewer);
    }

    const res = await doc.send(new ScanCommand({ TableName: TABLE_NAME }));
    const items = (res.Items || []).map((x) => toApiNews(x)).filter(Boolean) as any[];

    let out = items;

    if (onlyActive) {
      out = filterOnlyActive(out);
      out = filterByViewerScope(out, viewerIsFC);
    }

    out = sortNewsDesc(out);

    return NextResponse.json({ news: out }, { status: 200 });
  } catch (err) {
    console.error("[api/news GET] error", err);
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}

/** =========================
 * POST（新規作成）
 * ========================= */
export async function POST(req: NextRequest) {
  const forbidden = requireAdmin(req);
  if (forbidden) return forbidden;

  try {
    const payload = await req.json();
    if (!payload?.title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!payload?.newsId) {
      return NextResponse.json({ error: "newsId is required" }, { status: 400 });
    }

    const dbItem = toDbNews(payload, "create");

    await doc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: dbItem,
      })
    );

    return NextResponse.json({ news: toApiNews(dbItem) }, { status: 201 });
  } catch (err: any) {
    console.error("[api/news POST] error", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create news" },
      { status: 500 }
    );
  }
}

/** =========================
 * PUT（更新）
 * ========================= */
export async function PUT(req: NextRequest) {
  const forbidden = requireAdmin(req);
  if (forbidden) return forbidden;

  try {
    const payload = await req.json();
    const newsId = String(payload?.newsId || "").trim();

    if (!newsId) {
      return NextResponse.json({ error: "newsId is required" }, { status: 400 });
    }
    if (!payload?.title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    // 既存の created_at を保持するために一度取得
    const existingRes = await doc.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { news_id: newsId },
      })
    );
    const existing = existingRes.Item;

    const merged = {
      ...payload,
      createdAt: existing?.created_at || payload?.createdAt,
      viewScope: payload?.viewScope ?? existing?.viewScope ?? existing?.view_scope ?? existing?.scope,
    };

    const dbItem = toDbNews(merged, "update");

    await doc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: dbItem,
      })
    );

    return NextResponse.json({ news: toApiNews(dbItem) }, { status: 200 });
  } catch (err: any) {
    console.error("[api/news PUT] error", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update news" },
      { status: 500 }
    );
  }
}

/** =========================
 * DELETE（削除）
 * ========================= */
export async function DELETE(req: NextRequest) {
  const forbidden = requireAdmin(req);
  if (forbidden) return forbidden;

  try {
    const url = new URL(req.url);
    const newsId = String(url.searchParams.get("newsId") || "").trim();
    if (!newsId) {
      return NextResponse.json({ error: "newsId is required" }, { status: 400 });
    }

    await doc.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { news_id: newsId },
      })
    );

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("[api/news DELETE] error", err);
    return NextResponse.json(
      { error: err?.message || "Failed to delete news" },
      { status: 500 }
    );
  }
}