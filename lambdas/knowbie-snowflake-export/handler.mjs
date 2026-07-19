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

async function putNdjson(source, dt, rows) {
  if (rows.length === 0) return { source, count: 0, key: null };
  const key = `${source}/dt=${dt}/part-${Date.now()}.ndjson.gz`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: gzipSync(Buffer.from(ndjson(rows), "utf8")),
    ContentType: "application/x-ndjson", ContentEncoding: "gzip",
  }));
  return { source, count: rows.length, key };
}

async function proxy(target, text, params = []) {
  const res = await lambda.send(new InvokeCommand({ FunctionName: PROXY_FN, Payload: Buffer.from(JSON.stringify({ target, text, params })) }));
  const j = JSON.parse(Buffer.from(res.Payload).toString("utf8"));
  if (!j.ok) throw new Error(j.error || "ssh-db-proxy error");
  return j.rows || [];
}

async function getHighWater(source) {
  const r = await ddb.send(new GetCommand({ TableName: STATE_TABLE, Key: { source } }));
  return r.Item?.lastHighWater ?? null;
}
async function setHighWater(source, value, count) {
  if (value == null) return;
  await ddb.send(new PutCommand({ TableName: STATE_TABLE, Item: { source, lastHighWater: String(value), count, updatedAt: new Date().toISOString() } }));
}

// A) クラブ: 全件洗い替え (Snowflake側は MERGE / TRUNCATE+COPY)
async function exportClubs(dt) {
  const rows = [];
  let ek;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: CLUBS_TABLE, ExclusiveStartKey: ek }));
    for (const it of r.Items || []) rows.push(it);
    ek = r.LastEvaluatedKey;
  } while (ek);
  return putNdjson("clubs", dt, rows.map((c) => ({ ...c, _exported_at: new Date().toISOString() })));
}

// B) 1day: insert_date(char8) 高水位で差分。brand別に fit365entry / ecojoy を対象。
async function exportOneday(dt) {
  const results = [];
  for (const [brand, target] of [["fit365", "fit365entry"], ["joyfit", "ecojoy"]]) {
    const source = `oneday#${brand}`;
    const hw = await getHighWater(source);
    const rows = await proxy(
      target,
      `SELECT t.token, t.serial_number, t.uuid, t.shop_id, spv.casio_shop_id, t.member_no, t.cmember_no,
              t.use_date, t.use_time, t.purchase_date, t.purchase_time, t.expiration_date, t.expiration_time,
              t.is_expired, t.payment_flg, t.del_flg, t.insert_date, t.insert_time
         FROM one_day_ticket t
         LEFT JOIN shop_convert_view spv ON spv.town_shop_id = t.shop_id
        WHERE t.insert_date > ?
        ORDER BY t.insert_date, t.insert_time
        LIMIT 100000`,
      [hw || "00000000"]
    );
    const out = await putNdjson(source, dt, rows.map((r) => ({ ...r, brand })));
    const maxHw = rows.reduce((m, r) => (String(r.insert_date) > m ? String(r.insert_date) : m), hw || "00000000");
    await setHighWater(source, maxHw, rows.length);
    results.push(out);
  }
  return results;
}

// C) OneTimePass: insert_dt(timestamptz) 高水位で差分。
async function exportOnetimepass(dt) {
  const source = "onetimepass";
  const hw = await getHighWater(source);
  const rows = await proxy(
    "onetimepass",
    `select t.access_key, t.seq, t.club_cd, t.ticket_stat, t.max_hour, t.amount, t.order_id,
            t.start_dt, t.end_dt, t.insert_dt, u.mail_address, u.name
       from t1pass.ticket_tbl t
       left join t1pass.user_tbl u on u.access_key = t.access_key
      where t.insert_dt > $1::timestamptz
      order by t.insert_dt
      limit 100000`,
    [hw || "1970-01-01T00:00:00Z"]
  );
  const out = await putNdjson(source, dt, rows);
  const maxHw = rows.reduce((m, r) => (r.insert_dt && r.insert_dt > m ? r.insert_dt : m), hw || "1970-01-01T00:00:00Z");
  await setHighWater(source, maxHw, rows.length);
  return out;
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
  const out = [];
  out.push(await exportClubs(dt));
  out.push(...(await exportOneday(dt)));
  out.push(await exportOnetimepass(dt));
  out.push(await exportRecess(dt));
  console.log("[snowflake-export]", JSON.stringify({ dt, out }));
  return { ok: true, dt, results: out };
};
