// lib/shopifyLinkStore.ts
// 会員番号紐付けの一時ストア。
// 登録フォーム送信時 (/link) は顧客がまだ確定していないため、email→会員番号 を短命保存し、
// customers/create webhook で email 照合して確定・メタフィールド書込に使う。
// DynamoDB テーブル: PK=email(S), 属性 memberId(S), ttl(N=失効epoch秒)。TTL有効化(属性名 "ttl")。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_SHOPIFY_LINK_TABLE || "fit365-ShopifyMemberLink";
const TTL_SECONDS = 15 * 60; // 15分で失効

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

const norm = (email: string) => email.trim().toLowerCase();

export async function stashMemberLink(email: string, memberId: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        email: norm(email),
        memberId,
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      },
    })
  );
}

/** email に紐づく会員番号を取得（削除しない）。確定成功後に deleteMemberLink で消す。 */
export async function peekMemberLink(email: string): Promise<string | null> {
  const got = await ddb.send(new GetCommand({ TableName: TABLE, Key: { email: norm(email) } }));
  return (got.Item?.memberId as string) || null;
}

export async function deleteMemberLink(email: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { email: norm(email) } }));
}
