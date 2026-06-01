// lambdas/clubs-sync/index.mjs
// MotionBoard REST から クラブマスタを取得し DynamoDB knowbie-clubs に upsert する。
// - 毎日 EventBridge から起動される想定 (手動 invoke でも動く)
// - upsert only: 既存レコードを上書き、削除されたクラブは DynamoDB に残置
//   (アプリ側で非表示制御してね)
//
// 環境変数:
//   MOTIONBOARD_SECRET_ARN  Secrets Manager の ARN (tenant/id/pw)
//   MOTIONBOARD_BOARD_PATH  ボードパス (デフォルトあり)
//   MOTIONBOARD_ITEM_ID     itemId (デフォルト ITEM_1-6)
//   CLUBS_TABLE             DynamoDB テーブル名 (デフォルト knowbie-clubs)
//   CLUBS_TABLE_REGION      DynamoDB リージョン (デフォルト us-east-1)
//   READ_COUNT              MotionBoard readCount (デフォルト 500)

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const SECRET_ARN  = process.env.MOTIONBOARD_SECRET_ARN;
const BOARD_PATH  = process.env.MOTIONBOARD_BOARD_PATH || "/遠藤さん作成ボードはすべてここに入れてください/クエリア";
const ITEM_ID     = process.env.MOTIONBOARD_ITEM_ID || "ITEM_1-6";
const ITEM_NAME   = process.env.MOTIONBOARD_ITEM_NAME || "クエリア";
const READ_COUNT  = process.env.READ_COUNT || "500";
const TABLE_NAME  = process.env.CLUBS_TABLE || "knowbie-clubs";
const TABLE_REGION = process.env.CLUBS_TABLE_REGION || "us-east-1";

const sm  = new SecretsManagerClient({ region: process.env.AWS_REGION || "ap-northeast-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: TABLE_REGION }));

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

export const handler = async () => {
  const nowIso = new Date().toISOString();
  console.log(`[clubs-sync] start (table=${TABLE_NAME}, region=${TABLE_REGION}, itemId=${ITEM_ID})`);

  const rows = await fetchClubs();
  console.log(`[clubs-sync] fetched ${rows.length} rows from MotionBoard`);

  const items = rows.map((r) => toItem(r, nowIso)).filter(Boolean);
  console.log(`[clubs-sync] normalized ${items.length} items (dropped ${rows.length - items.length})`);

  const wrote = await upsertAll(items);
  console.log(`[clubs-sync] upserted ${wrote} items`);

  return {
    ok: true,
    fetched: rows.length,
    normalized: items.length,
    wrote,
    syncedAt: nowIso,
    itemId: ITEM_ID,
  };
};
