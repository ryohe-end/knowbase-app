// knowbie-snowflake-export
//
// クラブ(knowbie-clubs) と 1day/OneTimePass 利用データを Snowflake 連携用に S3 へ出力する
// 夜間バッチ(EventBridge日次)。詳細は docs/snowflake-export/README.md / spec を参照。
//
//   A クラブ        : DynamoDB knowbie-clubs を Scan → 全件 NDJSON(洗い替え)
//   B 1day          : ssh-db-proxy(fit365entry / ecojoy) one_day_ticket を insert_date 差分
//   C OneTimePass   : ssh-db-proxy(onetimepass) t1pass.ticket_tbl を insert_dt 差分
//   出力            : s3://$EXPORT_BUCKET/<source>/dt=YYYY-MM-DD/part-*.ndjson.gz
//   差分状態        : DynamoDB $STATE_TABLE (source→lastHighWater)
//
// 環境変数: EXPORT_BUCKET, SSH_DB_PROXY_FN(=knowbie-ssh-db-proxy), CLUBS_TABLE(=knowbie-clubs),
//           STATE_TABLE(=knowbie-snowflake-export-state), AWS_REGION
// 手動再実行: event.date='YYYY-MM-DD' を渡すと出力パーティションをその日付にできる。
import { gzipSync } from "node:zlib";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.EXPORT_BUCKET || "knowbie-snowflake-export";
const PROXY_FN = process.env.SSH_DB_PROXY_FN || "knowbie-ssh-db-proxy";
const CLUBS_TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const CLUB_AREAS_TABLE = process.env.CLUB_AREAS_TABLE || "knowbie-club-areas";
const RECESS_TABLE = process.env.RECESS_TABLE || "knowbie-recess-roster";
const STATE_TABLE = process.env.STATE_TABLE || "knowbie-snowflake-export-state";

const lambda = new LambdaClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });

function jstDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
const ndjson = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

let __partSeq = 0;
async function putNdjson(source, dt, rows) {
  if (rows.length === 0) return { source, count: 0, key: null };
  // source の '#' は S3接頭辞では '/' に正規化。oneday#fit365→oneday/fit365, option#dgtk→option/dgtk
  // これで Snowpipe(接頭辞 oneday/ , option/)に前方一致する(onetimepass/clubs/recess は '#' 無しで不変)。
  const prefix = source.replace("#", "/");
  const key = `${prefix}/dt=${dt}/part-${Date.now()}-${__partSeq++}.ndjson.gz`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: gzipSync(Buffer.from(ndjson(rows), "utf8")),
    ContentType: "application/x-ndjson", ContentEncoding: "gzip",
  }));
  return { source, count: rows.length, key };
}

async function proxy(target, text, params = [], retries = 4) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await lambda.send(new InvokeCommand({ FunctionName: PROXY_FN, Payload: Buffer.from(JSON.stringify({ target, text, params })) }));
      const j = JSON.parse(Buffer.from(res.Payload).toString("utf8"));
      if (!j.ok) throw new Error(j.error || ("ssh-db-proxy: " + JSON.stringify(j).slice(0, 200)));
      return j.rows || [];
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));  // 指数的バックオフで再試行
    }
  }
  throw lastErr;
}

async function getHighWater(source) {
  const r = await ddb.send(new GetCommand({ TableName: STATE_TABLE, Key: { source } }));
  return r.Item?.lastHighWater ?? null;
}
async function setHighWater(source, value, count) {
  if (value == null) return;
  await ddb.send(new PutCommand({ TableName: STATE_TABLE, Item: { source, lastHighWater: String(value), count, updatedAt: new Date().toISOString() } }));
}

// 課別エリア/テリトリー(knowbie-club-areas)を clubCode -> {area, block, territory} に逆引き。
// area直下(territory="")→テリトリーで上書き、の順(SSR側 lib/clubAreas と同一ロジック)。
// 読めない/空なら {} を返し、クラブ出力は従来どおり(エリア列なし)続行する。
async function loadClubAreaLookup() {
  const map = {};
  try {
    const rows = [];
    let ek;
    do {
      const r = await ddb.send(new ScanCommand({ TableName: CLUB_AREAS_TABLE, ExclusiveStartKey: ek }));
      for (const it of r.Items || []) rows.push(it);
      ek = r.LastEvaluatedKey;
    } while (ek);
    for (const a of rows) {
      for (const code of a.clubCodes || []) {
        const k = String(code);
        if (!map[k]) map[k] = { area: a.area || "", block: a.block || "", territory: "" };
      }
      for (const t of a.territories || []) {
        for (const code of t.clubCodes || []) {
          map[String(code)] = { area: a.area || "", block: a.block || "", territory: t.territory || "" };
        }
      }
    }
  } catch (e) {
    console.warn("[snowflake-export] club-areas read failed, exporting clubs without area:", e?.message || e);
  }
  return map;
}

