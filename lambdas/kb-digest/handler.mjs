// lambdas/kb-digest/handler.mjs (esbuild でバンドルして index.mjs を生成)
// KB通信の重い処理(動向集計+Claude生成+全員配信)を Lambda で実行。
// Amplify SSR は ~28s でタイムアウトするため切り出し。
// action:
//   "preview" … 生成して knowbie-kb-digest に preview#<id> として保存(UIはポーリング)
//   "send"    … 生成(or 受領html)して全員配信 + issue記録 + config更新
//   "cron"    … isDue判定 → 該当時のみ生成+全員配信 (EventBridge毎時)
import {
  getConfig, gatherTrends, generateDigest, sendToAll, recordIssue, saveConfig, isDue,
} from "../../lib/kbDigest.ts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.KB_DIGEST_TABLE || "knowbie-kb-digest";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function periodFor(cfg) {
  return cfg.frequency === "monthly" ? 30 : cfg.frequency === "biweekly" ? 14 : 7;
}

export const handler = async (event) => {
  const action = event?.action;

  if (action === "preview") {
    const previewId = String(event.previewId || "");
    try {
      const saved = await getConfig();
      const cfg = { ...saved, ...(event.cfg || {}), sections: { ...saved.sections, ...(event.cfg?.sections || {}) } };
      const trends = await gatherTrends(event.periodDays || periodFor(cfg));
      const { subject, html } = await generateDigest({ cfg, trends });
      await ddb.send(new PutCommand({ TableName: TABLE, Item: { id: `preview#${previewId}`, status: "ready", subject, html, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 3600 } }));
      return { ok: true };
    } catch (e) {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: { id: `preview#${previewId}`, status: "error", error: String(e?.message || e).slice(0, 500), ttl: Math.floor(Date.now() / 1000) + 3600 } }));
      return { ok: false, error: String(e?.message || e) };
    }
  }

  if (action === "send") {
    const cfg = await getConfig();
    let subject = String(event.subject || "").trim();
    let html = String(event.html || "").trim();
    if (!subject || !html) {
      const trends = await gatherTrends(periodFor(cfg));
      const gen = await generateDigest({ cfg, trends });
      subject = gen.subject; html = gen.html;
    }
    const { sent, failed } = await sendToAll({ subject, html, targetType: cfg.targetType, targetGroupIds: cfg.targetGroupIds });
    await recordIssue({ subject, html, sent, auto: false });
    await saveConfig({ lastSentAt: new Date().toISOString(), lastSubject: subject, nextDraft: "" });
    console.log(`[kb-digest] send done: "${subject}" sent=${sent} failed=${failed}`);
    return { ok: true, sent, failed, subject };
  }

  if (action === "cron") {
    const cfg = await getConfig();
    if (!isDue(cfg, new Date())) return { ok: true, due: false };
    const trends = await gatherTrends(periodFor(cfg));
    const { subject, html } = await generateDigest({ cfg, trends });
    const { sent, failed } = await sendToAll({ subject, html, targetType: cfg.targetType, targetGroupIds: cfg.targetGroupIds });
    await recordIssue({ subject, html, sent, auto: true });
    await saveConfig({ lastSentAt: new Date().toISOString(), lastSubject: subject, nextDraft: "" });
    console.log(`[kb-digest] cron sent: "${subject}" sent=${sent}`);
    return { ok: true, due: true, sent, failed, subject };
  }

  return { ok: false, error: "unknown action" };
};
