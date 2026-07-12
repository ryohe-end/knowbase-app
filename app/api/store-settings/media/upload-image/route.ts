// app/api/store-settings/media/upload-image/route.ts
// お知らせ/DM の画像を S3 (knowbie-notice-images) に直接アップロードするための
// 署名付き PUT URL を発行する共通エンドポイント。
//   POST { filename, contentType, sizeBytes }
//     → { ok, presignedUrl, publicUrl, key }
// クライアントは presignedUrl に PUT でファイル本体を送り、publicUrl を imageUrl として使う。
// publicUrl は公開GET可能なので、SendGrid メール内の <img src> でもそのまま表示できる。
import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const S3_BUCKET = process.env.NOTICE_IMAGE_BUCKET || "knowbie-notice-images";
const S3_REGION = process.env.NOTICE_IMAGE_REGION || "us-east-1";

const s3 = new S3Client({ region: S3_REGION });

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function publicUrlFor(key: string): string {
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${encodeURI(key)}`;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { filename?: string; contentType?: string; sizeBytes?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const filename = (body.filename || "image").trim();
  const contentType = (body.contentType || "").trim();
  const sizeBytes = Number(body.sizeBytes);

  const ext = ALLOWED_CONTENT_TYPES[contentType];
  if (!ext) {
    return NextResponse.json({ ok: false, error: "画像ファイル(PNG/JPEG/WebP/GIF)のみアップロード可能です" }, { status: 400 });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: "ファイルサイズは 10MB 以内にしてください" }, { status: 400 });
  }

  // 公開参照は notice/* プレフィックスのみ(バケットポリシー)。UUID で衝突回避。
  const safeName = filename.replace(/[/\\?*:|"<>]/g, "_").slice(-80) || `image.${ext}`;
  const key = `notice/${randomUUID()}/${safeName}`;

  let presignedUrl: string;
  try {
    presignedUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: 60 * 10 } // 10分
    );
  } catch (e: any) {
    console.error("[media/upload-image] presign failed", e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || "presign error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, presignedUrl, publicUrl: publicUrlFor(key), key });
}
