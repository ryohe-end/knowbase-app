// lib/dmStore.ts
//
// DM(メール)キャンペーンと配信イベント集計の永続化。
// - yamauchi-DmCampaigns  (PK: campaignId)      … キャンペーン metadata + 集計カウンタ
// - yamauchi-DmEvents     (PK: campaignId, SK)  … ユニーク開封/クリックの重複排除用
//
// 集計は SendGrid Event Webhook (app/api/webhooks/sendgrid) から applyEvent() で
// 原子的 ADD 更新する。open/click のユニーク数は DmEvents への条件付き書き込みで判定。
//
// ※ 両テーブルは事前に作成しておくこと (課金カウンタなのでオンデマンド課金推奨):
//    DmCampaigns: PK campaignId(S)
//    DmEvents:    PK campaignId(S) + SK sk(S)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const CAMPAIGNS_TABLE = process.env.DYNAMO_DM_CAMPAIGNS_TABLE || "yamauchi-DmCampaigns";
const EVENTS_TABLE = process.env.DYNAMO_DM_EVENTS_TABLE || "yamauchi-DmEvents";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

export type DmCampaignStatus = "scheduled" | "sending" | "sent" | "failed";

export interface DmCampaign {
  campaignId: string;
  clubCode: string;
  brand?: string;
  subject: string;
  body?: string;
  imageUrl?: string;
  createdBy?: string;
  createdByName?: string;
  targetCount: number;
  sentCount: number;
  status: DmCampaignStatus;
  scheduledAt?: string; // JST 'YYYY-MM-DD HH:mm' or ISO
  sentAt?: string;      // ISO
  createdAt: string;    // ISO
  // ---- webhook 集計カウンタ (ADD で更新) ----
  processed?: number;
  delivered?: number;
  opens?: number;
  uniqueOpens?: number;
  clicks?: number;
  uniqueClicks?: number;
  bounces?: number;
  dropped?: number;
  deferred?: number;
  spamReports?: number;
  unsubscribes?: number;
  lastEventAt?: string;
}

export function newCampaignId(now: Date): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  // 乱数は Math.random を避け、時刻ミリ秒 + 高解像度を混ぜて衝突回避
  const rand = (now.getTime() % 1_000_000).toString(36).toUpperCase().padStart(4, "0");
  return `DM-${yyyy}${mm}${dd}-${rand}`;
}

export async function createCampaign(c: DmCampaign): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: CAMPAIGNS_TABLE,
      Item: {
        processed: 0, delivered: 0, opens: 0, uniqueOpens: 0,
        clicks: 0, uniqueClicks: 0, bounces: 0, dropped: 0,
        deferred: 0, spamReports: 0, unsubscribes: 0,
        ...c,
      },
      ConditionExpression: "attribute_not_exists(campaignId)",
    })
  );
}

export async function updateCampaignSendResult(
  campaignId: string,
  patch: { status: DmCampaignStatus; sentCount: number; sentAt?: string }
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: CAMPAIGNS_TABLE,
      Key: { campaignId },
      UpdateExpression: "SET #s = :s, sentCount = :c" + (patch.sentAt ? ", sentAt = :t" : ""),
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": patch.status,
        ":c": patch.sentCount,
        ...(patch.sentAt ? { ":t": patch.sentAt } : {}),
      },
    })
  );
}

export async function getCampaign(campaignId: string): Promise<DmCampaign | null> {
  const res = await ddb.send(new GetCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId } }));
  return (res.Item as DmCampaign | undefined) ?? null;
}

// クラブスコープで一覧取得 (件数は小さい想定なので Scan)。
export async function listCampaigns(opts: { clubCodes: string[] }): Promise<DmCampaign[]> {
  const res = await ddb.send(new ScanCommand({ TableName: CAMPAIGNS_TABLE }));
  let items = (res.Items ?? []) as DmCampaign[];
  if (opts.clubCodes.length > 0) {
    items = items.filter((it) => opts.clubCodes.includes(it.clubCode));
  }
  items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return items;
}

// SendGrid の event 名 → キャンペーンカウンタ属性名
const EVENT_TO_COUNTER: Record<string, keyof DmCampaign> = {
  processed: "processed",
  delivered: "delivered",
  open: "opens",
  click: "clicks",
  bounce: "bounces",
  dropped: "dropped",
  deferred: "deferred",
  spamreport: "spamReports",
  unsubscribe: "unsubscribes",
  group_unsubscribe: "unsubscribes",
};

export interface SgEvent {
  event: string;
  email?: string;
  campaign_id?: string;
  timestamp?: number;
}

// 単一イベントを集計に反映。ユニーク open/click は DmEvents で重複排除。
export async function applyEvent(ev: SgEvent): Promise<void> {
  const campaignId = (ev.campaign_id || "").trim();
  if (!campaignId) return; // 当システム発でないメール (campaign_id 無し) は無視
  const counter = EVENT_TO_COUNTER[ev.event];
  if (!counter) return;

  const eventAt = ev.timestamp
    ? new Date(ev.timestamp * 1000).toISOString()
    : new Date().toISOString();

  // ADD カウンタ + lastEventAt 更新。
  const addCounters: string[] = [`${counter} :one`];

  // open/click はユニーク判定して uniqueXxx も加算
  const email = (ev.email || "").toLowerCase().trim();
  let isUnique = false;
  if ((ev.event === "open" || ev.event === "click") && email) {
    const sk = `u#${ev.event}#${email}`;
    try {
      await ddb.send(
        new PutCommand({
          TableName: EVENTS_TABLE,
          Item: { campaignId, sk, at: eventAt },
          ConditionExpression: "attribute_not_exists(sk)",
        })
      );
      isUnique = true; // 初回のみ成功
    } catch (e: any) {
      if (e?.name !== "ConditionalCheckFailedException") throw e;
      isUnique = false; // 既出 → ユニーク加算しない
    }
    if (isUnique) {
      addCounters.push(`${ev.event === "open" ? "uniqueOpens" : "uniqueClicks"} :one`);
    }
  }

  await ddb.send(
    new UpdateCommand({
      TableName: CAMPAIGNS_TABLE,
      Key: { campaignId },
      UpdateExpression: `ADD ${addCounters.join(", ")} SET lastEventAt = :at`,
      ExpressionAttributeValues: { ":one": 1, ":at": eventAt },
      // 存在しない campaignId には作らない (未知メールの誤集計防止)
      ConditionExpression: "attribute_exists(campaignId)",
    })
  ).catch((e: any) => {
    // キャンペーン未登録 (テスト送信等) は無視
    if (e?.name !== "ConditionalCheckFailedException") throw e;
  });
}
