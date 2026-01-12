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
 *  Admin-Key Guard
 *  ========================= */
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
 *  Helpers / Normalizers
 *  ========================= */

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
 *  Viewer (general user) detection
 *  - safe default: unknown => treat as franchise (hide direct)
 *  ========================= */
async function getViewer(req: NextRequest): Promise<any | null> {
  // ✅ フロントから渡す想定（最低限）
  const userId = (req.headers.get("x-kb-user-id") || "").trim();
  const email = (req.headers.get("x-kb-user-email") || "").trim();

  // 何も無い場合は viewer 不明
  if (!userId && !email) return null;

  // できれば Get で取りたいが、PKが確定してない可能性があるので
  // userId / email の両方で Get を試し、ダメなら Scan fallback
  try {
    if (userId) {
      const r = await doc.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { userId }, // ← UsersテーブルのPKが userId の場合
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
          Key: { email }, // ← UsersテーブルのPKが email の場合
        })
      );
      if (r.Item) return r.Item;
    }
  } catch {}

  // Scan fallback（PK不明時の保険：本番はGetに寄せるのが理想）
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
  // ✅ viewer 不明なら「安全側」で FC 扱い（direct を隠す）
  if (!viewer) return true;

  const groupIds = toArray(viewer.groupIds ?? viewer.group_ids);
  return groupIds.includes(FRANCHISE_GROUP_ID);
}

/**
 * DB(Item) → API(News)
 * 物理: news_id / created_at / updated_at / start / end
 * API : newsId / createdAt / updatedAt / startDate / endDate / viewScope
 */
function toApiNews(item: any) {
  if (!item) return null;

  const newsId = item.newsId || item.news_id || "";
  const createdAt = item.createdAt || item.created_at || "";
  const updatedAt = item.updatedAt || item.updated_at || "";

  const startDate = item.startDate || item.start || "";
  const endDate = item.endDate || item.end || "";

  // ✅ ここが重要：viewScope を優先（互換で scope も読む）
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
    createdAt,
    updatedAt,

    // 互換（古い実装）
    isHidden: item.is_hidden ?? item.isHidden ?? false,
  };
}

/**
 * API(Payload) → DB(Item)
 * DBは news_id をPKに統一
 * DBカラム: viewScope（あなたの指定）
 */
function toDbNews(payload: any, mode: "create" | "update") {
  const newsId = String(payload?.newsId || payload?.news_id || "").trim();
  if (!newsId) throw new Error("newsId is required");

  const now = nowISO();

  const createdAt =
    mode === "create"
      ? String(payload?.createdAt || payload?.created_at || now)
      : String(payload?.createdAt || payload?.created_at || ""); // update時は既存保持が望ましい

  const updatedAt = now;

  const startDate = String(payload?.startDate || payload?.start || "").trim();
  const endDate = String(payload?.endDate || payload?.end || "").trim();

  // ✅ ここが重要：viewScope を保存（互換で scope が来ても吸収）
  const viewScope = normalizeViewScope(payload?.viewScope ?? payload?.view_scope ?? payload?.scope);

  return {
    // PK
    news_id: newsId,

    title: String(payload?.title || "").trim(),
    body: payload?.body ?? "",
    url: String(payload?.url || payload?.externalUrl || "").trim(),
    tags: normalizeTags(payload?.tags),

    // ✅ あなたのDB仕様：viewScope
    viewScope,

    // DBは start/end
    start: startDate,
    end: endDate,

    created_at: createdAt || now,
    updated_at: updatedAt,

    // 互換
    is_hidden: !!payload?.isHidden || !!payload?.is_hidden,
  };
}

/** onlyActive=true 用フィルタ（公開用） */
function filterOnlyActive(apiNews: any[]) {
  const today = todayYMD();
  return apiNews.filter((n) => {
    const hidden = !!n.isHidden;
    if (hidden) return false;

    const s = String(n.startDate || "").trim();
    const e = String(n.endDate || "").trim();

    const okStart = !s || s <= today;
    const okEnd = !e || e >= today;

    return okStart && okEnd;
  });
}

/** viewScope フィルタ（一般画面用） */
function filterByViewerScope(apiNews: any[], viewerIsFC: boolean) {
  // direct は「直営/本部のみ」なので FC は除外
  if (!viewerIsFC) return apiNews;

  return apiNews.filter((n) => normalizeViewScope(n.viewScope) !== "direct");
}

/** ソート（startDate → createdAt → updatedAt の降順） */
function sortNewsDesc(apiNews: any[]) {
  const key = (n: any) => String(n.startDate || n.createdAt || n.updatedAt || "");
  return apiNews.sort((a, b) => (key(b) > key(a) ? 1 : -1));
}

/** =========================
 *  GET
 *  - /api/news?onlyActive=true → 公開（admin key不要）
 *    - ✅ viewScope は一般ユーザー属性で制御（FCはdirect非表示）
 *  - それ以外 → admin key 必須（管理画面）
 *  ========================= */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const onlyActive = url.searchParams.get("onlyActive") === "true";

    // onlyActive=true は公開として許可
    if (!onlyActive) {
      const forbidden = requireAdmin(req);
      if (forbidden) return forbidden;
    }

    // ✅ 一般公開の場合のみ、閲覧者の属性を取得して viewScope 適用
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
 *  POST（新規）
 *  ========================= */
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
 *  PUT（更新）
 *  ========================= */
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

    // 既存の created_at を保持
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
      // ✅ 既存があるなら viewScope も保険で保持（payload未指定時）
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
 *  DELETE（削除）
 *  - /api/news?newsId=...
 *  ========================= */
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
