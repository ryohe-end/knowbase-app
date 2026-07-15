// lambdas/onetimepass-summary/handler.mjs
// 1day/OneTimePass ダッシュボード + AI料金提案 用の夜間事前集計。
// EnjoyTimePass(t1pass) の ticket_tbl/user_tbl を「全店まとめて GROUP BY 一括」で読み、
// 店舗×月 の需要指標(件数/売上/利用時間別/時間帯別/曜日別/男女別/年代別/新規)を
// 自前DDB yamauchi-OneTimePassSummary に保存する。個人情報(PII)は保持しない。
//
// あちらの本番DBへは「1接続・数本のGROUP BYスキャン」で済む(踏み台SSHも1本)。
// event: { monthsBack?: number(既定13) }
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const SSH_PROXY = process.env.SSH_DB_PROXY_FUNCTION || "knowbie-ssh-db-proxy";
const TARGET = process.env.OTP_TARGET || "onetimepass";
const TABLE = process.env.SUMMARY_TABLE || "yamauchi-OneTimePassSummary";

const lambda = new LambdaClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// JST基準の月/時/曜日。edate非包含。fromは YYYY-MM-01。
const MONTH = "to_char(t.insert_dt at time zone 'Asia/Tokyo','YYYY-MM')";
const AGE_BUCKET = `case when u.birthday ~ '^[0-9]{8}$' and substr(u.birthday,1,4) ~ '^(19|20)[0-9]{2}$'
  then least(70,(floor((date_part('year', now()) - substr(u.birthday,1,4)::int)/10)*10)::int) else -1 end`;

function buildQueries(fromDate) {
  const w = `t.insert_dt >= $1::date`;
  const J = "left join t1pass.user_tbl u on u.access_key = t.access_key";
  return [
    { text: `select t.club_cd cc, ${MONTH} ym, count(*) cnt, coalesce(sum(t.amount),0) sales, count(distinct t.access_key) uniq from t1pass.ticket_tbl t where ${w} group by 1,2`, params: [fromDate] },
    { text: `select t.club_cd cc, ${MONTH} ym, t.max_hour dur, count(*) cnt, coalesce(sum(t.amount),0) sales from t1pass.ticket_tbl t where ${w} group by 1,2,3`, params: [fromDate] },
    { text: `select t.club_cd cc, ${MONTH} ym, extract(hour from t.insert_dt at time zone 'Asia/Tokyo')::int hr, count(*) cnt from t1pass.ticket_tbl t where ${w} group by 1,2,3`, params: [fromDate] },
    { text: `select t.club_cd cc, ${MONTH} ym, extract(dow from t.insert_dt at time zone 'Asia/Tokyo')::int dow, count(*) cnt from t1pass.ticket_tbl t where ${w} group by 1,2,3`, params: [fromDate] },
    { text: `select t.club_cd cc, ${MONTH} ym, u.sex sex, count(*) cnt, coalesce(sum(t.amount),0) sales from t1pass.ticket_tbl t ${J} where ${w} group by 1,2,3`, params: [fromDate] },
    { text: `select t.club_cd cc, ${MONTH} ym, ${AGE_BUCKET} ab, count(*) cnt from t1pass.ticket_tbl t ${J} where ${w} group by 1,2,3`, params: [fromDate] },
    // 新規: 会員の初回購入(全期間min)が当月に入るもの
    { text: `with firsts as (select access_key, min(insert_dt) fdt, (array_agg(club_cd order by insert_dt asc))[1] cc from t1pass.ticket_tbl group by access_key)
             select cc, to_char(fdt at time zone 'Asia/Tokyo','YYYY-MM') ym, count(*) newc from firsts where fdt >= $1::date group by 1,2`, params: [fromDate] },
  ];
}

function key(cc, ym) { return `${cc}|${ym}`; }
function ensure(map, cc, ym) {
  const k = key(cc, ym);
  if (!map.has(k)) map.set(k, {
    clubCode: String(cc), yyyymm: ym, count: 0, sales: 0, uniqueCustomers: 0, newCustomers: 0,
    byDuration: {}, byHour: {}, byDayOfWeek: {}, byGender: { male: { count: 0, sales: 0 }, female: { count: 0, sales: 0 }, unknown: { count: 0, sales: 0 } }, byAge: {},
  });
  return map.get(k);
}

function recentMonthsFrom(n) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export const handler = async (event = {}) => {
  const monthsBack = Number(event.monthsBack) || 13;
  const fromDate = recentMonthsFrom(monthsBack);

  const res = await lambda.send(new InvokeCommand({
    FunctionName: SSH_PROXY, InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({ target: TARGET, queries: buildQueries(fromDate) })),
  }));
  const j = JSON.parse(Buffer.from(res.Payload).toString("utf-8"));
  if (res.FunctionError || !j.ok) throw new Error(j?.error || j?.errorMessage || "ssh-db-proxy error");
  const [tot, dur, hour, dow, gender, age, news] = j.results.map((r) => r.rows);

  const map = new Map();
  for (const r of tot) { const o = ensure(map, r.cc, r.ym); o.count = Number(r.cnt); o.sales = Number(r.sales); o.uniqueCustomers = Number(r.uniq); }
  for (const r of dur) { ensure(map, r.cc, r.ym).byDuration[String(r.dur)] = { count: Number(r.cnt), sales: Number(r.sales) }; }
  for (const r of hour) { ensure(map, r.cc, r.ym).byHour[String(r.hr)] = Number(r.cnt); }
  for (const r of dow) { ensure(map, r.cc, r.ym).byDayOfWeek[String(r.dow)] = Number(r.cnt); }
  for (const r of gender) { const o = ensure(map, r.cc, r.ym); const g = r.sex === "1" ? "male" : r.sex === "2" ? "female" : "unknown"; o.byGender[g] = { count: Number(r.cnt), sales: Number(r.sales) }; }
  for (const r of age) { ensure(map, r.cc, r.ym).byAge[String(r.ab)] = Number(r.cnt); }
  for (const r of news) { ensure(map, r.cc, r.ym).newCustomers = Number(r.newc); }

  const now = new Date().toISOString();
  const items = [...map.values()].map((o) => ({ ...o, updatedAt: now }));

  // BatchWrite (25件ずつ)
  let written = 0;
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })) } }));
    written += chunk.length;
  }
  const out = { ok: true, monthsBack, fromDate, clubMonths: items.length, written };
  console.log("[onetimepass-summary]", JSON.stringify(out));
  return out;
};