// A) クラブ: 全件洗い替え (Snowflake側は MERGE / TRUNCATE+COPY)。
//    課別エリア/テリトリー(area/block/territory)を join して付与する。
async function exportClubs(dt) {
  const rows = [];
  let ek;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: CLUBS_TABLE, ExclusiveStartKey: ek }));
    for (const it of r.Items || []) rows.push(it);
    ek = r.LastEvaluatedKey;
  } while (ek);
  const areaLookup = await loadClubAreaLookup();
  const now = new Date().toISOString();
  return putNdjson("clubs", dt, rows.map((c) => {
    const a = areaLookup[String(c.clubCode)] || { area: "", block: "", territory: "" };
    return { ...c, area: a.area, area_block: a.block, territory: a.territory, _exported_at: now };
  }));
}

// B) 1day: insert_date(char8)+insert_time で複合カーソルページング。1DayPassは fit365entry のみ
//    (ecojoy には one_day_ticket が無い)。Lambda応答6MB制限のため LIMIT 4000 でループ。
const ONEDAY_LIMIT = 8000;    // 応答6MB制限内(約2.4MB)に収める
const BATCH_SLEEP_MS = 2500;  // バッチ間の待機。踏み台sshd(MaxStartups)の連続接続を緩和
// ローリングウィンドウ: 日時が付かない状態変化(OTP取消D / 1day期限切is_expired・削除del_flg)を担保するため
//   直近N日にinsertされた行を毎晩再取得する(短命チケットなのでN=30日で概ねカバー)。高水位は動かさない。
const ROLLING_DAYS = Number(process.env.ROLLING_DAYS || 30);
const lookbackYmd = (days) => { const d = new Date(Date.now() + 9 * 3600e3 - days * 86400e3); const p = (n) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`; }; // char8 JST
const lookbackIso = (days) => new Date(Date.now() - days * 86400e3).toISOString();
async function exportOneday(dt) {
  const results = [];
  // 更新日時カーソル _upd = 挿入(insert_date+time) と 使用(use_date+time) の最大(char14 YYYYMMDDHHMMSS)。
  //   消し込み(use_date/use_timeセット)も差分で再取得できる。※期限切(is_expired)/削除(del_flg)はフラグのみで
  //   日時が無いため差分では拾えない→ローリングウィンドウで担保(後述)。
  const INS_1DAY = `CONCAT(t.insert_date, LPAD(COALESCE(NULLIF(t.insert_time,''),'0'),6,'0'))`;   // 挿入 char14
  const UPD_1DAY = `GREATEST(${INS_1DAY},
        CONCAT(COALESCE(NULLIF(t.use_date,''),'00000000'), LPAD(COALESCE(NULLIF(t.use_time,''),'0'),6,'0')))`; // 挿入 vs 使用 の最大
  // 金額: 店舗の1day価格を各チケットに相乗せ。base_price=定価(one_day_shop_price_classification)、
  //   cp_price=購入日に有効だったキャンペーン価格(one_day_cp_price)。単価=COALESCE(cp,base)。
  const COLS = `t.token, t.serial_number, t.uuid, t.shop_id, spv.casio_shop_id, t.member_no, t.cmember_no,
                t.use_date, t.use_time, t.purchase_date, t.purchase_time, t.expiration_date, t.expiration_time,
                t.is_expired, t.payment_flg, t.del_flg, t.insert_date, t.insert_time,
                cl.price AS base_price,
                (SELECT cp.price FROM one_day_cp_price cp
                   WHERE cp.shop_id = t.shop_id AND cp.delete_flg = 0
                     AND cp.cp_start_date <= t.purchase_date AND cp.cp_end_date >= t.purchase_date
                   ORDER BY cp.seq DESC LIMIT 1) AS cp_price`;
  const FROM = `FROM one_day_ticket t
                LEFT JOIN shop_convert_view spv ON spv.town_shop_id = t.shop_id
                LEFT JOIN one_day_shop_price_classification cl ON cl.shop_id = t.shop_id`;
  for (const [brand, target] of [["fit365", "fit365entry"]]) {
    const source = `oneday#${brand}`;
    const emit = (rows, key) => putNdjson(source, dt, rows.map((r) => { const { [key]: _drop, ...rest } = r; return { ...rest, brand }; }));
    // (1) 差分パス: 更新日時 _upd > 前回高水位。新規＋使用(消し込み)を取得し高水位を前進。
    let cur = (await getHighWater(source)) || "00000000000000";
    let maxHw = cur, got = 0;
    while (true) {
      const rows = await proxy(target,
        `SELECT ${COLS}, ${UPD_1DAY} AS _upd ${FROM} WHERE ${UPD_1DAY} > ? ORDER BY _upd LIMIT ${ONEDAY_LIMIT}`, [cur]);
      if (rows.length === 0) break;
      await emit(rows, "_upd");
      cur = String(rows[rows.length - 1]._upd); if (cur > maxHw) maxHw = cur;
      got += rows.length;
      if (rows.length < ONEDAY_LIMIT) break;
      await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
    }
    await setHighWater(source, maxHw, got);
    // (2) ローリングパス: 直近N日にinsertされた行を再取得(期限切/削除フラグ変化を担保)。高水位は動かさない。
    const lb = lookbackYmd(ROLLING_DAYS);
    let insCur = lb + "000000", rgot = 0;
    while (true) {
      const rows = await proxy(target,
        `SELECT ${COLS}, ${INS_1DAY} AS _ins ${FROM} WHERE t.insert_date >= ? AND ${INS_1DAY} > ? ORDER BY _ins LIMIT ${ONEDAY_LIMIT}`,
        [lb, insCur]);
      if (rows.length === 0) break;
      await emit(rows, "_ins");
      insCur = String(rows[rows.length - 1]._ins); rgot += rows.length;
      if (rows.length < ONEDAY_LIMIT) break;
      await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
    }
    results.push({ source, count: got, rolling: rgot });
  }
  return results;
}

