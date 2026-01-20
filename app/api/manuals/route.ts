// app/api/manuals/route.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

/**
 * ✅ env（きれい版）
 * - KB_ADMIN_API_KEY: 管理画面が全件取得/更新するための鍵（あなたが手で決めた文字列でOK）
 * - KB_DIRECT_GROUP_ID: 直営の groupId（例: g001）
 * - KB_HQ_GROUP_ID: 本部の groupId（例: g003）
 * - KB_FC_GROUP_ID: FCの groupId（例: g002）
 */
const KB_ADMIN_API_KEY = (process.env.KB_ADMIN_API_KEY || "").trim();

/** 推奨: g001 / g003 / g002（環境に合わせて env で上書き） */
const DIRECT_GROUP_ID = (process.env.KB_DIRECT_GROUP_ID || "g001").trim(); // 直営
const HQ_GROUP_ID = (process.env.KB_HQ_GROUP_ID || "g003").trim(); // 本部
const FC_GROUP_ID = (process.env.KB_FC_GROUP_ID || "g002").trim(); // FC

// 旧値/表記ゆれ保険（必要に応じて増やしてOK）
const DIRECT_GROUP_ALIASES = Array.from(
  new Set([DIRECT_GROUP_ID, "g001", "G_DIRECT"].filter(Boolean))
);
const HQ_GROUP_ALIASES = Array.from(
  new Set([HQ_GROUP_ID, "g003", "G_HQ"].filter(Boolean))
);
const FC_GROUP_ALIASES = Array.from(
  new Set([FC_GROUP_ID, "g002", "G_FC", "fc"].filter(Boolean))
);

// ✅ 正規化（大小文字/空白ゆれ対策）
const norm = (s: string) => String(s || "").trim().toLowerCase();

// ✅ Set 化
const DIRECT_GROUP_SET = new Set(DIRECT_GROUP_ALIASES.map(norm));
const HQ_GROUP_SET = new Set(HQ_GROUP_ALIASES.map(norm));
const FC_GROUP_SET = new Set(FC_GROUP_ALIASES.map(norm));

// DynamoDBクライアントの初期化
const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);

export type ManualType = "doc" | "video";
export type ViewScope = "ALL" | "DIRECT" | "FC";

export type Manual = {
  manualId: string;
  title: string;

  brandId?: string; // "ALL" or brandId
  brand?: string;

  bizId?: string; // deptId相当
  biz?: string;

  desc?: string | null;
  updatedAt?: string;
  createdAt?: string;
  tags?: string[];

  embedUrl?: string;
  externalUrl?: string;
  noDownload?: boolean;
  readCount?: number;

  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  type?: ManualType;

  isNew?: boolean;

  // ✅ 閲覧権限（すべて / 直営のみ / FCのみ）
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
  const s = String(v || "").toLowerCase().trim();
  if (s === "doc" || s === "video") return s as ManualType;
  return undefined;
}

function normalizeViewScope(v: any): ViewScope {
  const s = String(v || "").toUpperCase().trim();
  if (s === "DIRECT") return "DIRECT";
  if (s === "FC") return "FC";
  return "ALL";
}

/** DynamoDB AttributeValue / 文字列 / 数値 を "g001" 形式に寄せる */
function normalizeGroupId(v: any): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === "number") return String(v);

  if (typeof v === "object") {
    // DynamoDB AttributeValue 形式
    if (typeof v.S === "string") return v.S.trim();
    if (typeof v.N === "string") return v.N.trim();
  }

  const s = String(v).trim();
  return s ? s : null;
}

/**
 * header: x-kb-group-ids を柔軟に受ける
 * - "g001,g003"
 * - '["g001","g003"]'
 * - '[{"S":"g001"},{"S":"g003"}]'   ← あなたのパターン
 * - さらに保険で x-kb-group-id（単数）も拾う
 */
function parseGroupIds(req: Request): { primary?: string; all: string[] } {
  // まず複数ヘッダ
  const raw = (req.headers.get("x-kb-group-ids") || "").trim();
  // 単数ヘッダ保険
  const rawOne = (req.headers.get("x-kb-group-id") || "").trim();

  const collected: string[] = [];

  const pushNormalized = (val: any) => {
    const s = normalizeGroupId(val);
    if (s) collected.push(s);
  };

  // 1) x-kb-group-ids が JSON っぽい場合は JSON パースを試す
  if (raw) {
    const first = raw[0];
    const looksJson = first === "[" || first === "{";
    if (looksJson) {
      try {
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          for (const x of parsed) pushNormalized(x);
        } else {
          // {S:"g001"} みたいな単体の可能性
          pushNormalized(parsed);
        }
      } catch {
        // JSON 失敗 → カンマ区切りとして扱う
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((s) => pushNormalized(s));
      }
    } else {
      // 2) 通常のカンマ区切り
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => pushNormalized(s));
    }
  }

  // 3) 単数ヘッダ
  if (rawOne) pushNormalized(rawOne);

  // 4) 重複除去 + 空除去
  const all = Array.from(new Set(collected.map((s) => s.trim()).filter(Boolean)));

  return { primary: all[0], all };
}

