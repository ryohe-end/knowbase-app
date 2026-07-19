// knowbie-recess-roster
//
// 休会ロスターの夜間事前集計。休会マスタは外部API(host='C')側にあり、DB内は
// 入会DB(fit365entry / ecojoy)の recess_api_history に呼び出しログとして JSON が残るのみ。
// ここでは rw='a'(参照)レスポンスの「現在の休会状態」を会員ごと最新で解釈し、
// apply_flg=true の対象月を月別ロスターとして DynamoDB(knowbie-recess-roster)へ書き出す。
// FIT365 は rw='r'(申請)ログから申請日時も付与する。管理画面はこの DDB を読む(相手DB負荷ゼロ)。
//
//   出力: PK recessMonth(YYYYMM) / SK memberKey(clubCode#memberno)
//         + memberno,name,clubCode,clubName,brand,tempFlag,appliedAt,runId,ttl
//   実行: EventBridge 日次 (例 04:40 JST)。相手DBは夜間リストア後に。
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const PROXY_FN = process.env.SSH_DB_PROXY_FN || "knowbie-ssh-db-proxy";
const TABLE = process.env.RECESS_TABLE || "knowbie-recess-roster";
const PAGE = 2000;      // recess_api_history 読み出しのページサイズ
const NAME_CHUNK = 500; // member 名の IN 取得サイズ

const lambda = new LambdaClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });

const BRANDS = [
  { brand: "FIT365", target: "fit365entry" },
  { brand: "JOYFIT", target: "ecojoy" },
];

async function proxy(target, text, params = []) {
  const res = await lambda.send(new InvokeCommand({ FunctionName: PROXY_FN, Payload: Buffer.from(JSON.stringify({ target, text, params })) }));
  const j = JSON.parse(Buffer.from(res.Payload).toString("utf8"));
  if (!j.ok) throw new Error(j.error || "ssh-db-proxy error");
  return j.rows || [];
}

// rw='a' の休会レスポンスを会員ごと最新で解釈し、apply_flg=true の月を集める
async function collectCurrentRecess(target) {
  const seen = new Set();           // memberno(処理済み=最新確定)
  const items = [];                 // {memberno, clubCode, clubName, recessMonth, tempFlag}
  for (let offset = 0; ; offset += PAGE) {
    const rows = await proxy(
      target,
      `SELECT response FROM recess_api_history
        WHERE rw='a' AND INSTR(response, 'apply_flg\":true') > 0
        ORDER BY request_dt DESC LIMIT ? OFFSET ?`,
      [PAGE, offset]
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      let j;
      try { j = JSON.parse(r.response); } catch { continue; }
      const mn = j?.member_info?.memberno;
      if (!mn || seen.has(mn)) continue; // 最新(DESC先頭)のみ採用
      seen.add(mn);
      const clubCode = String(j?.member_info?.club_code ?? j?.club_info?.club_code ?? "");
      const clubName = String(j?.club_info?.club_name ?? "");
      for (const m of j?.recess_month_info || []) {
        if (m?.apply_flg) items.push({ memberno: String(mn), clubCode, clubName, recessMonth: String(m.recess_month), tempFlag: !!m.temp_flag });
      }
    }
    if (rows.length < PAGE) break;
  }
  return items;
}

// rw='r'(申請) から (memberno, recessMonth) -> 最新の申請日時
async function collectApplyDates(target) {
  const map = new Map();
  const rows = await proxy(target, "SELECT request, request_dt FROM recess_api_history WHERE rw='r' ORDER BY request_dt ASC", []);
  for (const r of rows) {
    let j; try { j = JSON.parse(r.request); } catch { continue; }
    const mn = j?.memberno; if (!mn) continue;
    for (const m of j?.recess_month_info || []) {
      if (m?.apply_flg) map.set(`${mn}#${m.recess_month}`, r.request_dt);
    }
  }
  return map;
}

// member 名(漢字) を memberno でまとめて取得
async function fetchNames(target, membernos) {
  const names = new Map();
  const list = [...new Set(membernos)];
  for (let i = 0; i < list.length; i += NAME_CHUNK) {
    const chunk = list.slice(i, i + NAME_CHUNK);
    const ph = chunk.map(() => "?").join(",");
    const rows = await proxy(target, `SELECT member_no, own_name_cc FROM member WHERE member_no IN (${ph})`, chunk);
    for (const r of rows) names.set(String(r.member_no), r.own_name_cc || "");
  }
  return names;
}

export const handler = async () => {
  const runId = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 4 * 24 * 3600; // 4日で古い版を自動失効
  let total = 0;
  const monthTotals = {};

  const batch = [];
  const flush = async () => {
    while (batch.length) {
      const part = batch.splice(0, 25);
      await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: part.map((Item) => ({ PutRequest: { Item } })) } }));
    }
  };

  for (const { brand, target } of BRANDS) {
    const current = await collectCurrentRecess(target);
    const applyDates = brand === "FIT365" ? await collectApplyDates(target) : new Map();
    const names = await fetchNames(target, current.map((c) => c.memberno));
    for (const c of current) {
      const item = {
        recessMonth: c.recessMonth,
        memberKey: `${c.clubCode}#${c.memberno}`,
        memberno: c.memberno,
        name: names.get(c.memberno) || "",
        clubCode: c.clubCode,
        clubName: c.clubName,
        brand,
        tempFlag: c.tempFlag,
        appliedAt: applyDates.get(`${c.memberno}#${c.recessMonth}`) || null,
        runId, ttl,
      };
      batch.push(item);
      total++;
      monthTotals[c.recessMonth] = (monthTotals[c.recessMonth] || 0) + 1;
      if (batch.length >= 25) await flush();
    }
  }
  await flush();
  // 最新 runId をメタに記録 (API はこの runId の行だけを有効とみなす)
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { recessMonth: "__META__", memberKey: "current", runId, updatedAt: runId, monthTotals } }));

  console.log("[recess-roster]", JSON.stringify({ runId, total, months: Object.keys(monthTotals).length }));
  return { ok: true, runId, total, monthTotals };
};
