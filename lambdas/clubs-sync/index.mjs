// lambdas/clubs-sync/index.mjs
// MotionBoard REST から クラブマスタを取得し DynamoDB knowbie-clubs に upsert し、
// さらに wf_member_app_prod.club__c (PostgreSQL) にも同期する。
//
// 同期スコープ (Plan A: フィールド単位の所有権分離):
//   - MotionBoard SoT: name, brand__c, field1__c → 常に追従
//   - 補完のみ (NULL のときだけ書く): addressit__c (CSクラブ.住所), club_region_sfid__c (住所→都道府県逆引き)
//   - UI 専用 (sync は触らない): フラグ系/緯度経度/メール/マシン/etc.
//
// 起動オプション (event payload):
//   { dryRun: true }      … PostgreSQL への書き込みをスキップ、件数だけ返す
//   { skipPg: true }      … PostgreSQL 連携を完全スキップ (DynamoDB だけ)
//
// 環境変数:
//   MOTIONBOARD_SECRET_ARN     Secrets Manager の ARN (tenant/id/pw)
//   MOTIONBOARD_BOARD_PATH     ボードパス (デフォルトあり)
//   MOTIONBOARD_ITEM_ID        itemId (デフォルト ITEM_1-6)
//   CLUBS_TABLE                DynamoDB テーブル名 (デフォルト knowbie-clubs)
//   CLUBS_TABLE_REGION         DynamoDB リージョン (デフォルト us-east-1)
//   READ_COUNT                 MotionBoard readCount (デフォルト 500)
//   MEMBER_SEARCH_FUNCTION     住所取得用 Lambda 名 (デフォルト knowbie-member-search)
//   MEMBER_SEARCH_REGION       同上のリージョン (デフォルト ap-northeast-1)
//   PG_DATABASE_URL            PostgreSQL 接続文字列。未設定なら既存ハードコード fallback

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import pg from "pg";

const SECRET_ARN  = process.env.MOTIONBOARD_SECRET_ARN;
const BOARD_PATH  = process.env.MOTIONBOARD_BOARD_PATH || "/遠藤さん作成ボードはすべてここに入れてください/クエリア";
const ITEM_ID     = process.env.MOTIONBOARD_ITEM_ID || "ITEM_1-6";
const ITEM_NAME   = process.env.MOTIONBOARD_ITEM_NAME || "クエリア";
const READ_COUNT  = process.env.READ_COUNT || "500";
const TABLE_NAME  = process.env.CLUBS_TABLE || "knowbie-clubs";
const TABLE_REGION = process.env.CLUBS_TABLE_REGION || "us-east-1";
const MEMBER_SEARCH_FN     = process.env.MEMBER_SEARCH_FUNCTION || "knowbie-member-search";
const MEMBER_SEARCH_REGION = process.env.MEMBER_SEARCH_REGION   || "ap-northeast-1";
const PG_CONNECTION = process.env.PG_DATABASE_URL
  || "postgres://wf_member_app_prod:UA5JAaqYeyVGUpD@188.93.146.126:5432/wf_member_app_prod";

const sm  = new SecretsManagerClient({ region: process.env.AWS_REGION || "ap-northeast-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: TABLE_REGION }));
const lambdaClient = new LambdaClient({ region: MEMBER_SEARCH_REGION });

async function fetchClubs() {
  const sec  = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  const cred = JSON.parse(sec.SecretString);

  const url = new URL("https://cloud-up.motionboard.jp/motionboard/rest/item/get/json");
  url.searchParams.set("tenant", cred.tenant);
  url.searchParams.set("id", cred.id);
  url.searchParams.set("pw", cred.pw);
  url.searchParams.set("boardPath", BOARD_PATH);
  url.searchParams.set("itemId", ITEM_ID);
  url.searchParams.set("encoding", "UTF-8");
  url.searchParams.set("lc", "ja");
  url.searchParams.set("useSummaryForm", "false");
  url.searchParams.set("jsonFormat", "object");
  url.searchParams.set("itemName", ITEM_NAME);
  url.searchParams.set("readCount", READ_COUNT);

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MotionBoard ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`unexpected response shape: ${typeof data}`);
  }
  return data;
}