/** 管理者判定（管理画面はこれを必ず付ける運用にする） */
function isAdminRequest(req: Request) {
  if (!KB_ADMIN_API_KEY) return false;
  const key = (req.headers.get("x-kb-admin-key") || "").trim();
  return !!key && key === KB_ADMIN_API_KEY;
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
 * ✅ viewScope の閲覧可否（一般ユーザー向け）
 *
 * 期待仕様：
 * - ALL    : admin ✅ / direct ✅ / fc ✅
 * - DIRECT : admin ✅ / direct ✅ / fc ❌
 * - FC     : admin ✅ / direct ❌ / fc ✅
 *
 * admin は GET で先に全件分岐するので、ここは「一般ユーザー」の判定。
 * ただし「本部(HQ)は全部見れる」を再現するため HQ は direct/fc どちらにも許可側に入れる。
 */
function canViewManualByScope(req: Request, manual: Manual): boolean {
  const scope: ViewScope = manual.viewScope || "ALL";
  if (scope === "ALL") return true;

  const { all } = parseGroupIds(req);
  if (all.length === 0) return false;

  const hasHQ = all.some((id) => HQ_GROUP_SET.has(norm(id)));
  const hasDirect = all.some((id) => DIRECT_GROUP_SET.has(norm(id)));
  const hasFc = all.some((id) => FC_GROUP_SET.has(norm(id)));

  if (scope === "DIRECT") {
    // 本部 or 直営
    return hasHQ || hasDirect;
  }

  if (scope === "FC") {
    // 本部 or FC
    return hasHQ || hasFc;
  }

  return true;
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
    createdAt: item.createdAt ? String(item.createdAt) : undefined,
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

    // ✅ viewScope（ALL / DIRECT / FC）
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

  const now = new Date().toISOString();

  // ✅ createdAt は「既存があれば維持」、無ければ新規作成
  const finalCreatedAt = input.createdAt ? String(input.createdAt) : now;
  const updatedAt = now;

  // ✅ viewScope（ALL / DIRECT / FC）
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
    createdAt: finalCreatedAt,
    updatedAt,
    viewScope,
  };
}

/** GET: /api/manuals
 * - 管理画面（x-kb-admin-key 正しい）: 全件（?onlyActive=1があれば期間フィルタ）
 * - 一般画面: viewScope フィルタ ＋ 公開期間(start/end)内を強制フィルタ
 * - debug=1: ヘッダー/判定情報を返す（原因特定用）
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const isAdmin = isAdminRequest(req);

    const debug = url.searchParams.get("debug") === "1";

    // ✅ 一般ユーザー（!isAdmin）は強制 onlyActive
    const onlyActive = url.searchParams.get("onlyActive") === "1" || !isAdmin;
    const nowYmd = new Date().toISOString().slice(0, 10);

    const result = await ddbDoc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    const items = result.Items || [];
    const allManuals = items.map(mapItemToManual);

    // ✅ 管理者: 全件（任意で onlyActive）
    if (isAdmin) {
      const manuals =
        url.searchParams.get("onlyActive") === "1"
          ? allManuals.filter((m) => isActiveByDate(m, nowYmd))
          : allManuals;

      // 管理者でも debug 見たいことあるので返す
      if (debug) {
        return Response.json({
          admin: true,
          onlyActive,
          nowYmd,
          headers: {
            "x-kb-group-ids": req.headers.get("x-kb-group-ids"),
            "x-kb-group-id": req.headers.get("x-kb-group-id"),
            "x-kb-admin-key": req.headers.get("x-kb-admin-key") ? "(present)" : "(none)",
          },
          counts: {
            scanned: items.length,
            manuals: manuals.length,
          },
          sample: manuals.slice(0, 10),
        });
      }

      return Response.json({ manuals, admin: true });
    }

    // ✅ 一般ユーザー:
    // 1) viewScope でフィルタ
    let manuals = allManuals.filter((m) => canViewManualByScope(req, m));

    // 2) 公開期間でフィルタ（一般は必ず実行）
    if (onlyActive) {
      manuals = manuals.filter((m) => isActiveByDate(m, nowYmd));
    }

    if (debug) {
      // canView の判定材料を全部見える化
      const parsed = parseGroupIds(req);
      const all = parsed.all;

      const hasHQ = all.some((id) => HQ_GROUP_SET.has(norm(id)));
      const hasDirect = all.some((id) => DIRECT_GROUP_SET.has(norm(id)));
      const hasFc = all.some((id) => FC_GROUP_SET.has(norm(id)));

      // DIRECTのmanualが何件あって、見える判定になってるか
      const directSamples = allManuals
        .filter((m) => (m.viewScope || "ALL") === "DIRECT")
        .slice(0, 10)
        .map((m) => ({
          manualId: m.manualId,
          title: m.title,
          viewScope: m.viewScope,
          canView: canViewManualByScope(req, m),
          startDate: m.startDate,
          endDate: m.endDate,
        }));

      return Response.json({
        admin: false,
        onlyActive,
        nowYmd,
        headers: {
          "x-kb-group-ids": req.headers.get("x-kb-group-ids"),
          "x-kb-group-id": req.headers.get("x-kb-group-id"),
          "x-kb-admin-key": req.headers.get("x-kb-admin-key") ? "(present)" : "(none)",
        },
        parsedGroupIds: parsed,
        groupMatch: { hasHQ, hasDirect, hasFc },
        counts: {
          scanned: items.length,
          allManuals: allManuals.length,
          afterScope: allManuals.filter((m) => canViewManualByScope(req, m)).length,
          afterActive: manuals.length,
        },
        directSamples,
      });
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


/** POST: /api/manuals 新規登録（管理画面想定） */
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

