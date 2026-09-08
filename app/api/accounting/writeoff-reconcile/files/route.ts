// app/api/accounting/writeoff-reconcile/files/route.ts
//
// 貸倒対象照合: 事前生成済みCSV(S3)の一覧 / 署名付きURL / 生成トリガ。
//   GET            → 生成済みファイル一覧 [{ ym, filename, scope, size, lastModified, rows, unpaid, balance }]
//   GET ?ym&scope  → ダウンロード用 署名付きURL { url, filename }   (scope: unpaid|all, 既定 unpaid)
//   POST { ym }    → その基準月のCSVを非同期生成(knowbie-writeoff-reconcile-batch を Event invoke)
// クエリが重い(~40s)ため生成はバッチに委譲し、画面はS3から直接DLする(タイムアウト回避)。
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/accountingAuth";
import { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.ACCOUNTING_EXPORT_REGION || "us-east-1";
const BUCKET = process.env.ACCOUNTING_EXPORT_BUCKET || "knowbie-accounting-exports";
const PREFIX = "writeoff-reconcile/";
const BATCH_FN = process.env.WRITEOFF_RECONCILE_BATCH_FUNCTION || "knowbie-writeoff-reconcile-batch";
const BATCH_REGION = process.env.WRITEOFF_RECONCILE_BATCH_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });
const lambda = new LambdaClient({ region: BATCH_REGION });

// キー "writeoff-reconcile/貸倒対象照合YYYY年MM月[_全件].csv" → { ym, scope }
function parseKey(key: string): { ym: string; scope: "unpaid" | "all" } | null {
  const m = /貸倒対象照合(\d{4})年(\d{2})月(_全件)?\.csv$/.exec(key);
  return m ? { ym: `${m[1]}${m[2]}`, scope: m[3] ? "all" : "unpaid" } : null;
}
function filenameFor(ym: string, scope: string): string {
  return `貸倒対象照合${ym.slice(0, 4)}年${ym.slice(4, 6)}月${scope === "all" ? "_全件" : ""}.csv`;
}

export async function GET(req: NextRequest) {
  const user = await requireAccounting();
  if (!user) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const ym = (req.nextUrl.searchParams.get("ym") || "").trim();
  const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "unpaid";

  // 単一月: 署名付きURL
  if (ym) {
    if (!/^\d{6}$/.test(ym)) return NextResponse.json({ ok: false, error: "ym(YYYYMM) invalid" }, { status: 400 });
    const filename = filenameFor(ym, scope);
    const key = `${PREFIX}${filename}`;
    try {
      const url = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: BUCKET, Key: key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        ResponseContentType: "text/csv; charset=Shift_JIS",
      }), { expiresIn: 300 });
      return NextResponse.json({ ok: true, ym, scope, filename, url });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: "not_generated", message: e?.message || null }, { status: 404 });
    }
  }

  // 一覧
  try {
    const objs: { ym: string; scope: "unpaid" | "all"; key: string; size: number; lastModified: string | null }[] = [];
    let token: string | undefined;
    do {
      const res: any = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
      for (const o of res.Contents || []) {
        const key = String(o.Key || "");
        const p = parseKey(key);
        if (!p) continue;
        objs.push({ ym: p.ym, scope: p.scope, key, size: Number(o.Size || 0), lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    const files = await Promise.all(objs.map(async (o) => {
      let rows: number | null = null, unpaid: number | null = null, balance: number | null = null;
      try {
        const h: any = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: o.key }));
        const md = h.Metadata || {};
        rows = md.rows != null ? Number(md.rows) : null;
        unpaid = md.unpaid != null ? Number(md.unpaid) : null;
        balance = md.balance != null ? Number(md.balance) : null;
      } catch { /* メタ無しは null */ }
      return { ym: o.ym, scope: o.scope, filename: o.key.slice(PREFIX.length), size: o.size, lastModified: o.lastModified, rows, unpaid, balance };
    }));
    // 新しい月順 → 同月は 貸倒対象(unpaid) を先に
    files.sort((a, b) => (a.ym !== b.ym ? b.ym.localeCompare(a.ym) : a.scope.localeCompare(b.scope)));
    return NextResponse.json({ ok: true, files });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "list_failed", message: e?.message || null }, { status: 502 });
  }
}

// 生成トリガ(非同期): バッチ Lambda を Event invoke。~1-2分後に GET で一覧を再取得する。
export async function POST(req: NextRequest) {
  const user = await requireAccounting();
  if (!user) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const ym = String(body?.ym || "").trim();
  if (!/^\d{6}$/.test(ym)) return NextResponse.json({ ok: false, error: "ym(YYYYMM) required" }, { status: 400 });
  const all = body?.all === true;

  try {
    await lambda.send(new InvokeCommand({
      FunctionName: BATCH_FN,
      InvocationType: "Event", // 非同期(fire-and-forget)。生成は~40s/月。
      Payload: Buffer.from(JSON.stringify({ ym, all })),
    }));
    return NextResponse.json({ ok: true, ym, all, triggered: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "trigger_failed", message: e?.message || null }, { status: 502 });
  }
}
