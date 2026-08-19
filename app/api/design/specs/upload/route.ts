// app/api/design/specs/upload/route.ts
// 設計担当のみ: 仕様書/標準図ファイルの S3 署名付き PUT URL を発行する。
//   POST { fileName, contentType, size } → { ok, url, key, headers }
// クライアントは返却 url へ PUT(Content-Type 一致)でアップロードし、key を
// /api/design/specs の files[] に載せて登録する。
import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDesignUser } from "@/lib/designSpecAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.SPEC_DOCS_REGION || process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.SPEC_DOCS_BUCKET || "knowbie-spec-documents";
const s3 = new S3Client({ region: REGION });

// 100MB 上限(CAD/PDF想定)。
const MAX_SIZE = 100 * 1024 * 1024;
// 許可拡張子。標準図(CAD)含む。
const ALLOWED_EXT = new Set(["pdf", "dwg", "dxf", "dwf", "jww", "png", "jpg", "jpeg", "zip", "xlsx", "docx"]);

function safeName(name: string): string {
  return String(name || "file").replace(/[^\w.\-]+/g, "_").slice(-120);
}
function uuid(): string {
  return "xxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)) + Date.now().toString(36);
}

export async function POST(req: Request) {
  const user = await getDesignUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!user.canEdit) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  const fileName = safeName(body?.fileName || "");
  const contentType = String(body?.contentType || "application/octet-stream");
  const size = Number(body?.size) || 0;
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  if (!fileName || fileName === "file") return NextResponse.json({ ok: false, error: "fileName required" }, { status: 400 });
  if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ ok: false, error: `unsupported_ext: .${ext}`, allowed: [...ALLOWED_EXT] }, { status: 400 });
  if (size > MAX_SIZE) return NextResponse.json({ ok: false, error: "too_large", maxBytes: MAX_SIZE }, { status: 400 });

  const now = new Date();
  const key = `specs/${now.getUTCFullYear()}/${uuid()}-${fileName}`;
  try {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 600 }
    );
    return NextResponse.json({ ok: true, url, key, headers: { "Content-Type": contentType } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
