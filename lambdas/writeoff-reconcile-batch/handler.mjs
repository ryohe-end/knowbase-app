// knowbie-writeoff-reconcile-batch
//
// 貸倒対象照合(経理連携)CSVを事前生成する月次バッチ。
//   - member-search(type=writeoff_reconcile gzip)を invoke → 解凍 → Shift-JIS → S3 保存。
//   - クエリが重い(~40s)ため、その場生成(API GW 29s / Amplify SSR)はタイムアウトする。
//     本バッチで事前生成し、画面は S3 の署名付きURLで直接DLする。
//   - 基準月 M(=当月売上月)ごとに生成。既定は「未納>0(SB未納額+口振未納金)の貸倒対象のみ」。
//
// 起動:
//   - EventBridge 月次(既定): 直近 MONTHS ヶ月の M を再生成。
//   - 手動/オンデマンド invoke:
//       { ym: "YYYYMM" }        → その基準月1件のみ生成
//       { months: 3 }           → 直近3ヶ月
//       { all: true }           → 全会員版(未納=0も含む)も併せて生成(接尾辞 _全件)
//
// 環境変数: MEMBER_SEARCH_FUNCTION(既定 knowbie-member-search),
//           MEMBER_SEARCH_REGION(既定 ap-northeast-1),
//           EXPORT_BUCKET(既定 knowbie-accounting-exports), EXPORT_PREFIX(既定 writeoff-reconcile/),
//           MONTHS(既定 3), AWS_REGION
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";
import Encoding from "encoding-japanese";

const MEMBER_SEARCH_FN = process.env.MEMBER_SEARCH_FUNCTION || "knowbie-member-search";
const MEMBER_SEARCH_REGION = process.env.MEMBER_SEARCH_REGION || "ap-northeast-1";
const BUCKET = process.env.EXPORT_BUCKET || "knowbie-accounting-exports";
const PREFIX = process.env.EXPORT_PREFIX || "writeoff-reconcile/";
const DEFAULT_MONTHS = Math.max(1, Math.min(12, Number(process.env.MONTHS || 3)));

const lambda = new LambdaClient({ region: MEMBER_SEARCH_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

// 基準月(当月): 現在から直近 n ヶ月の "YYYYMM"
function recentMonths(now, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// member-search から gzip(UTF-8) CSV + 集計を取得。all=true で全会員版。
async function fetchGzCsv(ym, all) {
  const qs = { type: "writeoff_reconcile", ym, gzip: "1" };
  if (all) qs.all = "1";
  const res = await lambda.send(new InvokeCommand({
    FunctionName: MEMBER_SEARCH_FN, InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({ queryStringParameters: qs })),
  }));
  if (res.FunctionError) throw new Error("member-search: " + res.FunctionError);
  const payload = res.Payload ? Buffer.from(res.Payload).toString("utf-8") : "{}";
  const outer = JSON.parse(payload);
  const body = typeof outer.body === "string" ? JSON.parse(outer.body) : outer;
  if (!body || body.error || !body.gzB64) throw new Error(body?.message || body?.error || "no gzB64");
  return {
    count: body.count || 0,
    totals: body.totals || {},
    csv: gunzipSync(Buffer.from(body.gzB64, "base64")).toString("utf-8"),
  };
}

// 巨大CSVを改行境界のチャンクでSJIS変換して連結(中間配列の肥大を防ぐ)
function toSjis(csv) {
  const chunks = [];
  const TARGET = 500_000;
  let i = 0;
  while (i < csv.length) {
    let end = Math.min(i + TARGET, csv.length);
    if (end < csv.length) { const nl = csv.indexOf("\n", end); end = nl === -1 ? csv.length : nl + 1; }
    chunks.push(Buffer.from(Encoding.convert(Encoding.stringToCode(csv.slice(i, end)), { to: "SJIS", from: "UNICODE" })));
    i = end;
  }
  return Buffer.concat(chunks);
}

async function generateOne(ym, all) {
  const y = ym.slice(0, 4), m = ym.slice(4, 6);
  const { count, totals, csv } = await fetchGzCsv(ym, all);
  const sjis = toSjis(csv);
  const suffix = all ? "_全件" : "";
  const key = `${PREFIX}貸倒対象照合${y}年${m}月${suffix}.csv`;
  const unpaid = (Number(totals["SB未納額"]) || 0) + (Number(totals["口振未納金"]) || 0);
  const balance = Number(totals["最終当月末残高"]) || 0;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: sjis,
    ContentType: "text/csv; charset=Shift_JIS",
    Metadata: {
      basisym: ym, scope: all ? "all" : "unpaid", rows: String(count),
      unpaid: String(unpaid), balance: String(balance), generatedat: new Date().toISOString(),
    },
  }));
  console.log(`[writeoff-reconcile-batch] 基準${ym}${all ? "(全件)" : ""} -> ${key} (${count} rows, 未納¥${unpaid}, ${sjis.length} bytes)`);
  return { ym, all: !!all, count, unpaid, balance, key, bytes: sjis.length };
}

export const handler = async (event = {}) => {
  const months = event && event.ym
    ? [String(event.ym)]
    : recentMonths(new Date(), Math.max(1, Math.min(12, Number(event.months || DEFAULT_MONTHS))));
  const doAll = event && event.all === true; // 貸倒対象(未納>0)は常に生成。all=true で全件版も追加生成。

  const results = [];
  for (const ym of months) {
    if (!/^\d{6}$/.test(ym)) { results.push({ ym, error: "invalid ym" }); continue; }
    try {
      results.push(await generateOne(ym, false));
      if (doAll) results.push(await generateOne(ym, true));
    } catch (e) {
      results.push({ ym, error: e?.message || String(e) });
      console.error(`[writeoff-reconcile-batch] ${ym} failed:`, e?.message || e);
    }
  }
  return { ok: true, months: months.length, results };
};
