// lambdas/points-summary/handler.mjs
// ポイント・ダッシュボード用の夜間事前集計。
// 店舗×月 の指標(付与/使用合計・男女別・年代別・ランク内訳・平均継続ヶ月・取得〜使用期間)を
// CPSS(店舗履歴) + Oracle(性別/生年月日/入会日) から集計し yamauchi-PointSummary に保存する。
//
// event: { clubCodes?: string[], months?: ["2026-06",...], monthsBack?: number(既定13) }
//   clubCodes 省略時は knowbie-clubs 全店(businessType あり)。CPSS未登録店は skip。
//   months 省略時は 直近 monthsBack ヶ月。
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const CPSS_PROXY = process.env.CPSS_PROXY_FUNCTION || "knowbie-cpss-proxy";
let CPSS_ENV = process.env.CPSS_ENV || "prod"; // event.env で1回の実行だけ上書き可
const CLUBS_TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const SUMMARY_TABLE = process.env.SUMMARY_TABLE || "yamauchi-PointSummary";
const MS_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const MS_KEY = process.env.MEMBER_SEARCH_API_KEY || "";
const MAX_PAGES = Number(process.env.MAX_PAGES || 40); // 店舗×月あたりの取得ページ上限 (安全弁)
const LINES = 1000;

const lambda = new LambdaClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const brandForBiz = (b) => (String(b || "").toUpperCase().startsWith("FIT365") ? "FIT365" : "JOYFIT");

// "2026-06" → { sdate, edate(翌月1日), monthEnd(Date), label }
function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const sdate = `${y}${pad(m)}01000000`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const edate = `${ny}${pad(nm)}01000000`;
  const monthEnd = new Date(Date.UTC(ny, nm - 1, 1)); // 翌月1日 = 当月末+1
  return { sdate, edate, monthEnd };
}

async function cpss(brand, action, args) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: CPSS_PROXY, InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({ brand, env: CPSS_ENV, action, args })),
  }));
  const j = JSON.parse(Buffer.from(res.Payload).toString("utf-8"));
  if (res.FunctionError || !j.ok) throw new Error(j?.error || j?.errorMessage || "cpss proxy error");
  return j.result;
}

// 店舗の当月履歴を全ページ取得 (キャンセル除外は呼び出し側で判定)
async function fetchShopHistory(brand, shopid, sdate, edate) {
  const rows = [];
  let page = 1, pages = 1;
  do {
    const r = await cpss(brand, "getHistoryShopTimeSpan", { shopid, sdate, edate, lines: LINES, page, order: "asc" });
    const h = Array.isArray(r?.history) ? r.history : [];
    rows.push(...h);
    pages = Number(r?.pages) || 1;
    page += 1;
  } while (page <= pages && page <= MAX_PAGES);
  return rows;
}

// Oracle: 会員番号リスト → {memberNo: {genderCode, birthday, joinDate}}
async function fetchDemographics(memberNos) {
  const out = new Map();
  if (!MS_BASE || !MS_KEY || memberNos.length === 0) return out;
  for (let i = 0; i < memberNos.length; i += 1000) {
    const chunk = memberNos.slice(i, i + 1000);
    const payload = Buffer.from(JSON.stringify({ memberNos: chunk })).toString("base64");
    const url = `${MS_BASE}/members/search?type=demographics&payload=${encodeURIComponent(payload)}`;
    const res = await fetch(url, { headers: { "x-api-key": MS_KEY } });
    if (!res.ok) { console.error("demographics http", res.status); continue; }
    const j = await res.json();
    for (const r of j.results || []) out.set(String(r.memberNo), r);
  }
  return out;
}

const ageBucket = (age) => {
  if (age == null || age < 0) return "unknown";
  if (age < 10) return "0"; if (age >= 70) return "70";
  return String(Math.floor(age / 10) * 10);
};
function ageAt(birthday, at) {
  if (!birthday) return null;
  const b = new Date(birthday + "T00:00:00Z");
  if (isNaN(b.getTime())) return null;
  let a = at.getUTCFullYear() - b.getUTCFullYear();
  const mo = at.getUTCMonth() - b.getUTCMonth();
  if (mo < 0 || (mo === 0 && at.getUTCDate() < b.getUTCDate())) a -= 1;
  return a;
}
function monthsBetween(from, to) {
  if (!from) return null;
  const f = new Date(from + "T00:00:00Z");
  if (isNaN(f.getTime()) || to < f) return null;
  return (to.getUTCFullYear() - f.getUTCFullYear()) * 12 + (to.getUTCMonth() - f.getUTCMonth());
}

