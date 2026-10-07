// lib/clubContractSettings.ts
// 入会管理オーバーレイ: クラブ×契約形態ごとに、Oracleマスタに無い属性を knowbase 側で保持する。
// - DynamoDB knowbie-club-contract-settings (PK=clubCode, SK=contractFormCode)。
// - 用途: 公開API /contracts へ merge して、プレオープン契約フラグ/家族会員可否/説明文/募集ON-OFF/違約金を返す。
//   (これらは FIT_ADMIN.契約形態 マスタに列が無いため、運用側が knowbase で入力する唯一の供給源)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
export const CONTRACT_SETTINGS_TABLE = process.env.CLUB_CONTRACT_SETTINGS_TABLE || "knowbie-club-contract-settings";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// オプション提供スコープ。all=全員 / corporate=法人のみ / premium=プレミアムのみ / family=家族のみ。
export type OptionScope = "all" | "corporate" | "premium" | "family";

export interface ClubContractSetting {
  clubCode: string;            // PK
  contractFormCode: string;    // SK (契約形態コード)。主契約・オプション共通
  enabled?: boolean;           // 募集ON/OFF (契約別)。未設定=null扱い(不明)
  isPreOpenContract?: boolean; // プレオープンを表現する契約か
  familyAllowed?: boolean;     // 家族会員を作れる契約か
  description?: string;        // 説明文
  penalty?: number | null;     // 違約金(円)。未設定=null
  // --- オプション(会員区分90)向け ---
  availableForContracts?: string[]; // そのオプションを提供する主契約コード配列。空/未設定=全主契約
  scope?: OptionScope;              // 提供スコープ。未設定=all(全員)
  updatedAt?: string;
  updatedBy?: string;
}

// 公開APIへ merge する overlay 値(キー=contractFormCode)。
export type OverlayValue = Pick<ClubContractSetting, "enabled" | "isPreOpenContract" | "familyAllowed" | "description" | "penalty" | "availableForContracts" | "scope">;

// クラブの全 overlay を contractFormCode→値 のマップで返す(無ければ空マップ)。
export async function loadClubContractOverlay(clubCode: string): Promise<Record<string, OverlayValue>> {
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: CONTRACT_SETTINGS_TABLE,
      KeyConditionExpression: "clubCode = :c",
      ExpressionAttributeValues: { ":c": String(clubCode) },
    }));
    const map: Record<string, OverlayValue> = {};
    for (const it of (r.Items as ClubContractSetting[]) || []) {
      map[String(it.contractFormCode)] = {
        enabled: it.enabled,
        isPreOpenContract: it.isPreOpenContract,
        familyAllowed: it.familyAllowed,
        description: it.description,
        penalty: it.penalty ?? null,
        availableForContracts: Array.isArray(it.availableForContracts) ? it.availableForContracts : undefined,
        scope: it.scope,
      };
    }
    return map;
  } catch (e) {
    console.error("[clubContractSettings] load failed:", (e as Error)?.message);
    return {};
  }
}

// 管理用: クラブの overlay 一覧(生アイテム)。
export async function listClubContractSettings(clubCode: string): Promise<ClubContractSetting[]> {
  const r = await ddb.send(new QueryCommand({
    TableName: CONTRACT_SETTINGS_TABLE,
    KeyConditionExpression: "clubCode = :c",
    ExpressionAttributeValues: { ":c": String(clubCode) },
  }));
  return (r.Items as ClubContractSetting[]) || [];
}

// 管理用: 1契約の overlay を upsert。
export async function putClubContractSetting(s: ClubContractSetting): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: CONTRACT_SETTINGS_TABLE,
    Item: {
      clubCode: String(s.clubCode),
      contractFormCode: String(s.contractFormCode),
      ...(typeof s.enabled === "boolean" ? { enabled: s.enabled } : {}),
      ...(typeof s.isPreOpenContract === "boolean" ? { isPreOpenContract: s.isPreOpenContract } : {}),
      ...(typeof s.familyAllowed === "boolean" ? { familyAllowed: s.familyAllowed } : {}),
      ...(s.description != null ? { description: String(s.description) } : {}),
      ...(s.penalty != null ? { penalty: Number(s.penalty) } : {}),
      ...(Array.isArray(s.availableForContracts) ? { availableForContracts: s.availableForContracts.map(String) } : {}),
      ...(s.scope ? { scope: s.scope } : {}),
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    },
  }));
}

export async function getClubContractSetting(clubCode: string, contractFormCode: string): Promise<ClubContractSetting | null> {
  const r = await ddb.send(new GetCommand({
    TableName: CONTRACT_SETTINGS_TABLE,
    Key: { clubCode: String(clubCode), contractFormCode: String(contractFormCode) },
  }));
  return (r.Item as ClubContractSetting) || null;
}
