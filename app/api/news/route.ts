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

/**
 * g003: 本部・直営 -> 制限なし
 * g002: フランチャイズ -> direct を見せない
 */
const HQ_DIRECT_GROUP_ID = "g003";
const FRANCHISE_GROUP_ID = "g002";

const ddb = new DynamoDBClient({ region });
const doc = DynamoDBDocumentClient.from(ddb);

/** =========================
 * Admin-Key Guard (for write / admin read)
 * ========================= */
function isAdminRequest(req: NextRequest): boolean {
  const expected = (process.env.KB_ADMIN_API_KEY || "").trim();
  if (!expected) return true; // 開発用：未設定なら admin 扱い（ガードなし）
  const got = (req.headers.get("x-kb-admin-key") || "").trim();
  return !!got && got === expected;
}

function requireAdmin(req: NextRequest) {
  if (isAdminRequest(req)) return null;
  return NextResponse.json(
    {
      error: "Forbidden",
      detail:
        "x-kb-admin-key が不正、または KB_ADMIN_API_KEY が未設定/不一致です",
    },
    { status: 403 }
  );
}

/** =========================
 * Helpers / Normalizers
 * ========================= */
type NewsScope = "all" | "direct";
type BrandId = "ALL" | "JOYFIT" | "FIT365";

function normalizeViewScope(v: any): NewsScope {
  const raw = String(v || "").trim().toLowerCase();
  return raw === "direct" ? "direct" : "all";
}

function normalizeBrandId(v: any): BrandId {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "JOYFIT") return "JOYFIT";
  if (s === "FIT365") return "FIT365";
  return "ALL";
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

function normalizeBool(v: any): boolean {
  if (v === true || v === false) return v;
  if (typeof v === "number") return v === 1;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no" || s === "") return false;
  return Boolean(v);
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowISO() {
  return new Date().toISOString();
}

function parseTimeMs(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

function parseYmdMs(ymd: any): number | null {
  const s = String(ymd || "").trim();
  if (!s) return null;
  // YYYY-MM-DD を日付として扱う（比較用）
  const d = new Date(s + "T00:00:00");
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string") return [v];
  return [];
}

/** =========================
 * Viewer detection
 * ========================= */
async function getViewer(req: NextRequest): Promise<any | null> {
  const userId = (req.headers.get("x-kb-user-id") || "").trim();
  const email = (req.headers.get("x-kb-user-email") || "").trim();

  if (!userId && !email) return null;

  // userId で Get（userId がPKの設計なら当たる）
  try {
    if (userId) {
      const r = await doc.send(
        new GetCommand({ TableName: USERS_TABLE, Key: { userId } })
      );
      if (r.Item) return r.Item;
    }
  } catch {}

  // email がPKの設計なら当たる
  try {
    if (email) {
      const r = await doc.send(
        new GetCommand({ TableName: USERS_TABLE, Key: { email } })
      );
      if (r.Item) return r.Item;
    }
  } catch {}

  // 最終手段：Scan（重い）
  try {
    const s = await doc.send(new ScanCommand({ TableName: USERS_TABLE }));
    const users = (s.Items || []) as any[];

    if (userId) {
      const hit = users.find(
        (u) => String(u.userId || u.user_id || "") === userId
      );
      if (hit) return hit;
    }
    if (email) {
      const hit = users.find((u) => String(u.email || "") === email);
      if (hit) return hit;
    }
  } catch {}

  return null;
}

/**
 * 本部・直営(g003)を持っていれば制限なし。
 * viewer 不明は安全側で制限あり。
 */
function isRestrictedViewer(viewer: any | null): boolean {
  if (!viewer) return true;
  const groupIds = toArray(viewer.groupIds ?? viewer.group_ids);
  const isHQorDirect = groupIds.includes(HQ_DIRECT_GROUP_ID);
  return !isHQorDirect;
}

/** =========================
 * Mapping
 * ========================= */
function toApiNews(item: any) {
  if (!item) return null;

  const newsId = item.newsId || item.news_id || "";
  const createdAt = item.createdAt || item.created_at || "";
  const updatedAt = item.updatedAt || item.updated_at || "";

  const startDate = item.startDate || item.start || "";
  const endDate = item.endDate || item.end || "";
  const publishAt = item.publishAt ?? item.publish_at ?? null;

  const viewScope = normalizeViewScope(
    item.viewScope ?? item.view_scope ?? item.scope
  );

  // ✅ 追加：部署・ブランド（互換吸収）
  const bizId = String(item.bizId ?? item.deptId ?? item.dept_id ?? "").trim();
  const brandId = normalizeBrandId(
    item.brandId ?? item.brand ?? item.brand_id ?? "ALL"
  );

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
    isHidden: normalizeBool(item.isHidden ?? item.is_hidden),

    // ✅ APIに返す
    bizId,
    brandId,
  };
}

/** publishAt を JST(+09:00) 付きISO文字列に正規化 */
function normalizePublishAt(input: any): string | null {
  if (input == null || input === "") return null;

  const s = String(input).trim();
  if (!s) return null;

  // すでに TZ 付き（Z or ±HH:MM）ならそのまま
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) return s;

  // "YYYY-MM-DDTHH:mm" なら秒を付ける
  const withSeconds = s.length === 16 ? `${s}:00` : s;

  // JST として +09:00 を付与
  return `${withSeconds}+09:00`;
}

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

  const publishAtRaw = payload?.publishAt ?? payload?.publish_at ?? null;
  const publishAt = normalizePublishAt(publishAtRaw);

  const viewScope = normalizeViewScope(
    payload?.viewScope ?? payload?.view_scope ?? payload?.scope
  );

  // ✅ 追加：部署・ブランド（互換吸収）
  // - 管理画面は bizId / brandId を送る
  // - 旧実装やnotify互換で deptId / brand が来ても拾う
  const bizId = String(payload?.bizId ?? payload?.deptId ?? payload?.dept_id ?? "").trim();
  const brandId = normalizeBrandId(payload?.brandId ?? payload?.brand ?? payload?.brand_id ?? "ALL");

  return {
    newsId,
    title: String(payload?.title || "").trim(),
    body: payload?.body ?? "",
    url: String(payload?.url || payload?.externalUrl || "").trim(),
    tags: normalizeTags(payload?.tags),
    viewScope,
    startDate,
    endDate,
    publishAt,
    createdAt: createdAt || now,
    updatedAt,
    isHidden: normalizeBool(payload?.isHidden ?? payload?.is_hidden),

    // ✅ DBに保存（これが②の本丸）
    bizId,
    brandId,

    // ✅ 互換：古い参照先が deptId / brand を見ても動くように残す（任意だけど安全）
    deptId: bizId || "ALL",
    brand: brandId,
  };
}

