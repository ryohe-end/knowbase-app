// app/api/accounting/writeoff/files/route.ts
//
// 貸倒処理: 事前生成済みCSV(S3)の一覧と、ダウンロード用の署名付きURLを返す。
//   GET            → 生成済みファイル一覧 [{ ym, filename, size, lastModified }]
//   GET ?ym=YYYYMM → その月のダウンロード用 署名付きURL { url, filename }
// 生成は月次バッチ knowbie-writeoff-batch が S3(knowbie-accounting-exports/writeoff/)へ保存。
// 画面はこのURLでS3から直接DLするため、Amplify経由の生成タイムアウトを回避できる。
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/accountingAuth";
import { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.ACCOUNTING_EXPORT_REGION || "us-east-1";
const BUCKET = process.env.ACCOUNTING_EXPORT_BUCKET || "knowbie-accounting-exports";
const PREFIX = "writeoff/";
const s3 = new S3Client({ region: REGION });

// キー "writeoff/貸倒YYYY年MM月.csv" → ym "YYYYMM"
function ymFromKey(key: string): string | null {
  const m = /貸倒(\d{4})年(\d{2})月\.csv$/.exec(key);
  return m ? `${m[1]}${m[2]}` : null;
}

export async function GET(req: NextRequest) {
  const user = await requireAccounting();
  if (!user) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const ym = (req.nextUrl.searchParams.get("ym") || "").trim();

  // 単一月: 署名付きURL
  if (ym) {
    if (!/^\d{6}$/.test(ym)) return NextResponse.json({ ok: false, error: "ym(YYYYMM) invalid" }, { status: 400 });
    const filename = `貸倒${ym.slice(0, 4)}年${ym.slice(4, 6)}月.csv`;
    const key = `${PREFIX}${filename}`;
    try {
      const url = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: BUCKET, Key: key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        ResponseContentType: "text/csv; charset=Shift_JIS",
      }), { expiresIn: 300 });
      return NextResponse.json({ ok: true, ym, filename, url });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: "not_generated", message: e?.message || null }, { status: 404 });
    }
  }

  // 一覧
  try {
    const objs: { ym: string; key: string; size: number; lastModified: string | null }[] = [];
    let token: string | undefined;
    do {
      const res: any = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
      for (const o of res.Contents || []) {
        const key = String(o.Key || "");
        const k = ymFromKey(key);
        if (!k) continue;
        objs.push({ ym: k, key, size: Number(o.Size || 0), lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    // 件数・金額は生成時にS3メタデータへ保存済み。HeadObject で読み出す(件数が少ないので許容)。
    const files = await Promise.all(objs.map(async (o) => {
      let rows: number | null = null, amount: number | null = null;
      try {
        const h: any = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: o.key }));
        const md = h.Metadata || {};
        rows = md.rows != null ? Number(md.rows) : null;
        amount = md.amount != null ? Number(md.amount) : null;
      } catch { /* メタ無しは null */ }
      return { ym: o.ym, filename: o.key.slice(PREFIX.length), size: o.size, lastModified: o.lastModified, rows, amount };
    }));
    files.sort((a, b) => b.ym.localeCompare(a.ym));
    return NextResponse.json({ ok: true, files });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "list_failed", message: e?.message || null }, { status: 502 });
  }
}
