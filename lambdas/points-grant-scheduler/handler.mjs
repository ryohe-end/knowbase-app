// knowbie-points-grant-scheduler
//
// ポイント一括付与の「予約付与」を実行する定期Lambda (EventBridge 5分間隔想定)。
//   - yamauchi-PointGrantJobs から status=pending かつ scheduledAt <= now のジョブを取得
//   - 各ジョブの memberCodes へ CPSS(knowbie-cpss-proxy)で givePoint、台帳(PointTransactions)へ記録
//   - reqid = `${jobId}-${memberCode}` で冪等(再実行しても二重付与しない)
//   - 完了で status=done (granted/failed 記録)。ジョブ単位で running→done に更新
//
// 環境変数: AWS_REGION, JOBS_TABLE(既定 yamauchi-PointGrantJobs),
//           LEDGER_TABLE(既定 yamauchi-PointTransactions), CPSS_PROXY_FUNCTION(既定 knowbie-cpss-proxy)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || "us-east-1";
const JOBS_TABLE = process.env.JOBS_TABLE || "yamauchi-PointGrantJobs";
const LEDGER_TABLE = process.env.LEDGER_TABLE || "yamauchi-PointTransactions";
const CPSS_FN = process.env.CPSS_PROXY_FUNCTION || "knowbie-cpss-proxy";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });
const lambda = new LambdaClient({ region: REGION });

async function cpssGive(brand, env, args) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: CPSS_FN, InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({ brand, env, action: "givePoint", args })),
  }));
  const payload = res.Payload ? Buffer.from(res.Payload).toString("utf-8") : "{}";
  let j; try { j = JSON.parse(payload); } catch { j = {}; }
  if (res.FunctionError) return { ok: false, error: j?.errorMessage || "proxy error" };
  return j;
}

async function scanDue(nowIso) {
  const out = [];
  let lastKey;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: JOBS_TABLE,
      FilterExpression: "#s = :p AND scheduledAt <= :now",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":p": "pending", ":now": nowIso },
      ExclusiveStartKey: lastKey,
    }));
    for (const it of r.Items || []) out.push(it);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

async function runJob(job) {
  const nowIso = new Date().toISOString();
  // pending→running を条件付きで取得(多重実行防止)
  try {
    await ddb.send(new UpdateCommand({
      TableName: JOBS_TABLE, Key: { jobId: job.jobId },
      UpdateExpression: "SET #s = :r, startedAt = :t",
      ConditionExpression: "#s = :p",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":r": "running", ":t": nowIso, ":p": "pending" },
    }));
  } catch (e) {
    if (e?.name === "ConditionalCheckFailedException") return null; // 既に他実行が処理中
    throw e;
  }

  const env = job.env === "prod" ? "prod" : "stg";
  const shopid = env === "prod" ? String(job.clubCode).replace(/\D/g, "").padStart(6, "0") : String(job.clubCode);
  const brand = job.brand === "FIT365" ? "FIT365" : "JOYFIT";
  const points = Number(job.points) || 0;
  const codes = Array.isArray(job.memberCodes) ? job.memberCodes : [];
  let granted = 0, failed = 0; const errs = [];

  for (const memberCode of codes) {
    const reqid = `${job.jobId}-${memberCode}`;
    try {
      const cp = await cpssGive(brand, env, { aid: memberCode, shopid, point: points, reqid, scode: "MANUAL", svalue: job.reason });
      if (!cp.ok) { failed++; errs.push({ memberCode, error: cp.cpssMsg || cp.error }); continue; }
      const tx = {
        transactionId: reqid, clubCode: String(job.clubCode), memberCode,
        type: "earned", points, reason: job.reason, note: job.note,
        occurredAt: new Date().toISOString(), operatorId: job.createdBy || "scheduler",
        operatorName: job.createdByName || "予約付与", hid: cp.result?.hid,
        cpssBalanceAfter: typeof cp.result?.balance === "number" ? cp.result.balance : undefined,
        scheduledJobId: job.jobId,
      };
      try { await ddb.send(new PutCommand({ TableName: LEDGER_TABLE, Item: tx })); } catch (e) { console.error("[scheduler] ledger write failed", memberCode, e?.message); }
      granted++;
    } catch (e) {
      failed++; errs.push({ memberCode, error: e?.message || "error" });
    }
  }

  await ddb.send(new UpdateCommand({
    TableName: JOBS_TABLE, Key: { jobId: job.jobId },
    UpdateExpression: "SET #s = :d, finishedAt = :t, granted = :g, failed = :f, errorsSample = :e",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":d": "done", ":t": new Date().toISOString(), ":g": granted, ":f": failed, ":e": errs.slice(0, 50) },
  }));
  return { jobId: job.jobId, granted, failed };
}

export const handler = async () => {
  const nowIso = new Date().toISOString();
  const due = await scanDue(nowIso);
  const results = [];
  for (const job of due) {
    try { const r = await runJob(job); if (r) results.push(r); }
    catch (e) { console.error("[scheduler] job failed", job.jobId, e?.message); }
  }
  console.log("[points-grant-scheduler]", JSON.stringify({ due: due.length, ran: results.length, results }));
  return { ok: true, due: due.length, results };
};
