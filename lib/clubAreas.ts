// lib/clubAreas.ts
//
// 課別エリア/テリトリー (例: 「関東 第1エリア」) の本番SoT。
// 元は lib/unpaidAreaMap.ts のハードコード(2026-07 課別人員表)だったが、DynamoDB
// `knowbie-club-areas` に移して /admin から編集できるようにした。
// knowbie-clubs は clubs-sync が毎日 PutRequest で全置換するため、エリアは別テーブルに分離。
//
// 読み取りは短TTLキャッシュ。テーブルが空/読取失敗のときは従来のハードコード
// (buildClubAreaLookup) にフォールバックし、移行中も表示が壊れないようにする。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { buildClubAreaLookup } from "@/lib/unpaidAreaMap";

const REGION = process.env.CLUB_AREAS_TABLE_REGION || process.env.AWS_REGION || "us-east-1";
export const CLUB_AREAS_TABLE = process.env.CLUB_AREAS_TABLE || "knowbie-club-areas";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

export type TerritoryRow = { territory: string; clubCodes: string[] };
export interface ClubAreaRow {
  areaId: string;
  area: string;          // 例: 関東 第1エリア
  block: string;         // 例: 関東
  clubCodes: string[];   // エリア直下の所属店舗(テリトリー未設定含む)
  territories: TerritoryRow[];
  updatedAt?: string;
  updatedBy?: string;
}

export type ClubAreaLookup = Record<string, { area: string; block: string; territory: string }>;

const TTL_MS = 5 * 60_000;
let _cache: { at: number; rows: ClubAreaRow[] } | null = null;

function normArr(v: any): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}
function normTerritories(v: any): TerritoryRow[] {
  if (!Array.isArray(v)) return [];
  return v.map((t) => ({ territory: String(t?.territory ?? "").trim(), clubCodes: normArr(t?.clubCodes) }))
    .filter((t) => t.territory || t.clubCodes.length > 0);
}
function normRow(it: any): ClubAreaRow {
  return {
    areaId: String(it.areaId),
    area: String(it.area ?? ""),
    block: String(it.block ?? ""),
    clubCodes: normArr(it.clubCodes),
    territories: normTerritories(it.territories),
    updatedAt: it.updatedAt ? String(it.updatedAt) : undefined,
    updatedBy: it.updatedBy ? String(it.updatedBy) : undefined,
  };
}

// 生のエリア行(全件)。管理画面用。キャッシュ共有。
export async function listClubAreas(opts?: { fresh?: boolean }): Promise<ClubAreaRow[]> {
  if (!opts?.fresh && _cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  const rows: ClubAreaRow[] = [];
  let lastKey: any = undefined;
  do {
    const res: any = await ddb.send(new ScanCommand({ TableName: CLUB_AREAS_TABLE, ExclusiveStartKey: lastKey }));
    if (Array.isArray(res.Items)) for (const it of res.Items) rows.push(normRow(it));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  rows.sort((a, b) => String(a.area).localeCompare(String(b.area), "ja"));
  _cache = { at: Date.now(), rows };
  return rows;
}

export function invalidateClubAreasCache(): void {
  _cache = null;
}

// clubCode -> {area, block, territory} の逆引き。DB由来。空/失敗時はハードコードにフォールバック。
export async function loadClubAreaLookup(): Promise<ClubAreaLookup> {
  try {
    const rows = await listClubAreas();
    if (rows.length === 0) return buildClubAreaLookup();
    const map: ClubAreaLookup = {};
    for (const a of rows) {
      for (const code of a.clubCodes) {
        const k = String(code);
        if (!map[k]) map[k] = { area: a.area, block: a.block, territory: "" };
      }
      for (const t of a.territories) {
        for (const code of t.clubCodes) {
          map[String(code)] = { area: a.area, block: a.block, territory: t.territory };
        }
      }
    }
    return map;
  } catch (e) {
    console.error("[clubAreas] DB read failed, falling back to static map:", (e as Error)?.message);
    return buildClubAreaLookup();
  }
}
