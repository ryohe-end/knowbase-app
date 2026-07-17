// lambdas/optionusage-summary/handler.mjs
// オプション都度利用のダッシュボード+AI分析用の夜間事前集計。
// dgtk_sys.ticket(usage='OPTN') を「全店まとめて GROUP BY 一括」で読み、
// 店舗×月 の 件数/店舗収入/売れ筋オプション(ticket_name別)/ブランド別 を集計し
// 自前DDB yamauchi-OptionUsageSummary に保存する。個人情報は保持しない。
// event: { monthsBack?: number(既定13) }
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const SSH_PROXY = process.env.SSH_DB_PROXY_FUNCTION || "knowbie-ssh-db-proxy";
const TARGET = process.env.DGTK_TARGET || "dgtk_sys";
const TABLE = process.env.SUMMARY_TABLE || "yamauchi-OptionUsageSummary";

const lambda = new LambdaClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });

// 購入(支払)日時ベースの月(JST)。payment欠損はcreate。usage='OPTN'・実店舗(sales_club>0)のみ。
const MONTH = "to_char(coalesce(t.ticket_payment_dt, t.ticket_create_dt) at time zone 'Asia/Tokyo','YYYY-MM')";
const WHERE = "t.usage='OPTN' and t.ticket_sales_club > 0 and coalesce(t.ticket_payment_dt, t.ticket_create_dt) >= $1::timestamptz";
// オプション名の全角/半角「1回」ゆらぎを吸収
const NAME = "regexp_replace(coalesce(t.ticket_name,'(不明)'), '（１回）', '（1回）')";

function buildQueries(fromTs) {
  return [
    { text: `select t.ticket_sales_club cc, ${MONTH} ym, count(*) cnt, coalesce(sum(t.club_income),0) income from dgtk_sys.ticket t where ${WHERE} group by 1,2`, params: [fromTs] },
    { text: `select t.ticket_sales_club cc, ${MONTH} ym, ${NAME} name, count(*) cnt, coalesce(sum(t.club_income),0) income from dgtk_sys.ticket t where ${WHERE} group by 1,2,3`, params: [fromTs] },
    { text: `select t.ticket_sales_club cc, ${MONTH} ym, trim(t.brand) brand, count(*) cnt, coalesce(sum(t.club_income),0) income from dgtk_sys.ticket t where ${WHERE} group by 1,2,3`, params: [fromTs] },
  ];
}

function ensure(map, cc, ym) {
  const k = `${cc}|${ym}`;
  if (!map.has(k)) map.set(k, { clubCode: String(cc), yyyymm: ym, count: 0, income: 0, byOption: {}, byBrand: {} });
  return map.get(k);
}
function firstOfMonthTs(n) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00+09:00`;
}

export const handler = async (event = {}) => {
  const monthsBack = Number(event.monthsBack) || 13;
  const fromTs = firstOfMonthTs(monthsBack);
  const res = await lambda.send(new InvokeCommand({
    FunctionName: SSH_PROXY, InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({ target: TARGET, queries: buildQueries(fromTs) })),
  }));
  const j = JSON.parse(Buffer.from(res.Payload).toString("utf-8"));
  if (res.FunctionError || !j.ok) throw new Error(j?.error || j?.errorMessage || "ssh-db-proxy error");
  const [tot, opt, brand] = j.results.map((r) => r.rows);

  const map = new Map();
  for (const r of tot) { const o = ensure(map, r.cc, r.ym); o.count = Number(r.cnt); o.income = Number(r.income); }
  for (const r of opt) { ensure(map, r.cc, r.ym).byOption[String(r.name).trim()] = { count: Number(r.cnt), income: Number(r.income) }; }
  for (const r of brand) { ensure(map, r.cc, r.ym).byBrand[String(r.brand)] = { count: Number(r.cnt), income: Number(r.income) }; }

  const now = new Date().toISOString();
  const items = [...map.values()].filter((o) => o.yyyymm && /^\d{4}-\d{2}$/.test(o.yyyymm)).map((o) => ({ ...o, updatedAt: now }));
  let written = 0;
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })) } }));
    written += chunk.length;
  }
  const out = { ok: true, monthsBack, fromTs, clubMonths: items.length, written };
  console.log("[optionusage-summary]", JSON.stringify(out));
  return out;
};
