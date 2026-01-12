// app/api/manuals/route.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

/**
 * ✅ env（きれい版）
 * - KB_ADMIN_API_KEY: 管理画面が全件取得/更新するための鍵（あなたが手で決めた文字列でOK）
 * - KB_DIRECT_GROUP_ID: 直営の groupId（例: g001）
 * - KB_HQ_GROUP_ID: 本部の groupId（例: g003）
 *
 * ※ 既にあなたは KB_ADMIN_API_KEY をセット済み
 * ※ KB_DIRECT_GROUP_ID が "G_DIRECT" など旧値でも壊れないように保険あり
 */
const KB_ADMIN_API_KEY = (process.env.KB_ADMIN_API_KEY || "").trim();

// 推奨: g001 / g003
const DIRECT_GROUP_ID = (process.env.KB_DIRECT_GROUP_ID || "g001").trim();
const HQ_GROUP_ID = (process.env.KB_HQ_GROUP_ID || "g003").trim();

// 旧値/表記ゆれ保険（あなたの環境が G_DIRECT を使っていても落ちないように）
const DIRECT_GROUP_ALIASES = Array.from(
  new Set([DIRECT_GROUP_ID, "g001", "G_DIRECT"].filter(Boolean))
);
const HQ_GROUP_ALIASES = Array.from(new Set([HQ_GROUP_ID, "g003"].filter(Boolean)));

// DynamoDBクライアントの初期化
const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);

export type ManualType = "doc" | "video";
export type ViewScope = "ALL" | "DIRECT";

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
  externalUrl?: string;
  noDownload?: boolean;
  readCount?: number;

  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  type?: ManualType;

  isNew?: boolean;

  // ✅ 追加：閲覧権限（すべて / 直営のみ）
  viewScope?: ViewScope;
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

function normalizeViewScope(v: any): ViewScope {
  const s = String(v || "").toUpperCase().trim();
  if (s === "DIRECT") return "DIRECT";
  return "ALL";
}

/** header: x-kb-group-ids を "a,b,c" で受け取る */
function parseGroupIds(req: Request): { primary?: string; all: string[] } {
  const raw = (req.headers.get("x-kb-group-ids") || "").trim();
  if (!raw) return { primary: undefined, all: [] };
  const all = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const primary = all[0];
  return { primary, all };
}

/** 管理者判定（管理画面はこれを必ず付ける運用にする） */
function isAdminRequest(req: Request) {
  if (!KB_ADMIN_API_KEY) return false;
  const key = (req.headers.get("x-kb-admin-key") || "").trim();
  return key && key === KB_ADMIN_API_KEY;
}

/** 公開期間内かどうか（onlyActive=1 で使う） */
function isActiveByDate(m: Manual, nowYmd: string) {
  const start = m.startDate || "";
  const end = m.endDate || "";
  if (start && start > nowYmd) return false;
  if (end && end < nowYmd) return false;
  return true;
}

/**
 * ✅ viewScope の閲覧可否
 * - ALL: 認証ユーザーならOK（= group header がある前提。無くても落とさず返すのは危険なので "許可" に寄せる or "拒否" に寄せるは運用次第）
 * - DIRECT: primary が 直営 or 本部 のときだけOK（本部OK版）
 */
function canViewManualByScope(req: Request, manual: Manual): boolean {
  const scope: ViewScope = manual.viewScope || "ALL";
  if (scope === "ALL") return true;

  // DIRECT の場合
  const { primary } = parseGroupIds(req);
  const p = (primary || "").trim();
  if (!p) return false;

  const isDirect = DIRECT_GROUP_ALIASES.includes(p);
  const isHq = HQ_GROUP_ALIASES.includes(p);

  return isDirect || isHq;
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
    externalUrl: item.externalUrl ? String(item.externalUrl) : undefined,

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

    // ✅ 追加
    viewScope: normalizeViewScope(item.viewScope),
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

  // 更新日を「実行時の今日の日付」に固定
  const updatedAt = new Date().toISOString().slice(0, 10);

  // ✅ viewScope（ALL / DIRECT）
  const viewScope: ViewScope = normalizeViewScope(input.viewScope);

  return {
    manualId,
    title,

    brandId: input.brandId ? String(input.brandId) : "ALL",
    brand: input.brand ? String(input.brand) : undefined,

    bizId: input.bizId ? String(input.bizId) : undefined,
    biz: input.biz ? String(input.biz) : undefined,

    desc: input.desc ?? null,
    embedUrl: input.embedUrl ? String(input.embedUrl) : undefined,
    externalUrl: input.externalUrl ? String(input.externalUrl) : undefined,

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

    // ✅ 追加
    viewScope,
  };
}

/** GET: /api/manuals
 * - 管理画面（x-kb-admin-key 正しい）: 全件
 * - 一般画面: viewScope でフィルタ（DIRECTは直営/本部のみ）
 * - optional: ?onlyActive=1 → 公開期間(start/end)内だけ返す
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const onlyActive = url.searchParams.get("onlyActive") === "1";
    const nowYmd = new Date().toISOString().slice(0, 10);

    const result = await ddbDoc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    const items = result.Items || [];
    const allManuals = items.map(mapItemToManual);

    // ✅ 管理者ならフィルタなし
    if (isAdminRequest(req)) {
      const manuals = onlyActive
        ? allManuals.filter((m) => isActiveByDate(m, nowYmd))
        : allManuals;

      return Response.json({ manuals, admin: true });
    }

    // ✅ 一般ユーザー：viewScope フィルタ
    let manuals = allManuals.filter((m) => canViewManualByScope(req, m));

    if (onlyActive) {
      manuals = manuals.filter((m) => isActiveByDate(m, nowYmd));
    }

    return Response.json({ manuals, admin: false });
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

/** POST: /api/manuals 新規登録（管理画面想定）
 * - 原則：管理画面から x-kb-admin-key 付きで呼ぶ
 */
export async function POST(req: Request) {
  try {
    if (!isAdminRequest(req)) {
      return Response.json(
        { error: "Forbidden: admin key required" },
        { status: 403 }
      );
    }

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

/** PUT: /api/manuals 更新（管理画面想定） */
export async function PUT(req: Request) {
  try {
    if (!isAdminRequest(req)) {
      return Response.json(
        { error: "Forbidden: admin key required" },
        { status: 403 }
      );
    }

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

/** DELETE: /api/manuals?manualId=xxxx（管理画面想定） */
export async function DELETE(req: Request) {
  try {
    if (!isAdminRequest(req)) {
      return Response.json(
        { error: "Forbidden: admin key required" },
        { status: 403 }
      );
    }

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
