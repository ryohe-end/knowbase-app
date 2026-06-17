// app/api/admin/public-pdfs/[pdfId]/route.ts
// PATCH (タイトル/説明更新), DELETE (S3 オブジェクト + DDB 削除)

import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { requestHasPermission } from "@/lib/auth";
import type { PublicPdf } from "@/types/publicPdf";

const REQUIRED_PERM = "public_pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DDB_REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_PUBLIC_PDFS_TABLE || "yamauchi-PublicPdfs";
const S3_BUCKET = process.env.PUBLIC_PDF_BUCKET || "houjin-manual";
const S3_REGION = process.env.PUBLIC_PDF_REGION || "us-east-2";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: DDB_REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const s3 = new S3Client({ region: S3_REGION });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ pdfId: string }> }) {
  if (!(await requestHasPermission(req, REQUIRED_PERM))) {
    return NextResponse.json(
      { ok: false, error: "permission_denied", required: REQUIRED_PERM },
      { status: 403 }
    );
  }
  const { pdfId } = await params;
  // S3-only エントリ (DDB 未登録) は編集対象外
  if (pdfId.startsWith("s3:")) {
    return NextResponse.json({ ok: false, error: "S3 直登録のファイルはタイトル編集できません" }, { status: 400 });
  }
  let body: { title?: string; description?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pdfId } }));
    const item = res.Item as PublicPdf | undefined;
    if (!item) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const updated: PublicPdf = {
      ...item,
      title: typeof body.title === "string" ? body.title.trim() : item.title,
      description: typeof body.description === "string" ? body.description : item.description,
      updatedAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: updated }));
    return NextResponse.json({ ok: true, item: updated });
  } catch (e: any) {
    console.error("[public-pdfs] PATCH error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ pdfId: string }> }) {
  if (!(await requestHasPermission(req, REQUIRED_PERM))) {
    return NextResponse.json(
      { ok: false, error: "permission_denied", required: REQUIRED_PERM },
      { status: 403 }
    );
  }
  const { pdfId } = await params;

  // S3 直登録のファイル (DDB 未登録) の場合は S3 のみ削除
  if (pdfId.startsWith("s3:")) {
    const s3Key = pdfId.slice(3);
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      console.error("[public-pdfs] S3-only delete failed:", e);
      return NextResponse.json({ ok: false, error: e?.message || "S3 error" }, { status: 500 });
    }
  }

  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pdfId } }));
    const item = res.Item as PublicPdf | undefined;
    if (!item) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    // S3 削除 (失敗しても DDB は消す: 孤児オブジェクトより孤児メタデータの方が悪い)
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: item.s3Bucket || S3_BUCKET, Key: item.s3Key }));
    } catch (e) {
      console.warn("[public-pdfs] S3 delete failed (ignored):", e);
    }
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pdfId } }));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[public-pdfs] DELETE error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
