// lib/unpaid.ts
// 未納管理: member-search(Oracle/振替契約別) 呼び出し + knowbie-clubs 辞書。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";
const CLUBS_TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const CLUBS_REGION = process.env.CLUBS_REGION || "us-east-1";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: CLUBS_REGION }));

export interface ClubDir {
  clubCode: string;
  clubName: string;
  companyGroup: string; // エリア (EAST/WEST/NORTH/SOUTH/FC(EAST)...)
  businessType: string; // ブランド (FIT365/赤/青...)
}

let _clubsCache: { at: number; clubs: ClubDir[] } | null = null;

export async function listClubs(): Promise<ClubDir[]> {
  if (_clubsCache && Date.now() - _clubsCache.at < 5 * 60_000) return _clubsCache.clubs;
  const out: ClubDir[] = [];
  let ExclusiveStartKey: any = undefined;
  do {
    const res: any = await ddb.send(new ScanCommand({
      TableName: CLUBS_TABLE,
      ProjectionExpression: "clubCode, clubName, companyGroup, businessType",
      ExclusiveStartKey,
    }));
    for (const it of res.Items ?? []) {
      if (!it.clubCode) continue;
      out.push({
        clubCode: String(it.clubCode),
        clubName: it.clubName || it.clubCode,
        companyGroup: it.companyGroup || "",
        businessType: it.businessType || "",
      });
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  _clubsCache = { at: Date.now(), clubs: out };
  return out;
}

// member-search Lambda を叩く。GET {API_BASE}/members/search?type=...
export async function callMemberSearch(params: Record<string, string>): Promise<any> {
  if (!API_BASE || !API_KEY) throw new Error("member_search_api_not_configured");
  const url = new URL(`${API_BASE}/members/search`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { "x-api-key": API_KEY }, cache: "no-store" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`member_search ${res.status}: ${t.slice(0, 120)}`);
  }
  return res.json();
}

// ユーザースコープ + フィルタ から対象クラブコードを解決。
// clubCodes(empty=全)。admin(clubCodes空) は全クラブ可。
export async function resolveClubCodes(opts: {
  scope: string[];            // user.clubCodes (空=全)
  clubCode?: string | null;   // 単一クラブ指定
  group?: string | null;      // エリア(companyGroup)
  brand?: string | null;      // ブランド(businessType)
}): Promise<{ clubCodes: string[]; clubs: ClubDir[] }> {
  const all = await listClubs();
  const inScope = (code: string) => opts.scope.length === 0 || opts.scope.includes(code);
  let clubs = all.filter((c) => inScope(c.clubCode));
  if (opts.clubCode) clubs = clubs.filter((c) => c.clubCode === opts.clubCode);
  if (opts.group) clubs = clubs.filter((c) => c.companyGroup === opts.group);
  if (opts.brand) clubs = clubs.filter((c) => c.businessType === opts.brand);
  return { clubCodes: clubs.map((c) => c.clubCode), clubs };
}