// C) OneTimePass: insert_dt(timestamptz) カーソルでページング。Lambda応答6MB制限のため LIMIT 4000。
const OTP_LIMIT = 8000;
const OPTION_LIMIT = 5000;
async function exportOnetimepass(dt) {
  const source = "onetimepass";
  // 更新日時カーソル: 挿入 と 使用(start_dt) の最大。使用への遷移(start_dtセット)も差分で拾う。
  //   ※取消(ticket_stat=D)は日時が付かないため差分では拾えない→(2)ローリングウィンドウで担保。
  const UPD_OTP = `greatest(t.insert_dt, coalesce(t.start_dt, t.insert_dt))`;
  const COLS = `t.access_key, t.seq, t.club_cd, t.ticket_stat, t.max_hour, t.amount, t.order_id,
                t.start_dt, t.end_dt, t.insert_dt, u.mail_address, u.name`;
  const FROM = `from t1pass.ticket_tbl t left join t1pass.user_tbl u on u.access_key = t.access_key`;
  // (1) 差分パス: 更新日時 > 前回高水位。新規＋使用を取得し高水位を前進。
  let cur = (await getHighWater(source)) || "1970-01-01T00:00:00Z";
  let maxHw = cur, got = 0;
  while (true) {
    const rows = await proxy("onetimepass",
      `select ${COLS}, ${UPD_OTP} as _upd_dt ${FROM} where ${UPD_OTP} > $1::timestamptz order by _upd_dt limit ${OTP_LIMIT}`, [cur]);
    if (rows.length === 0) break;
    await putNdjson(source, dt, rows.map((r) => { const { _upd_dt, ...rest } = r; return rest; }));
    cur = rows[rows.length - 1]._upd_dt; if (cur > maxHw) maxHw = cur;
    got += rows.length;
    if (rows.length < OTP_LIMIT) break;
    await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
  }
  await setHighWater(source, maxHw, got);
  // (2) ローリングパス: 直近N日insertを再取得(取消D等=日時なし変化を担保)。高水位は動かさない。
  let insCur = lookbackIso(ROLLING_DAYS), rgot = 0;
  while (true) {
    const rows = await proxy("onetimepass",
      `select ${COLS} ${FROM} where t.insert_dt > $1::timestamptz order by t.insert_dt limit ${OTP_LIMIT}`, [insCur]);
    if (rows.length === 0) break;
    await putNdjson(source, dt, rows);
    insCur = rows[rows.length - 1].insert_dt; rgot += rows.length;
    if (rows.length < OTP_LIMIT) break;
    await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
  }
  return { source, count: got, rolling: rgot };
}

