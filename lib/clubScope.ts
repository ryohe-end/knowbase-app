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
  nameByClub: Map<string, string>;
  directClubs: string[]; // 直営 (companyGroup が FC 以外)
  fcClubs: string[];     // FC   (companyGroup が FC 始まり)
} | null = null;

async function loadAreaMap(): Promise<{
  byArea: Map<string, string[]>;
  areas: string[];
  bizByClub: Map<string, string>;
  nameByClub: Map<string, string>;
  directClubs: string[];
  fcClubs: string[];
}> {
  if (_cache && Date.now() - _cache.at < 5 * 60_000) return _cache;
  const byArea = new Map<string, string[]>();
  const bizByClub = new Map<string, string>();
  const nameByClub = new Map<string, string>();
  const directClubs: string[] = [];
  const fcClubs: string[] = [];
  let ExclusiveStartKey: any = undefined;
  do {
    const res: any = await ddb.send(new ScanCommand({
      TableName: CLUBS_TABLE,
      ProjectionExpression: "clubCode, companyGroup, businessType, clubName, clubNameShort",
      ExclusiveStartKey,
    }));
    for (const it of res.Items ?? []) {
      if (!it.clubCode) continue;
      const code = String(it.clubCode);
      if (it.businessType) bizByClub.set(code, String(it.businessType));
      const nm = it.clubNameShort || it.clubName;
      if (nm) nameByClub.set(code, String(nm));
      const area = it.companyGroup;
      if (!area) continue;
      const cg = String(area);
      // 直営/FC 分類 (WFAP=海外は除外)。ボタン表示・グループスコープに使う。
      if (cg.toUpperCase() !== "WFAP") {
        if (cg.toUpperCase().startsWith("FC")) fcClubs.push(code);
        else directClubs.push(code);
      }
      const arr = byArea.get(cg) || [];
      arr.push(code);
      byArea.set(cg, arr);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  _cache = { at: Date.now(), byArea, areas: [...byArea.keys()].sort(), bizByClub, nameByClub, directClubs, fcClubs };
  return _cache;
}

// clubCode → 店舗名 の解決マップ。未登録は clubCode をそのまま名前に使う。
export async function getClubNames(codes: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];
  if (uniq.length === 0) return out;
  try {
    const { nameByClub } = await loadAreaMap();
    for (const c of uniq) out[c] = nameByClub.get(c) || c;
  } catch (e) {
    console.error("[clubScope] name lookup failed:", e);
    for (const c of uniq) out[c] = c;
  }
  return out;
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

// 会員番号 → 所属クラブコードを解決する。
// クラブコードは 3桁 or 4桁 で、会員番号は「クラブコード + 連番」。先頭3桁固定で切ると
// 4桁クラブ(直営に多い)を誤解決し、別クラブ(=別ブランド)に飛んでCPSS参照が失敗する。
// 既知クラブ集合で 4桁優先→3桁 に解決。3桁/4桁の両方が実在する衝突時のみ
// app_user.club_code を正として確定する(会員マスタが真実)。
export async function resolveHomeClub(memberCode: string): Promise<string> {
  const code = String(memberCode || "").trim();
  const c3 = code.slice(0, 3);
  const c4 = code.slice(0, 4);
  let has3 = false;
  let has4 = false;
  try {
    const { bizByClub } = await loadAreaMap();
    has3 = bizByClub.has(c3);
    has4 = bizByClub.has(c4);
  } catch (e) {
    console.error("[clubScope] resolveHomeClub club set load failed:", e);
    return c3;
  }
  if (has4 && !has3) return c4; // 4桁のみ既知 → 4桁 (大半の4桁クラブ)
  if (has3 && !has4) return c3; // 3桁のみ既知 → 3桁 (従来の正常ケース)
  if (has3 && has4) {
    // 衝突(例: "1106" も "110" も実在): 会員の実クラブを app_user から確定する
    try {
      const { query } = await import("./memberDb");
      const r = await query<{ club_code: string }>(
        "SELECT club_code FROM app_user WHERE member_id = $1 LIMIT 1",
        [code]
      );
      const cc = r.rows[0]?.club_code ? String(r.rows[0].club_code).trim() : "";
      if (cc === c3 || cc === c4) return cc;
    } catch (e) {
      console.error("[clubScope] resolveHomeClub app_user disambiguation failed:", e);
    }
    return c4; // 不明時は4桁優先 (4桁クラブは新しく、衝突の主因)
  }
  return c3; // どちらも未知 → 従来通り先頭3桁
}

// 個別clubCodes + 担当エリア(companyGroup)の店舗 を union した実効スコープ
// 所属グループ(g001=直営 / g002=FC)を店舗スコープに展開する。
// clubCodes/areas が未割当のユーザーの実効スコープを所属区分で補うために使う。
export async function groupScopeClubs(groupIds: string[]): Promise<string[]> {
  const wantDirect = groupIds.includes("g001"); // 直営
  const wantFc = groupIds.includes("g002");     // FC
  if (!wantDirect && !wantFc) return [];
  try {
    const { directClubs, fcClubs } = await loadAreaMap();
    const set = new Set<string>();
    if (wantDirect) for (const c of directClubs) set.add(c);
    if (wantFc) for (const c of fcClubs) set.add(c);
    return [...set];
  } catch (e) {
    console.error("[clubScope] groupScopeClubs failed:", e);
    return [];
  }
}

// 実効クラブスコープ。個別clubCodes + 担当エリア(companyGroup)を union。
// 明示スコープが空の非adminは、所属グループ(g001=直営 / g002=FC)の店舗をスコープとする。
// admin は空のまま返す(呼び出し側で「空=全件」と解釈)。
export async function effectiveClubCodes(
  clubCodes: string[],
  areas: string[],
  opts?: { groupIds?: string[]; role?: string }
): Promise<string[]> {
  let base = clubCodes;
  if (areas && areas.length > 0) {
    try {
      const { byArea } = await loadAreaMap();
      const set = new Set(clubCodes);
      for (const a of areas) for (const c of byArea.get(a) || []) set.add(c);
      base = [...set];
    } catch (e) {
      console.error("[clubScope] area expand failed:", e);
      base = clubCodes; // 失敗時は個別clubCodesのみ (安全側)
    }
  }
  // 明示スコープがあればそれを優先
  if (base.length > 0) return base;
  // 明示スコープ空 & 非admin: 所属グループでスコープ付与
  if (opts && opts.role !== "admin" && opts.groupIds && opts.groupIds.length > 0) {
    const g = await groupScopeClubs(opts.groupIds);
    if (g.length > 0) return g;
  }
  return base; // 空 (admin=全件は呼び出し側で解釈)
}

// 割当可能なエリア(companyGroup)一覧
export async function listAreas(): Promise<string[]> {
  try {
    return (await loadAreaMap()).areas;
  } catch {
    return [];
  }
}
