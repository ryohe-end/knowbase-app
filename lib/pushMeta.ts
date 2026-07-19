// lib/pushMeta.ts
//
// Push/お知らせ の付帯メタ情報 (配信者など)。member-app-server 所有の information2 には
// 配信者列が無いため、我々の DynamoDB(knowbie-push-meta) に informationId をキーとして
// 「誰が・どのブランド/店舗向けに作ったか」を別持ちする。集計や送信には一切関与しない。
//
// すべてベストエフォート: テーブル未整備でも push 作成/一覧を止めない。
//    テーブル: knowbie-push-meta  PK informationId(S)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.PUSH_META_TABLE || "knowbie-push-meta";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface PushMeta {
  informationId: string;
  createdBy?: string;
  createdByName?: string;
  brand?: string;
  clubCodes?: string[];
  targetType?: "ALL" | "CONDITION";
  createdAt?: string;
}

export async function putPushMeta(m: PushMeta): Promise<void> {
  try {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...m, informationId: String(m.informationId) } }));
  } catch (e: any) {
    console.error("[pushMeta] put failed:", e?.message || e);
  }
}

// informationId 群 → メタ (見つからない/失敗は空マップで返す)
export async function batchGetPushMeta(ids: (string | number)[]): Promise<Record<string, PushMeta>> {
  const out: Record<string, PushMeta> = {};
  const keys = [...new Set(ids.map((i) => String(i)))].map((informationId) => ({ informationId }));
  if (keys.length === 0) return out;
  try {
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const res = await ddb.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: chunk } } }));
      for (const it of res.Responses?.[TABLE] || []) out[String((it as PushMeta).informationId)] = it as PushMeta;
    }
  } catch (e: any) {
    console.error("[pushMeta] batchGet failed:", e?.message || e);
  }
  return out;
}
