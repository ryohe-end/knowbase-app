// app/api/design/specs/route.ts
// 設計業務① 仕様書・標準図ライブラリ CRUD(版履歴対応)。
//   GET    ?specId=            … 単体(閲覧可否チェック)
//   GET    ?docType=&brandId=  … 一覧(viewScopeで絞り込み)。編集者は全件
//   POST   {…, files/label/note} … 新規登録(初版を作成、設計担当のみ)
//   PUT    {specId, versions[], …} … 更新(メタ更新 + 版履歴を丸ごと保存、設計担当のみ)
//   DELETE ?specId=            … 削除(設計担当のみ)。全版のS3実体もbest-effortで削除
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getDesignUser, canViewScope } from "@/lib/designSpecAuth";
import {
  type SpecDocument, type SpecFile, type SpecVersion,
  SPEC_DOC_TYPES, SPEC_BRANDS, SPEC_VIEW_SCOPES,
} from "@/types/specDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.SPEC_DOCS_REGION || process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.SPEC_DOCUMENTS_TABLE || "yamauchi-SpecDocuments";
const BUCKET = process.env.SPEC_DOCS_BUCKET || "knowbie-spec-documents";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({ region: REGION });

const nowIso = () => new Date().toISOString();
function rid(prefix: string): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${ymd}-${rnd}`;
}

function sanitizeFiles(raw: any): SpecFile[] {
  return Array.isArray(raw)
    ? raw
        .filter((f: any) => f && typeof f.key === "string" && f.key)
        .map((f: any) => ({
          name: String(f.name || f.key.split("/").pop() || "file"),
          key: String(f.key),
          size: Number(f.size) || 0,
          contentType: String(f.contentType || "application/octet-stream"),
          uploadedAt: typeof f.uploadedAt === "string" ? f.uploadedAt : nowIso(),
        }))
    : [];
}

// 版配列を整形。versionId 補完、現行版を必ず1件に正規化(最新 createdAt を優先)。
function sanitizeVersions(raw: any, userEmail?: string | null): SpecVersion[] {
  const arr: SpecVersion[] = (Array.isArray(raw) ? raw : [])
    .map((v: any) => ({
      versionId: typeof v?.versionId === "string" && v.versionId ? v.versionId : rid("VER"),
      label: v?.label != null ? String(v.label).trim() || null : null,
      note: v?.note != null ? String(v.note) : null,
      files: sanitizeFiles(v?.files),
      createdAt: typeof v?.createdAt === "string" ? v.createdAt : nowIso(),
      createdBy: v?.createdBy != null ? String(v.createdBy) : (userEmail ?? null),
      isCurrent: !!v?.isCurrent,
    }));
  if (arr.length === 0) return arr;
  // 現行版は1件だけ。指定が0/複数なら createdAt 最新を現行にする。
  const currents = arr.filter((v) => v.isCurrent);
  if (currents.length !== 1) {
    const newest = [...arr].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    arr.forEach((v) => { v.isCurrent = v.versionId === newest.versionId; });
  }
  return arr;
}

// 旧形式(flat files/version)を版履歴に正規化。既存データ救済。
function normalizeDoc(item: any): SpecDocument {
  if (item && Array.isArray(item.versions) && item.versions.length > 0) {
    item.versions = sanitizeVersions(item.versions);
    return item as SpecDocument;
  }
  const files = sanitizeFiles(item?.files);
  const versions: SpecVersion[] = [{
    versionId: rid("VER"),
    label: item?.version != null ? String(item.version).trim() || null : null,
    note: null,
    files,
    createdAt: item?.createdAt || nowIso(),
    createdBy: item?.createdBy ?? null,
    isCurrent: true,
  }];
  const { version: _v, files: _f, ...rest } = item || {};
  return { ...rest, versions } as SpecDocument;
}

// ドキュメントのメタ部分(版以外)を整形。
function sanitizeMeta(body: any, base?: Partial<SpecDocument>) {
  const docType = SPEC_DOC_TYPES.includes(body?.docType) ? body.docType : (base?.docType || "仕様書");
  const brandId = SPEC_BRANDS.includes(body?.brandId) ? body.brandId : (base?.brandId || "ALL");
  const viewScope = SPEC_VIEW_SCOPES.includes(body?.viewScope) ? body.viewScope : (base?.viewScope || "ALL");
  const tags = Array.isArray(body?.tags)
    ? body.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 20)
    : (base?.tags || []);
  return {
    title: String(body?.title ?? base?.title ?? "").trim(),
    desc: body?.desc != null ? String(body.desc) : (base?.desc ?? null),
    docType, brandId, viewScope,
    categoryId: body?.categoryId != null ? String(body.categoryId).trim() || null : (base?.categoryId ?? null),
    tags,
  };
}

function allKeys(doc: Pick<SpecDocument, "versions">): { Key: string }[] {
  const keys = new Set<string>();
  for (const v of doc.versions || []) for (const f of v.files || []) if (f.key) keys.add(f.key);
  return [...keys].map((Key) => ({ Key }));
}

export async function GET(req: Request) {
  const user = await getDesignUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const specId = (sp.get("specId") || "").trim();
  const docType = (sp.get("docType") || "").trim();
  const brandId = (sp.get("brandId") || "").trim();

  try {
    if (specId) {
      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { specId } }));
      if (!r.Item) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      const item = normalizeDoc(r.Item);
      if (!canViewScope(user, item.viewScope)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      return NextResponse.json({ ok: true, spec: item, canEdit: user.canEdit });
    }

    const items: SpecDocument[] = [];
    let ek: any;
    do {
      const r: any = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: ek }));
      for (const it of r.Items ?? []) if (it.specId) items.push(normalizeDoc(it));
      ek = r.LastEvaluatedKey;
    } while (ek);

    let specs = items.filter((s) => canViewScope(user, s.viewScope));
    if (docType) specs = specs.filter((s) => s.docType === docType);
    if (brandId) specs = specs.filter((s) => s.brandId === brandId || s.brandId === "ALL");
    specs.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return NextResponse.json({ ok: true, count: specs.length, canEdit: user.canEdit, specs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getDesignUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!user.canEdit) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  const meta = sanitizeMeta(body, { createdBy: user.email } as any);
  if (!meta.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  // 初版: body.versions があればそれ、無ければ body.files/label/note から1版作る。
  const rawVersions = Array.isArray(body?.versions) && body.versions.length
    ? body.versions
    : [{ label: body?.label ?? body?.version ?? null, note: body?.note ?? null, files: body?.files, isCurrent: true, createdBy: user.email }];
  const versions = sanitizeVersions(rawVersions, user.email);
  const specId = rid("SPEC");
  const item: SpecDocument = {
    specId, ...meta, versions,
    createdBy: user.email, createdAt: nowIso(), updatedAt: nowIso(), readCount: 0,
  };
  try {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return NextResponse.json({ ok: true, specId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const user = await getDesignUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!user.canEdit) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 }); }
  const specId = String(body?.specId || "").trim();
  if (!specId) return NextResponse.json({ ok: false, error: "specId required" }, { status: 400 });

  try {
    const cur = await ddb.send(new GetCommand({ TableName: TABLE, Key: { specId } }));
    if (!cur.Item) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const prev = normalizeDoc(cur.Item);
    const meta = sanitizeMeta(body, prev);
    if (!meta.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
    // versions が来ていれば丸ごと差し替え(クライアントが版の追加/現行切替/削除を管理)。無ければ据置。
    const versions = Array.isArray(body?.versions)
      ? sanitizeVersions(body.versions, user.email)
      : prev.versions;
    if (versions.length === 0) return NextResponse.json({ ok: false, error: "at_least_one_version" }, { status: 400 });
    const item: SpecDocument = {
      specId, ...meta, versions,
      createdBy: prev.createdBy ?? user.email,
      createdAt: prev.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      readCount: prev.readCount ?? 0,
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return NextResponse.json({ ok: true, specId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const user = await getDesignUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!user.canEdit) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const specId = (new URL(req.url).searchParams.get("specId") || "").trim();
  if (!specId) return NextResponse.json({ ok: false, error: "specId required" }, { status: 400 });

  try {
    const cur = await ddb.send(new GetCommand({ TableName: TABLE, Key: { specId } }));
    const prev = cur.Item ? normalizeDoc(cur.Item) : null;
    // 全版のS3実体を best-effort で削除
    const keys = prev ? allKeys(prev) : [];
    if (keys.length) {
      try { await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } })); } catch (_) { /* noop */ }
    }
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { specId } }));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