// "2015/11/15" -> "2015-11-15"。空/None は null。想定外フォーマットは生のまま。
function fmtDate(v) {
  if (!v || v === "None") return null;
  const m = String(v).trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return String(v).trim();
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function toItem(row, nowIso) {
  const clubCode = String(row["クラブコード"] ?? "").trim();
  if (!clubCode) return null;
  return {
    clubCode,
    clubName:      row["クラブ名"]       ?? null,
    clubNameShort: row["クラブ略称"]     ?? null,
    companyGroup:  row["カンパニー名"]   ?? null,
    companyName:   row["企業名"]         ?? null,
    businessType:  row["業態"]           ?? null,
    openDate:      fmtDate(row["オープン日"]),
    syncedAt:      nowIso,
  };
}

async function upsertAll(items) {
  // BatchWriteItem は 25件/回。Lambda の Node18+ では Promise.all で並列も可。
  const CHUNK = 25;
  let wrote = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = items.slice(i, i + CHUNK).map((it) => ({ PutRequest: { Item: it } }));
    let unprocessed = batch;
    for (let attempt = 0; attempt < 5 && unprocessed.length > 0; attempt++) {
      const res = await ddb.send(
        new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: unprocessed } })
      );
      const next = res.UnprocessedItems?.[TABLE_NAME] || [];
      wrote += unprocessed.length - next.length;
      unprocessed = next;
      if (unprocessed.length) {
        // 指数バックオフで再試行
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }
    if (unprocessed.length > 0) {
      throw new Error(`UnprocessedItems remain: ${unprocessed.length}`);
    }
  }
  return wrote;
}

// --- PostgreSQL 連携 ---------------------------------------------------------
// 業態 (グレード) → ブランドの変換ルール (Plan A 確定):
//   赤系 (赤, 赤LITE, 赤SP, 赤SP LITE, 赤GH) → JOYFIT24
//   青系 (青, 青LITE, 青GH)                 → JOYFIT
//   緑                                      → JOYFIT YOGA
//   JOYFIT+ / FIT365                        → そのまま
//   その他                                  → そのまま (将来追加の業態を破壊しないため)
function gradeToBrand(grade) {
  if (grade == null) return null;
  const s = String(grade).trim();
  if (s === "") return null;
  if (s === "緑") return "JOYFIT YOGA";
  if (s.startsWith("赤")) return "JOYFIT24";
  if (s.startsWith("青")) return "JOYFIT";
  return s; // JOYFIT+, FIT365, メディカル 等
}

// 住所先頭から都道府県を抽出 ("埼玉県..." → "埼玉県")
function extractPrefecture(address) {
  if (!address) return null;
  const m = String(address).match(/^(.{2,3}[都道府県])/);
  return m ? m[1] : null;
}

function normalize(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function fetchAddressesFromOracle() {
  const res = await lambdaClient.send(new InvokeCommand({
    FunctionName: MEMBER_SEARCH_FN,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({
      queryStringParameters: { type: "club_addresses" },
    })),
  }));
  const payload = JSON.parse(Buffer.from(res.Payload).toString("utf-8"));
  if (payload.statusCode !== 200) {
    throw new Error(`member-search club_addresses returned ${payload.statusCode}: ${payload.body}`);
  }
  const body = JSON.parse(payload.body);
  const map = new Map(); // clubCode -> address
  for (const a of body.addresses || []) {
    if (a.clubCode && a.address) map.set(String(a.clubCode), String(a.address).trim());
  }
  return map;
}