// D) オプション都度利用(デジタルチケット OPTN): dgtk_sys.ticket を ticket_create_dt 高水位で差分。
//    会員番号は個人情報Sys(pson).person_tbl(person_id=ticket_holder_id → member_id)で解決して付与。
//    Snowflake側は主キー(ticket_order_id / ticket_code)で MERGE=冪等前提。
async function exportOption(dt) {
  const source = "option#dgtk";
  const startHw = await getHighWater(source);
  let cur = startHw || "1970-01-01T00:00:00Z";
  let maxHw = cur;
  let got = 0;
  while (true) {
    // 更新日時カーソル _upd_dt = 各イベント日時の最大(購入/支払/使用/返金)。
    //   これで消し込み(consume_dt)・返金(cxl_date)等の“状態変化”も差分で再取得できる(insert基準の穴を埋める)。
    //   ※型は環境で date/timestamptz が混在しうるので ::timestamptz に正規化。有効化前にドライランで要検証。
    const UPD_DGTK = `greatest(ticket_create_dt,
              coalesce(ticket_payment_dt::timestamptz,'epoch'::timestamptz),
              coalesce(ticket_consume_dt::timestamptz,'epoch'::timestamptz),
              coalesce(ticket_cxl_date::timestamptz,'epoch'::timestamptz))`;
    const rows = await proxy(
      "dgtk_sys",
      `select ticket_order_id, ticket_code, ticket_holder_id, coupon_code, brand, usage,
              ticket_name, ticket_status, ticket_source, ticket_fix_club, ticket_sales_club,
              ticket_retail_price, club_income, ticket_create_dt, ticket_payment_dt,
              ticket_start_dt, ticket_consume_dt, ticket_cxl_date, ticket_expire, ticket_sales_date,
              ${UPD_DGTK} as _upd_dt
         from dgtk_sys.ticket
        where usage = 'OPTN' and ${UPD_DGTK} > $1::timestamptz
        order by _upd_dt
        limit ${OPTION_LIMIT}`,
      [cur]
    );
    if (rows.length === 0) break;
    // 会員番号解決: holder(person_id) -> member_id を pson からチャンク取得
    const holders = [...new Set(rows.map((r) => r.ticket_holder_id).filter(Boolean))];
    const memberByHolder = {};
    for (let i = 0; i < holders.length; i += 1000) {
      const chunk = holders.slice(i, i + 1000);
      const ph = chunk.map((_, k) => `$${k + 1}`).join(",");
      const mrows = await proxy("pson", `select person_id, member_id from person_tbl where person_id in (${ph})`, chunk);
      for (const m of mrows) memberByHolder[String(m.person_id)] = m.member_id != null ? String(m.member_id) : null;
    }
    await putNdjson(source, dt, rows.map((r) => { const { _upd_dt, ...rest } = r; return { ...rest, member_id: memberByHolder[String(r.ticket_holder_id)] ?? null }; }));
    cur = rows[rows.length - 1]._upd_dt;   // 更新日時カーソルで前進(状態変化も拾う)
    if (cur > maxHw) maxHw = cur;
    got += rows.length;
    if (rows.length < OPTION_LIMIT) break;
    await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
  }
  await setHighWater(source, maxHw, got);
  return { source, count: got };
}

// E) 休会ロスター: DDB(knowbie-recess-roster)の現行runを全件(月×人)エクスポート
async function exportRecess(dt) {
  const meta = await ddb.send(new GetCommand({ TableName: RECESS_TABLE, Key: { recessMonth: "__META__", memberKey: "current" } }));
  const runId = meta.Item?.runId;
  if (!runId) return { source: "recess", count: 0, key: null };
  const rows = [];
  let ek;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: RECESS_TABLE,
      FilterExpression: "recessMonth <> :meta AND runId = :r",
      ExpressionAttributeValues: { ":meta": "__META__", ":r": runId },
      ExclusiveStartKey: ek,
    }));
    for (const it of r.Items || []) rows.push({ recess_month: it.recessMonth, memberno: it.memberno, name: it.name, club_code: it.clubCode, club_name: it.clubName, brand: it.brand, temp_flag: it.tempFlag, applied_at: it.appliedAt || null });
    ek = r.LastEvaluatedKey;
  } while (ek);
  return putNdjson("recess", dt, rows);
}

export const handler = async (event = {}) => {
  const dt = event.date || jstDate();
  // event.sources=["option#dgtk", ...] で対象を絞れる(段階検証・部分再実行用)。未指定は全ソース。
  const want = Array.isArray(event.sources) && event.sources.length ? new Set(event.sources) : null;
  const enabled = (name) => !want || want.has(name);
  const out = [], errors = [];
  // ソース単位でエラー隔離(1ソースの失敗で他を止めない)
  const run = async (name, fn) => {
    if (!enabled(name)) return;
    try { const r = await fn(); out.push(...(Array.isArray(r) ? r : [r])); }
    catch (e) { errors.push({ source: name, error: e?.message || String(e) }); console.error(`[snowflake-export] ${name}:`, e?.message || e); }
  };
  await run("clubs", () => exportClubs(dt));
  await run("oneday#fit365", () => exportOneday(dt));
  await run("onetimepass", () => exportOnetimepass(dt));
  await run("option#dgtk", () => exportOption(dt));
  await run("recess", () => exportRecess(dt));
  const res = { ok: errors.length === 0, dt, results: out, errors };
  console.log("[snowflake-export]", JSON.stringify(res));
  return res;
};
