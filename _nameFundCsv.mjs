// CPSS原資エクスポート(店舗単位)に クラブ名/企業名/残高 を付与。
// 入力: SummaryFund_WELLNESSOPE(FIT365, UTF-8/タブ), SummaryFundFlow_YAMAUCHIOPE(JOYFIT, Shift_JIS/カンマ)
//  ※データ行はASCIIなので latin1 で読めばヘッダ(日本語)を無視して安全にパースできる。
// 出力: 同ディレクトリに *_named.csv (UTF-8 BOM)。店舗ごとに issue + adjustment を合算。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { readFileSync, writeFileSync } from "node:fs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

// クラブ辞書
const clubItems = [];
{
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: "knowbie-clubs", ProjectionExpression: "clubCode, clubName, clubNameShort, companyName, companyGroup, businessType", ExclusiveStartKey }));
    clubItems.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}
const clubBy = new Map();
for (const c of clubItems) clubBy.set(String(c.clubCode), {
  clubName: c.clubName || c.clubNameShort || "", companyName: c.companyName || "", companyGroup: c.companyGroup || "", brand: c.businessType || "",
});

const DESK = `${process.env.HOME}/Downloads`;
const FILES = [
  { in: "SummaryFund_WELLNESSOPE-260807-125111-437.csv", out: "SummaryFund_WELLNESSOPE_named.csv", delim: "\t", brand: "FIT365" },
  { in: "SummaryFundFlow_YAMAUCHIOPE-260807-124822-343.csv", out: "SummaryFundFlow_YAMAUCHIOPE_named.csv", delim: ",", brand: "JOYFIT" },
];

const N = (v) => { const n = Number(String(v).replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

for (const F of FILES) {
  const raw = readFileSync(`${DESK}/${F.in}`, "latin1"); // データ行はASCII。日本語ヘッダは読み飛ばす。
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
  const byClub = new Map(); // clubCode -> {issued, issuedCount, consumed, expired}
  let unmatched = 0;
  for (let i = 1; i < lines.length; i++) { // 1行目=ヘッダ
    const cols = lines[i].split(F.delim);
    const id = (cols[0] || "").trim();
    const m = id.match(/^shop_(\d+)_/);
    if (!m) continue;
    const clubCode = String(Number(m[1])); // 000225 -> 225
    const issued = N(cols[1]), issuedCount = N(cols[2]), consumed = N(cols[3]), expired = N(cols[4]);
    const r = byClub.get(clubCode) || { issued: 0, issuedCount: 0, consumed: 0, expired: 0 };
    r.issued += issued; r.issuedCount += issuedCount; r.consumed += consumed; r.expired += expired;
    byClub.set(clubCode, r);
  }

  const rows = [];
  for (const [clubCode, r] of byClub) {
    const c = clubBy.get(clubCode);
    if (!c) unmatched++;
    const balance = r.issued - r.consumed - r.expired;
    rows.push({
      clubCode,
      clubName: c?.clubName || "(未登録)",
      companyName: c?.companyName || "(未登録)",
      brand: c?.brand || F.brand,
      issued: r.issued, issuedCount: r.issuedCount, consumed: r.consumed, expired: r.expired, balance,
    });
  }
  rows.sort((a, b) => b.balance - a.balance || Number(a.clubCode) - Number(b.clubCode));

  const t = rows.reduce((a, r) => { a.issued += r.issued; a.issuedCount += r.issuedCount; a.consumed += r.consumed; a.expired += r.expired; a.balance += r.balance; return a; }, { issued: 0, issuedCount: 0, consumed: 0, expired: 0, balance: 0 });

  const header = ["店舗コード", "クラブ名", "企業名", "ブランド", "取得(発行)", "発行件数", "使用(消費)", "失効", "残高"];
  const out = [header];
  for (const r of rows) out.push([r.clubCode, r.clubName, r.companyName, r.brand, r.issued, r.issuedCount, r.consumed, r.expired, r.balance]);
  out.push(["合計", "", "", "", t.issued, t.issuedCount, t.consumed, t.expired, t.balance]);
  const csv = "﻿" + out.map((row) => row.map(esc).join(",")).join("\r\n");
  writeFileSync(`${DESK}/${F.out}`, csv);
  console.log(JSON.stringify({ file: F.out, brand: F.brand, 店舗数: rows.length, 未登録: unmatched, 合計残高: t.balance }, null, 0));
}