// 1店舗×1月 の集計
async function aggregateOne(clubCode, brand, ym) {
  const { sdate, edate, monthEnd } = monthRange(ym);
  const rows = await fetchShopHistory(brand, clubCode, sdate, edate);

  let granted = 0, used = 0, grantedCount = 0, usedCount = 0;
  const memberSet = new Set();
  const byRank = {};                 // rank -> {granted, used, members:Set}
  const perMember = new Map();       // memberNo -> {granted, used, earns:[ms], uses:[ms]}
  const rankMembers = {};            // rank -> Set(member)

  for (const h of rows) {
    if (h.status === "CAN") continue; // キャンセル除外
    const pt = Number(h.point) || 0;
    const aid = String(h.facing || "").replace(/:USR$/, "");
    if (!aid) continue;
    memberSet.add(aid);
    const pm = perMember.get(aid) || { granted: 0, used: 0, earns: [], uses: [] };
    const eff = Number(h.effective) || Number(h.operate) || 0;
    if (h.direction === "ADD") {
      granted += pt; grantedCount += 1; pm.granted += pt; if (eff) pm.earns.push(eff);
    } else if (h.direction === "SUB") {
      used += pt; usedCount += 1; pm.used += pt; if (eff) pm.uses.push(eff);
    }
    perMember.set(aid, pm);
    const rank = h.rank ? String(h.rank) : null;
    if (rank) {
      byRank[rank] = byRank[rank] || { granted: 0, used: 0 };
      if (h.direction === "ADD") byRank[rank].granted += pt; else if (h.direction === "SUB") byRank[rank].used += pt;
      (rankMembers[rank] = rankMembers[rank] || new Set()).add(aid);
    }
  }

  const members = [...memberSet];
  const demo = await fetchDemographics(members);

  const byGender = { male: { granted: 0, used: 0, members: 0 }, female: { granted: 0, used: 0, members: 0 }, unknown: { granted: 0, used: 0, members: 0 } };
  const byAge = {}; // bucket -> {granted, used, members}
  let tenureSum = 0, tenureN = 0;
  let e2uSum = 0, e2uN = 0;

  for (const aid of members) {
    const pm = perMember.get(aid);
    const d = demo.get(aid);
    // 男女別
    const gkey = d?.genderCode === 1 ? "male" : d?.genderCode === 2 ? "female" : "unknown";
    byGender[gkey].granted += pm.granted; byGender[gkey].used += pm.used; byGender[gkey].members += 1;
    // 年代別
    const bucket = ageBucket(d?.birthday ? ageAt(d.birthday, monthEnd) : null);
    byAge[bucket] = byAge[bucket] || { granted: 0, used: 0, members: 0 };
    byAge[bucket].granted += pm.granted; byAge[bucket].used += pm.used; byAge[bucket].members += 1;
    // 平均継続ヶ月
    const tm = monthsBetween(d?.joinDate, monthEnd);
    if (tm != null) { tenureSum += tm; tenureN += 1; }
    // 取得→使用期間 (当月履歴内 FIFO・近似)
    if (pm.uses.length && pm.earns.length) {
      const earns = [...pm.earns].sort((a, b) => a - b);
      let ei = 0;
      for (const u of [...pm.uses].sort((a, b) => a - b)) {
        while (ei < earns.length && earns[ei] > u) ei += 1;
        if (ei < earns.length) { e2uSum += (u - earns[ei]) / 86400000; e2uN += 1; ei += 1; }
      }
    }
  }

  const rankBreakdown = {};
  for (const [rk, v] of Object.entries(byRank)) rankBreakdown[rk] = { ...v, members: (rankMembers[rk]?.size) || 0 };

  const item = {
    clubCode: String(clubCode),
    yyyymm: ym,
    brand,
    granted, used, grantedCount, usedCount,
    memberCount: members.length,
    byGender, byAge,
    byRank: brand === "FIT365" ? rankBreakdown : {},
    avgTenureMonths: tenureN ? Math.round((tenureSum / tenureN) * 10) / 10 : null,
    avgEarnToUseDays: e2uN ? Math.round((e2uSum / e2uN) * 10) / 10 : null,
    earnToUseSamples: e2uN,
    updatedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: SUMMARY_TABLE, Item: item }));
  return { clubCode, ym, granted, used, members: members.length };
}

async function listClubs() {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: CLUBS_TABLE, ProjectionExpression: "clubCode, businessType", ExclusiveStartKey }));
    for (const it of r.Items || []) if (it.clubCode) out.push({ clubCode: String(it.clubCode), brand: brandForBiz(it.businessType) });
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

function recentMonths(n) {
  const now = new Date();
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    arr.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return arr;
}

export const handler = async (event = {}) => {
  if (event.env === "stg" || event.env === "prod") CPSS_ENV = event.env; // バックフィル用の環境上書き
  const months = Array.isArray(event.months) && event.months.length ? event.months : recentMonths(Number(event.monthsBack) || 13);
  let clubs;
  if (Array.isArray(event.clubCodes) && event.clubCodes.length) {
    const all = await listClubs();
    const map = new Map(all.map((c) => [c.clubCode, c.brand]));
    clubs = event.clubCodes.map((c) => ({ clubCode: String(c), brand: event.brand || map.get(String(c)) || "JOYFIT" }));
  } else {
    clubs = await listClubs();
  }

  const done = [], skipped = [], failed = [];
  for (const { clubCode, brand } of clubs) {
    for (const ym of months) {
      try {
        const r = await aggregateOne(clubCode, brand, ym);
        done.push(r);
      } catch (e) {
        const msg = e?.message || String(e);
        if (/003-001-000|存在しません/.test(msg)) skipped.push({ clubCode, ym }); // CPSS未登録店
        else { console.error("[points-summary]", clubCode, ym, msg); failed.push({ clubCode, ym, error: msg }); }
      }
    }
  }
  const summary = { months: months.length, clubs: clubs.length, done: done.length, skipped: skipped.length, failed: failed.length };
  console.log("[points-summary] done", JSON.stringify(summary));
  return { ok: true, ...summary, failedSample: failed.slice(0, 5) };
};
