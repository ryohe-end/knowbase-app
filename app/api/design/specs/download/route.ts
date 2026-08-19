// app/api/design/specs/download/route.ts
// 閲覧者: 仕様書/標準図ファイルの S3 署名付き GET URL を発行(または 302 リダイレクト)。
//   GET ?key=...&specId=...[&redirect=1][&inline=1]
// specId の viewScope を検証し、その仕様書に属する key のみ許可する。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDesignUser, canViewScope } from "@/lib/designSpecAuth";
import type { SpecDocument } from "@/types/specDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.SPEC_DOCS_REGION || process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.SPEC_DOCUMENTS_TABLE || "yamauchi-SpecDocuments";
const BUCKET = process.env.SPEC_DOCS_BUCKET || "knowbie-spec-documents";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3 = new S3Client({ region: REGION });

export async function GET(req: Request) {
  const user = await getDesignUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const key = (sp.get("key") || "").trim();
  const specId = (sp.get("specId") || "").trim();
  const redirect = sp.get("redirect") === "1";
  const inline = sp.get("inline") === "1";
  if (!key || !specId) return NextResponse.json({ ok: false, error: "key and specId required" }, { status: 400 });

  try {
    // specId を検証: 閲覧可能で、その key が属する仕様書のファイルであること。
    const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { specId } }));
    const item = r.Item as SpecDocument | undefined;
    if (!item) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    if (!canViewScope(user, item.viewScope)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    const file = (item.files || []).find((f) => f.key === key);
    if (!file) return NextResponse.json({ ok: false, error: "file_not_in_spec" }, { status: 400 });

    // inline(ブラウザ内表示 / 主にPDF) or attachment(ダウンロード)。
    const disp = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`;
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key, ResponseContentDisposition: disp, ResponseContentType: file.contentType }),
      { expiresIn: 600 }
    );
    if (redirect) return NextResponse.redirect(url, 302);
    return NextResponse.json({ ok: true, url, name: file.name, contentType: file.contentType });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
