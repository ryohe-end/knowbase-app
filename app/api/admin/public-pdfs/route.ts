// app/api/admin/public-pdfs/route.ts
// 外部公開 PDF の一覧 + アップロード初期化 API。
//   GET  : 一覧取得 (admin)
//   POST : 署名付き PUT URL を発行 → クライアントが直接 S3 にアップロード
//          { filename, contentType, sizeBytes, title?, description? }
//          → { ok, pdfId, presignedUrl, publicUrl, s3Key }

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { isAdminRequest, verifySignedValue } from "@/lib/auth";
import type { PublicPdf } from "@/types/publicPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DDB_REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_PUBLIC_PDFS_TABLE || "yamauchi-PublicPdfs";
const USERS_TABLE = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";

const S3_BUCKET = process.env.PUBLIC_PDF_BUCKET || "houjin-manual";
const S3_REGION = process.env.PUBLIC_PDF_REGION || "us-east-2";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: DDB_REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const s3 = new S3Client({ region: S3_REGION });

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_CONTENT_TYPES = ["application/pdf"];

function publicUrlFor(key: string): string {
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${encodeURI(key)}`;
}

async function getCurrentUser() {
  try {
    const cookieStore = await cookies();
    const rawUser = cookieStore.get("kb_user")?.value ?? "";
    const email = (await verifySignedValue(rawUser)) ?? "";
    if (!email) return null;
    const res = await ddb.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: EMAIL_GSI_NAME,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
        ProjectionExpression: "userId, #n, email, #r",
        ExpressionAttributeNames: { "#n": "name", "#r": "role" },
      })
    );
    const u = res.Items?.[0] as any;
    if (!u) return null;
    return {
      userId: String(u.userId ?? ""),
      name: String(u.name ?? ""),
      email: String(u.email ?? ""),
      role: String(u.role ?? ""),
    };
  } catch (e) {
    console.error("[public-pdfs] user fetch failed", e);
    return null;
  }
}

// 一覧
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  try {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
    const items = ((res.Items ?? []) as PublicPdf[])
      .filter((p) => p.status === "ready")
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    console.error("[public-pdfs] GET error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

// 署名付き PUT URL 発行 (アップロード初期化)
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { filename?: string; contentType?: string; sizeBytes?: number; title?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const filename = (body.filename || "").trim();
  const contentType = (body.contentType || "application/pdf").trim();
  const sizeBytes = Number(body.sizeBytes);

  if (!filename) {
    return NextResponse.json({ ok: false, error: "filename required" }, { status: 400 });
  }
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json({ ok: false, error: "PDF のみアップロード可能です" }, { status: 400 });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: `ファイルサイズは 1B 〜 ${MAX_SIZE_BYTES} B の範囲で指定してください` }, { status: 400 });
  }

  const pdfId = randomUUID();
  // ファイル名はそのまま使うが、衝突避けのため pdfId をパス区切りで前置
  const safeName = filename.replace(/[/\\?*:|"<>]/g, "_");
  const s3Key = `external-share/${pdfId}/${safeName}`;
  const publicUrl = publicUrlFor(s3Key);
  const now = new Date().toISOString();

  // 署名付き PUT URL を発行 (ACL=public-read で公開アクセス可)
  let presignedUrl: string;
  try {
    presignedUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        ContentType: contentType,
        ContentLength: sizeBytes,
        ACL: "public-read",
      }),
      { expiresIn: 60 * 10 } // 10 分
    );
  } catch (e: any) {
    console.error("[public-pdfs] presign failed", e);
    return NextResponse.json({ ok: false, error: e?.message || "presign error" }, { status: 500 });
  }

  // pending 状態で DDB に下書き
  const item: PublicPdf = {
    pdfId,
    s3Key,
    s3Bucket: S3_BUCKET,
    s3Region: S3_REGION,
    publicUrl,
    title: (body.title || filename).trim(),
    description: body.description,
    originalName: filename,
    contentType,
    sizeBytes,
    status: "pending",
    uploadedById: user.userId,
    uploadedByName: user.name,
    uploadedByEmail: user.email,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(pdfId)",
      })
    );
  } catch (e: any) {
    console.error("[public-pdfs] init put failed", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    pdfId,
    presignedUrl,
    publicUrl,
    s3Key,
    requiredHeaders: {
      "Content-Type": contentType,
      "x-amz-acl": "public-read",
    },
  });
}
