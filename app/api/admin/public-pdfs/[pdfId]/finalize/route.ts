// app/api/admin/public-pdfs/[pdfId]/finalize/route.ts
// クライアントが S3 PUT を完了したら status を ready に切り替える。
// HeadObject で S3 側の存在確認も行う。

import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { isAdminRequest } from "@/lib/auth";
import type { PublicPdf } from "@/types/publicPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DDB_REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_PUBLIC_PDFS_TABLE || "yamauchi-PublicPdfs";
const S3_REGION = process.env.PUBLIC_PDF_REGION || "us-east-2";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: DDB_REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const s3 = new S3Client({ region: S3_REGION });

export async function POST(req: NextRequest, { params }: { params: Promise<{ pdfId: string }> }) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const { pdfId } = await params;

  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pdfId } }));
    const item = res.Item as PublicPdf | undefined;
    if (!item) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    // S3 に実体があるか確認
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: item.s3Bucket, Key: item.s3Key }));
      const actualSize = Number(head.ContentLength || 0);
      const updated: PublicPdf = {
        ...item,
        sizeBytes: actualSize > 0 ? actualSize : item.sizeBytes,
        status: "ready",
        updatedAt: new Date().toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: updated }));
      return NextResponse.json({ ok: true, item: updated });
    } catch (e: any) {
      console.error("[public-pdfs] head failed", e);
      return NextResponse.json(
        { ok: false, error: "S3 上にオブジェクトが見つかりません。アップロードを再試行してください。" },
        { status: 400 }
      );
    }
  } catch (e: any) {
    console.error("[public-pdfs] finalize error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
