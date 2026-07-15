// lib/clubScope.ts
// ユーザーの担当エリア(companyGroup)を knowbie-clubs で店舗(clubCode)に展開する。
// 実効スコープ = 個別clubCodes ∪ 担当エリアに属する全店舗。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const CLUBS_TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const CLUBS_REGION = process.env.CLUBS_REGION || "us-east-1";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: CLUBS_REGION }));

let _cache: {
  at: number;
  byArea: Map<string, string[]>;
  areas: string[];
  bizByClub: Map<string, string>;
} | null = null;

async function loadAreaMap(): Promise<{
  byArea: Map<string, string[]>;
  areas: string[];
  bizByClub: Map<string, string>;
}> {
  if (_cache && Date.now() - _cache.at < 5 * 60_000) return _cache;
  const byArea = new Map<string, string[]>();
  const bizByClub = new Map<string, string>();
  let ExclusiveStartKey: any = undefined;
  do {
    const res: any = await ddb.send(new ScanCommand({
      TableName: CLUBS_TABLE,
      ProjectionExpression: "clubCode, companyGroup, businessType",
      ExclusiveStartKey,
    }));
    for (const it of res.Items ?? []) {
      if (!it.clubCode) continue;
      const code = String(it.clubCode);
      if (it.businessType) bizByClub.set(code, String(it.businessType));
      const area = it.companyGroup;
      if (!area) continue;
      const arr = byArea.get(area) || [];
      arr.push(code);
      byArea.set(area, arr);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  _cache = { at: Date.now(), byArea, areas: [...byArea.keys()].sort(), bizByClub };
  return _cache;
}

// clubCode の businessType (例: "FIT365", "赤", "青", "JOYFIT+", ...) を返す。未登録は null。
export async function getClubBusinessType(clubCode: string): Promise<string | null> {
  try {
    const { bizByClub } = await loadAreaMap();
    return bizByClub.get(String(clubCode).trim()) ?? null;
  } catch (e) {
    console.error("[clubScope] businessType lookup failed:", e);
    return null;
  }
}

// businessType → CPSS ブランド。FIT365 のみ wellness、それ以外(赤/青/緑/JOYFIT+/メディカル 等)は
// すべて JOYFIT グループ(yamauchi) とみなす。
export function cpssBrandForBusinessType(bizType?: string | null): "JOYFIT" | "FIT365" {
  return (bizType || "").toUpperCase().startsWith("FIT365") ? "FIT365" : "JOYFIT";
}

// 個別clubCodes + 担当エリア(companyGroup)の店舗 を union した実効スコープ
export async function effectiveClubCodes(clubCodes: string[], areas: string[]): Promise<string[]> {
  if (!areas || areas.length === 0) return clubCodes;
  try {
    const { byArea } = await loadAreaMap();
    const set = new Set(clubCodes);
    for (const a of areas) for (const c of byArea.get(a) || []) set.add(c);
    return [...set];
  } catch (e) {
    console.error("[clubScope] area expand failed:", e);
    return clubCodes; // 失敗時は個別clubCodesのみ (安全側)
  }
}

// 割当可能なエリア(companyGroup)一覧
export async function listAreas(): Promise<string[]> {
  try {
    return (await loadAreaMap()).areas;
  } catch {
    return [];
  }
}
