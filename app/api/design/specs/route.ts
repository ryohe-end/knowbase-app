// app/api/design/specs/route.ts
// 設計業務① 仕様書・標準図ライブラリ CRUD。
//   GET    ?specId=            … 単体(閲覧可否チェック)
//   GET    ?docType=&brandId=  … 一覧(viewScopeで絞り込み)。編集者は全件
//   POST   {…}                 … 新規登録(設計担当のみ)
//   PUT    {specId,…}          … 更新(設計担当のみ)
//   DELETE ?specId=            … 削除(設計担当のみ)。S3実体もbest-effortで削除
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getDesignUser, canViewScope } from "@/lib/designSpecAuth";
import {
  type SpecDocument, type SpecFile,
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
function newSpecId(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SPEC-${ymd}-${rnd}`;
}

// 入力を安全な SpecDocument に整形(共通)。
function sanitize(body: any, base?: Partial<SpecDocument>): Omit<SpecDocument, "specId"> {
  const docType = SPEC_DOC_TYPES.includes(body?.docType) ? body.docType : (base?.docType || "仕様書");
  const brandId = SPEC_BRANDS.includes(body?.brandId) ? body.brandId : (base?.brandId || "ALL");
  const viewScope = SPEC_VIEW_SCOPES.includes(body?.viewScope) ? body.viewScope : (base?.viewScope || "ALL");
  const files: SpecFile[] = Array.isArray(body?.files)
    ? body.files
        .filter((f: any) => f && typeof f.key === "string" && f.key)
        .map((f: any) => ({
          name: String(f.name || f.key.split("/").pop() || "file"),
          key: String(f.key),
          size: Number(f.size) || 0,
          contentType: String(f.contentType || "application/octet-stream"),
          uploadedAt: typeof f.uploadedAt === "string" ? f.uploadedAt : nowIso(),
        }))
    : (base?.files || []);
  const tags = Array.isArray(body?.tags)
    ? body.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 20)
    : (base?.tags || []);
  return {
    title: String(body?.title ?? base?.title ?? "").trim(),
    desc: body?.desc != null ? String(body.desc) : (base?.desc ?? null),
    docType,
    brandId,
    viewScope,
    categoryId: body?.categoryId != null ? String(body.categoryId).trim() || null : (base?.categoryId ?? null),
    version: body?.version != null ? String(body.version).trim() || null : (base?.version ?? null),
    tags,
    files,
    createdBy: base?.createdBy ?? null,
    createdAt: base?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    readCount: base?.readCount ?? 0,
  };
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
      const item = r.Item as SpecDocument | undefined;
      if (!item) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      if (!canViewScope(user, item.viewScope)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      return NextResponse.json({ ok: true, spec: item, canEdit: user.canEdit });
    }

    const items: SpecDocument[] = [];
    let ek: any;
    do {
      const r: any = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: ek }));
      for (const it of r.Items ?? []) if (it.specId) items.push(it as SpecDocument);
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

  const data = sanitize(body, { createdBy: user.email });
  if (!data.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  const specId = newSpecId();
  try {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { specId, ...data } }));
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
    const prev = cur.Item as SpecDocument | undefined;
    if (!prev) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const data = sanitize(body, prev);
    if (!data.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { specId, ...data } }));
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
    const prev = cur.Item as SpecDocument | undefined;
    // S3 実体も best-effort で削除
    const keys = (prev?.files || []).map((f) => ({ Key: f.key })).filter((o) => o.Key);
    if (keys.length) {
      try { await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } })); } catch (_) { /* noop */ }
    }
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { specId } }));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