/** =========================
 * Filters
 * ========================= */
function filterOnlyActive(apiNews: any[]) {
  const nowMs = Date.now();
  const todayMs = parseYmdMs(todayYMD())!;

  return apiNews.filter((n) => {
    if (normalizeBool(n.isHidden)) return false;

    const sMs = parseYmdMs(n.startDate);
    const eMs = parseYmdMs(n.endDate);
    if (sMs != null && sMs > todayMs) return false;
    if (eMs != null && eMs < todayMs) return false;

    const pMs = parseTimeMs(n.publishAt);
    if (pMs != null && pMs > nowMs) return false;

    return true;
  });
}

function filterByViewerScope(apiNews: any[], restricted: boolean) {
  if (!restricted) return apiNews;
  return apiNews.filter((n) => normalizeViewScope(n.viewScope) !== "direct");
}

function sortNewsDesc(apiNews: any[]) {
  const keyMs = (n: any) =>
    parseTimeMs(n.publishAt) ??
    parseYmdMs(n.startDate) ??
    parseTimeMs(n.createdAt) ??
    parseTimeMs(n.updatedAt) ??
    0;

  return apiNews.sort((a, b) => keyMs(b) - keyMs(a));
}

/** =========================
 * GET
 * ========================= */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // ✅ 重要：一般画面が onlyActive を付け忘れても「adminじゃなければ一般扱い」に落とす
    const qsOnlyActive = url.searchParams.get("onlyActive") === "true";
    const admin = isAdminRequest(req);
    const onlyActive = qsOnlyActive || !admin;

    const debug = url.searchParams.get("debug") === "true";

    // admin で onlyActive=false のときのみ admin guard
    if (!onlyActive) {
      const forbidden = requireAdmin(req);
      if (forbidden) return forbidden;
    }

    let viewer: any | null = null;
    let restricted = true;

    if (onlyActive) {
      viewer = await getViewer(req);
      restricted = isRestrictedViewer(viewer);
    }

    const res = await doc.send(new ScanCommand({ TableName: TABLE_NAME }));
    const rawItems = res.Items || [];
    const items = rawItems.map((x) => toApiNews(x)).filter(Boolean) as any[];

    let out = items;

    const counts: any = {
      scanItems: rawItems.length,
      mappedItems: items.length,
      afterOnlyActive: null as number | null,
      afterScope: null as number | null,
    };

    if (onlyActive) {
      out = filterOnlyActive(out);
      counts.afterOnlyActive = out.length;

      out = filterByViewerScope(out, restricted);
      counts.afterScope = out.length;
    }

    out = sortNewsDesc(out);

    if (debug) {
      return NextResponse.json(
        {
          mode: { admin, onlyActive, qsOnlyActive },
          counts,
          viewer: viewer
            ? {
                userId: viewer.userId ?? viewer.user_id ?? null,
                email: viewer.email ?? null,
                groupIds: toArray(viewer.groupIds ?? viewer.group_ids),
                note: `g003=${HQ_DIRECT_GROUP_ID}, g002=${FRANCHISE_GROUP_ID}`,
              }
            : null,
          sample: out.slice(0, 5),
          news: out,
        },
        { status: 200 }
      );
    }

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
    const id = String(payload?.newsId || payload?.news_id || "").trim();

    if (!id) {
      return NextResponse.json({ error: "newsId is required" }, { status: 400 });
    }
    if (!payload?.title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    // createdAt を保持
    const existingRes = await doc.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { newsId: id } })
    );
    const existing = existingRes.Item;

    const merged = {
      ...payload,
      newsId: id,
      createdAt: existing?.createdAt || existing?.created_at || payload?.createdAt,
      viewScope:
        payload?.viewScope ??
        existing?.viewScope ??
        existing?.view_scope ??
        existing?.scope,

      // ✅ 互換：新payloadに無ければ既存値を温存（これが“保存したのに消える”を防ぐ）
      bizId: payload?.bizId ?? payload?.deptId ?? existing?.bizId ?? existing?.deptId ?? existing?.dept_id ?? "",
      brandId: payload?.brandId ?? payload?.brand ?? existing?.brandId ?? existing?.brand ?? existing?.brand_id ?? "ALL",
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
    const id = String(url.searchParams.get("newsId") || "").trim();
    if (!id) {
      return NextResponse.json({ error: "newsId is required" }, { status: 400 });
    }

    await doc.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { newsId: id },
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
