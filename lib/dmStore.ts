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
  QueryCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const CAMPAIGNS_TABLE = process.env.DYNAMO_DM_CAMPAIGNS_TABLE || "yamauchi-DmCampaigns";
const EVENTS_TABLE = process.env.DYNAMO_DM_EVENTS_TABLE || "yamauchi-DmEvents";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

export type DmCampaignStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled";

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
  batchId?: string;     // SendGrid batch_id (予約送信のキャンセルに使用)
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

// 予約配信のキャンセル (status=cancelled)。
export async function markCampaignCancelled(campaignId: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: CAMPAIGNS_TABLE,
    Key: { campaignId },
    UpdateExpression: "SET #s = :s",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": "cancelled" },
  }));
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

// ── 宛先(受信者)の保存と 開封/未開封の突合 ─────────────────────────────
// 送信時に宛先を DmEvents へ r#<email> として保存しておく (今後分)。開封は
// applyEvent が u#open#<email> を書くので、両者の差分で未開封者を特定できる。

export interface DmRecipient { email: string; name?: string }
export interface DmPeople {
  recipientsCaptured: boolean; // 宛先が保存済みか (旧campaignはfalse=未開封者を特定不可)
  opened: { email: string; name?: string; at?: string }[];
  unopened: { email: string; name?: string }[];
}

// 送信時に宛先を保存 (ベストエフォート・バッチ書き込み)
export async function saveRecipients(campaignId: string, recipients: DmRecipient[]): Promise<void> {
  const seen = new Set<string>();
  const items = recipients
    .map((r) => ({ email: (r.email || "").toLowerCase().trim(), name: (r.name || "").trim() }))
    .filter((r) => r.email && !seen.has(r.email) && seen.add(r.email));
  try {
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      await ddb.send(new BatchWriteCommand({
        RequestItems: {
          [EVENTS_TABLE]: chunk.map((r) => ({
            PutRequest: { Item: { campaignId, sk: `r#${r.email}`, email: r.email, name: r.name || undefined } },
          })),
        },
      }));
    }
  } catch (e: any) {
    console.error("[dmStore] saveRecipients failed:", e?.message || e);
  }
}

// キャンペーンの 宛先×開封 を突合して 開いた人/開いてない人 を返す
export async function listCampaignPeople(campaignId: string): Promise<DmPeople> {
  const recipients = new Map<string, string | undefined>(); // email → name
  const openers = new Map<string, string>();                // email → openedAt(ISO)
  let ek: any;
  try {
    do {
      const res = await ddb.send(new QueryCommand({
        TableName: EVENTS_TABLE,
        KeyConditionExpression: "campaignId = :c",
        ExpressionAttributeValues: { ":c": campaignId },
        ExclusiveStartKey: ek,
      }));
      for (const it of res.Items || []) {
        const sk = String((it as any).sk || "");
        if (sk.startsWith("r#")) recipients.set(String((it as any).email || sk.slice(2)), (it as any).name);
        else if (sk.startsWith("u#open#")) openers.set(sk.slice("u#open#".length), String((it as any).at || ""));
      }
      ek = res.LastEvaluatedKey;
    } while (ek);
  } catch (e: any) {
    console.error("[dmStore] listCampaignPeople failed:", e?.message || e);
  }

  const recipientsCaptured = recipients.size > 0;
  if (recipientsCaptured) {
    const opened: DmPeople["opened"] = [];
    const unopened: DmPeople["unopened"] = [];
    for (const [email, name] of recipients) {
      const at = openers.get(email);
      if (at !== undefined) opened.push({ email, name, at: at || undefined });
      else unopened.push({ email, name });
    }
    opened.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    return { recipientsCaptured, opened, unopened };
  }
  // 旧campaign: 宛先未保存 → 開封者のみ判明 (未開封者は特定不可)
  const opened = [...openers.entries()].map(([email, at]) => ({ email, at: at || undefined }));
  opened.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return { recipientsCaptured: false, opened, unopened: [] };
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
