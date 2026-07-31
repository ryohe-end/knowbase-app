// knowbie-writeoff-batch
//
// 貸倒処理(経理連携)CSVを事前生成する月次バッチ (EventBridge 毎月1日想定)。
//   - 直近 MONTHS(既定3) ヶ月分を毎回再生成 (確定後の値も翌月以降の実行で自動反映)
//   - 各月: member-search(writeoff_summary gzip)を invoke → 解凍 → Shift-JIS 変換 →
//     S3 に「貸倒YYYY年MM月.csv」で保存
//   - 画面はこの事前生成ファイルをS3から直接DL(Amplify経由の生成タイムアウトを回避)
//
// 環境変数: MEMBER_SEARCH_FUNCTION(既定 knowbie-member-search),
//           MEMBER_SEARCH_REGION(既定 ap-northeast-1),
//           EXPORT_BUCKET(既定 knowbie-accounting-exports), EXPORT_PREFIX(既定 writeoff/),
//           MONTHS(既定 3), AWS_REGION
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";
import Encoding from "encoding-japanese";

const MEMBER_SEARCH_FN = process.env.MEMBER_SEARCH_FUNCTION || "knowbie-member-search";
const MEMBER_SEARCH_REGION = process.env.MEMBER_SEARCH_REGION || "ap-northeast-1";
const BUCKET = process.env.EXPORT_BUCKET || "knowbie-accounting-exports";
const PREFIX = process.env.EXPORT_PREFIX || "writeoff/";
const MONTHS = Math.max(1, Math.min(12, Number(process.env.MONTHS || 3)));

const lambda = new LambdaClient({ region: MEMBER_SEARCH_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

// 対象月(処理月): 当月から直近 n ヶ月 の {y, m}
function targetMonths(now, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
  }
  return out;
}

// 対象月 → 貸倒の対応年月(会員入金歴.対応年月) = 対象月の1年1ヶ月前(13ヶ月前)
function taioYm(y, m) {
  const d = new Date(y, m - 1 - 13, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 貸倒は未納(入金区分4)のみ。入金完了(区分3)は不要のため includePaid は付けない。
async function fetchGzCsv(ym) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: MEMBER_SEARCH_FN, InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({ queryStringParameters: { type: "writeoff_summary", ym, gzip: "1" } })),
  }));
  if (res.FunctionError) throw new Error("member-search: " + res.FunctionError);
  const payload = res.Payload ? Buffer.from(res.Payload).toString("utf-8") : "{}";
  const outer = JSON.parse(payload);
  const body = typeof outer.body === "string" ? JSON.parse(outer.body) : outer;
  if (!body || body.error || !body.gzB64) throw new Error(body?.message || body?.error || "no gzB64");
  return { count: body.count || 0, csv: gunzipSync(Buffer.from(body.gzB64, "base64")).toString("utf-8") };
}

// CSVの最終列(請求額合計)を合計する。最終列は非引用の数値なので最後のカンマ以降を読む。
function sumAmount(csv) {
  let sum = 0;
  const lines = csv.split("\r\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const v = Number(line.slice(line.lastIndexOf(",") + 1));
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
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

export const handler = async () => {
  // 対象月(処理月)ごとに、対応年月 = 対象月-13ヶ月 の未納を生成。ファイル名は対象月。
  const months = targetMonths(new Date(), MONTHS);
  const results = [];
  for (const { y, m } of months) {
    const targetYm = `${y}${String(m).padStart(2, "0")}`; // 対象月(ファイル名)
    const dataYm = taioYm(y, m);                          // 対応年月(データ)
    try {
      const { count, csv } = await fetchGzCsv(dataYm);
      const amount = sumAmount(csv);
      const sjis = toSjis(csv);
      const key = `${PREFIX}貸倒${y}年${String(m).padStart(2, "0")}月.csv`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: sjis,
        ContentType: "text/csv; charset=Shift_JIS",
        Metadata: { targetym: targetYm, dataym: dataYm, rows: String(count), amount: String(amount), generatedat: new Date().toISOString() },
      }));
      results.push({ targetYm, dataYm, count, amount, key, bytes: sjis.length });
      console.log(`[writeoff-batch] 対象${targetYm}(対応${dataYm}) -> ${key} (${count} rows, ${sjis.length} bytes)`);
    } catch (e) {
      results.push({ targetYm, dataYm, error: e?.message || String(e) });
      console.error(`[writeoff-batch] ${targetYm} failed:`, e?.message || e);
    }
  }
  return { ok: true, months: months.length, results };
};
