// lib/storeAppOverlay.ts
// club__c(会員DB) に無いアプリ表示専用の付加設定を DynamoDB に保存するオーバーレイ。
//   - 7つの表示トグル (showAppEnableButton 等)
//   - 店舗マシンの詳細 (imageUrl / maker / bodyRegion。club__c は名前のみ保持)
// テーブル: yamauchi-StoreAppConfig (PK clubCode)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { MachineConfig } from "@/types/storeAppConfig";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_STORE_APP_CONFIG_TABLE || "yamauchi-StoreAppConfig";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

export const OVERLAY_TOGGLE_KEYS = [
  "showAppEnableButton",
  "enableReferral",
  "showMainContractChange",
  "showKioskContractChange",
  "showOptionChange",
  "showFamilyAdd",
  "showWithdrawal",
] as const;
export type OverlayToggleKey = (typeof OVERLAY_TOGGLE_KEYS)[number];

export interface StoreAppOverlay {
  clubCode: string;
  toggles: Partial<Record<OverlayToggleKey, boolean>>;
  machines: MachineConfig[]; // 名前→詳細 (imageUrl/maker/bodyRegion)
  updatedAt: string;
}

export async function getOverlay(clubCode: string): Promise<StoreAppOverlay | null> {
  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { clubCode } }));
    return (res.Item as StoreAppOverlay | undefined) ?? null;
  } catch (e: any) {
    // テーブル未整備でも基本設定は club__c で成立させる (オーバーレイは best-effort)
    console.error("[storeAppOverlay] get failed:", e?.message || e);
    return null;
  }
}

export async function putOverlay(
  clubCode: string,
  data: { toggles: Partial<Record<OverlayToggleKey, boolean>>; machines: MachineConfig[] }
): Promise<void> {
  const item: StoreAppOverlay = {
    clubCode,
    toggles: data.toggles,
    machines: Array.isArray(data.machines) ? data.machines : [],
    updatedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}
