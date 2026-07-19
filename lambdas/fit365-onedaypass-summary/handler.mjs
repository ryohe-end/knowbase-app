// knowbie-fit365-onedaypass-summary
//
// FIT365 1dayパス金額の夜間事前集計。相手DB(fit365sf=入会系/本番)への負荷を避けるため、
// 全店の価格を「1接続・1クエリ」で取得し DynamoDB(knowbie-fit365-onedaypass) へ書き込む。
// 管理画面の一覧はこの DDB から読む(相手DB負荷ゼロ)。編集は単一店舗ライブなので別。
//
// knowbie-clubs(FIT365店) と名前照合して clubCode を付与 → 店舗ユーザーの自店舗スコープに使う。
// 実行: EventBridge 日次 (例 04:20 JST)。
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const PROXY_FN = process.env.SSH_DB_PROXY_FN || "knowbie-ssh-db-proxy";
const TABLE = process.env.FIT365_ONEDAYPASS_TABLE || "knowbie-fit365-onedaypass";
const CLUBS_TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";

const lambda = new LambdaClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });

function jstDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}
// 名前正規化: NFKC(半角/全角カナ統一) + FIT365/空白除去 で店舗名↔クラブ名を照合
const normName = (s) =>
  String(s || "").normalize("NFKC").replace(/FIT365|フィット365/gi, "").replace(/[\s　]/g, "").trim();

async function proxyQuery(text, params) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: PROXY_FN,
    Payload: Buffer.from(JSON.stringify({ target: "fit365entry", text, params })),
  }));
  const j = JSON.parse(Buffer.from(res.Payload).toString("utf8"));
  if (!j.ok) throw new Error(j.error || "ssh-db-proxy error");
  return j.rows || [];
}

export const handler = async () => {
  const today = jstDate();

  // 1) 全店の価格を1クエリで取得 (相手DBアクセスはこの1回のみ)
  const rows = await proxyQuery(`
    select s.shop_id, s.name, s.one_day_flg, s.prefecture_id, cl.price base_price,
           (select cp.price from one_day_cp_price cp
             where cp.shop_id = s.shop_id and cp.delete_flg = 0
               and cp.cp_start_date <= ? and cp.cp_end_date >= ?
             order by cp.seq desc limit 1) current_cp
      from shop s
      left join one_day_shop_price_classification cl on cl.shop_id = s.shop_id
     where s.delete_flag = 0
     order by s.shop_id`, [today, today]);

  // 2) knowbie-clubs(FIT365) から 名前→clubCode マップ
  const clubMap = new Map();     // 完全一致(正規化)
  const clubEntries = [];        // [{key, clubCode}] 部分一致フォールバック用
  let ek;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: CLUBS_TABLE,
      ProjectionExpression: "clubCode, clubName, clubNameShort, businessType",
      ExclusiveStartKey: ek,
    }));
    for (const it of r.Items || []) {
      if (String(it.businessType || "").toUpperCase() !== "FIT365") continue;
      for (const nm of [it.clubName, it.clubNameShort]) {
        const k = normName(nm);
        if (k) {
          if (!clubMap.has(k)) clubMap.set(k, String(it.clubCode));
          clubEntries.push({ key: k, clubCode: String(it.clubCode) });
        }
      }
    }
    ek = r.LastEvaluatedKey;
  } while (ek);

  // shop名→clubCode: ①完全一致 ②一意な部分一致(誤マッチ防止のため候補が1つの時のみ)
  const resolveClub = (shopName) => {
    const k = normName(shopName);
    if (!k) return null;
    if (clubMap.has(k)) return clubMap.get(k);
    const hits = new Set();
    for (const e of clubEntries) {
      if (e.key.includes(k) || k.includes(e.key)) hits.add(e.clubCode);
    }
    return hits.size === 1 ? [...hits][0] : null; // 一意の時だけ採用
  };

  // 3) DDB へ upsert (clubCode を名前照合で付与)
  const now = new Date().toISOString();
  const items = rows.map((r) => ({
    shopId: String(r.shop_id),
    name: r.name,
    oneDayFlg: !!Number(r.one_day_flg),
    prefectureId: r.prefecture_id ?? null,
    basePrice: r.base_price != null ? Number(r.base_price) : null,
    currentPrice: r.current_cp != null ? Number(r.current_cp) : null,
    clubCode: resolveClub(r.name),
    updatedAt: now,
  }));
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })) } }));
  }

  const matched = items.filter((x) => x.clubCode).length;
  console.log(`[fit365-onedaypass-summary] shops=${items.length} clubMatched=${matched}`);
  return { ok: true, shops: items.length, clubMatched: matched, unmatched: items.length - matched };
};