async function syncToPostgres(motionboardItems, addressByCode, { dryRun }) {
  const pool = new pg.Pool({
    connectionString: PG_CONNECTION,
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 5000,
  });
  const result = { inserted: 0, updated: 0, skipped: 0, failed: 0, samples: { insert: [], update: [] } };
  try {
    // active な club__c を取得。
    // 注意: 旧データに isdeleted=NULL の宙ぶらりん行が混じっているため、
    // COALESCE(isdeleted, false) = false で NULL も active 扱いにする。
    // (isdeleted=false 限定にすると同 clubCode で重複 INSERT が発生する)
    const existing = await pool.query(`
      SELECT club_code__c, name, brand__c, field1__c, addressit__c, club_region_sfid__c
        FROM club__c
       WHERE COALESCE(isdeleted, false) = false
         AND club_code__c IS NOT NULL AND club_code__c != ''`);
    const byCode = new Map();
    for (const r of existing.rows) byCode.set(String(r.club_code__c), r);

    // 都道府県マスタ (name → sfid)
    const regionRows = await pool.query(`SELECT name, sfid FROM club_region__c WHERE isdeleted=false`);
    const regionByName = new Map();
    for (const r of regionRows.rows) if (r.name && r.sfid) regionByName.set(r.name, r.sfid);

    for (const mb of motionboardItems) {
      const code = String(mb.clubCode);
      const name = normalize(mb.clubName);
      const grade = normalize(mb.businessType);
      const brand = gradeToBrand(grade);
      const cur = byCode.get(code);

      if (!cur) {
        // 新規 INSERT
        const csAddress = normalize(addressByCode.get(code));
        const regionSfid = csAddress ? (regionByName.get(extractPrefecture(csAddress)) ?? null) : null;
        result.samples.insert.push({ code, name, brand, grade, addressit__c: csAddress, region_sfid: regionSfid });
        if (dryRun) { result.inserted++; continue; }
        try {
          await pool.query(
            `INSERT INTO club__c
               (club_code__c, name, brand__c, field1__c, addressit__c, club_region_sfid__c, isdeleted)
             VALUES ($1, $2, $3, $4, $5, $6, false)`,
            [code, name ?? "", brand, grade, csAddress, regionSfid]
          );
          result.inserted++;
        } catch (e) {
          console.error(`[clubs-sync] INSERT failed for ${code}: ${e.message}`);
          result.failed++;
        }
        continue;
      }

      // 既存行: name / brand__c / field1__c は常時追従、addressit__c / region は NULL 補完のみ
      const updates = [];
      const values = [];
      let idx = 1;
      if (normalize(cur.name) !== name) {
        updates.push(`name = $${++idx}`); values.push(name ?? "");
      }
      if (normalize(cur.brand__c) !== brand) {
        updates.push(`brand__c = $${++idx}`); values.push(brand);
      }
      if (normalize(cur.field1__c) !== grade) {
        updates.push(`field1__c = $${++idx}`); values.push(grade);
      }
      // 補完: addressit__c が NULL なら CSクラブ.住所 で埋める
      if (cur.addressit__c == null) {
        const csAddress = normalize(addressByCode.get(code));
        if (csAddress) {
          updates.push(`addressit__c = $${++idx}`); values.push(csAddress);
        }
      }
      // 補完: club_region_sfid__c が NULL なら現在の addressit__c から推測
      // (UPDATE 中に addressit__c が新規に入る場合も同じ値で region を埋める)
      if (cur.club_region_sfid__c == null) {
        const addr = cur.addressit__c ?? normalize(addressByCode.get(code));
        const pref = extractPrefecture(addr);
        const sfid = pref ? regionByName.get(pref) : null;
        if (sfid) {
          updates.push(`club_region_sfid__c = $${++idx}`); values.push(sfid);
        }
      }

      if (updates.length === 0) { result.skipped++; continue; }
      updates.push(`lastupdateddate = NOW()`);
      // dry-run 時は変更の意味を分かるように記録 (column 名と新旧両方)
      if (dryRun) {
        const diffs = [];
        if (normalize(cur.name) !== name) diffs.push({ col: 'name', from: cur.name, to: name });
        if (normalize(cur.brand__c) !== brand) diffs.push({ col: 'brand__c', from: cur.brand__c, to: brand });
        if (normalize(cur.field1__c) !== grade) diffs.push({ col: 'field1__c', from: cur.field1__c, to: grade });
        if (cur.addressit__c == null && normalize(addressByCode.get(code))) diffs.push({ col: 'addressit__c', from: null, to: normalize(addressByCode.get(code)) });
        if (cur.club_region_sfid__c == null) {
          const addr = cur.addressit__c ?? normalize(addressByCode.get(code));
          const pref = extractPrefecture(addr);
          const sfid = pref ? regionByName.get(pref) : null;
          if (sfid) diffs.push({ col: 'club_region_sfid__c', from: null, to: `${sfid} (${pref})` });
        }
        result.samples.update.push({ code, diffs });
      }
      if (dryRun) { result.updated++; continue; }
      try {
        // $1 = club_code__c (WHERE 用)
        const sql = `UPDATE club__c SET ${updates.join(", ")} WHERE club_code__c = $1 AND isdeleted = false`;
        await pool.query(sql, [code, ...values]);
        result.updated++;
      } catch (e) {
        console.error(`[clubs-sync] UPDATE failed for ${code}: ${e.message}`);
        result.failed++;
      }
    }
  } finally {
    await pool.end();
  }
  return result;
}

export const handler = async (event) => {
  const dryRun = event?.dryRun === true;
  const skipPg = event?.skipPg === true;
  const nowIso = new Date().toISOString();
  console.log(`[clubs-sync] start (table=${TABLE_NAME}, region=${TABLE_REGION}, itemId=${ITEM_ID}, dryRun=${dryRun}, skipPg=${skipPg})`);

  const rows = await fetchClubs();
  console.log(`[clubs-sync] fetched ${rows.length} rows from MotionBoard`);

  const items = rows.map((r) => toItem(r, nowIso)).filter(Boolean);
  console.log(`[clubs-sync] normalized ${items.length} items (dropped ${rows.length - items.length})`);

  const wrote = await upsertAll(items);
  console.log(`[clubs-sync] upserted ${wrote} items to DynamoDB`);

  let pgResult = null;
  if (!skipPg) {
    try {
      const addressByCode = await fetchAddressesFromOracle();
      console.log(`[clubs-sync] fetched ${addressByCode.size} addresses from Oracle CSクラブ`);
      pgResult = await syncToPostgres(items, addressByCode, { dryRun });
      console.log(`[clubs-sync] PostgreSQL ${dryRun ? "DRY-RUN" : "sync"}: ${JSON.stringify(pgResult)}`);
    } catch (e) {
      console.error(`[clubs-sync] PostgreSQL sync failed: ${e.message}`);
      pgResult = { error: e.message };
    }
  }

  return {
    ok: true,
    fetched: rows.length,
    normalized: items.length,
    wrote,
    pg: pgResult,
    dryRun,
    skipPg,
    syncedAt: nowIso,
    itemId: ITEM_ID,
  };
};
