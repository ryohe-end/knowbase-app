// app/api/admin/points-accounting/route.ts
//
// ポイント会計ダッシュボード(admin専用)。夜間集計 yamauchi-PointSummary(店舗×月, granted/used)を
// 全店横断で集計し、店舗別に「期間内の取得/使用」と「対象月末までの累積残高(取得−使用)」を返す。
//   GET ?from=YYYY-MM&to=YYYY-MM&brand=FIT365|JOYFIT
//     - 取得/使用 = [from..to] 合計
//     - 残高      = 期首(全期間)〜to までの Σ(granted−used) 累積 (A方式: 失効未反映の近似)
// 残高の精緻化(CPSS原資 or 真の累積)は夜間集計側で後日対応(B方式)。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { isAdminRequest } from "@/lib/auth";
import { listClubs } from "@/lib/unpaid";
import { loadClubAreaLookup } from "@/lib/clubAreas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const SUMMARY_TABLE = process.env.SUMMARY_TABLE || "yamauchi-PointSummary";
const FUND_TABLE = process.env.POINT_FUND_TABLE || "knowbie-point-fund";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// 原資(真残高) knowbie-point-fund を clubCode → {expired, balance, ...} で読む
async function loadFund(): Promise<Map<string, { issued: number; consumed: number; expired: number; balance: number; snapshotAt: string }>> {
  const out = new Map<string, any>();
  let lastKey: any = undefined;
  try {
    do {
      const res: any = await ddb.send(new ScanCommand({ TableName: FUND_TABLE, ExclusiveStartKey: lastKey }));
      for (const it of res.Items || []) {
        out.set(String(it.clubCode), {
          issued: Number(it.issued) || 0, consumed: Number(it.consumed) || 0,
          expired: Number(it.expired) || 0, balance: Number(it.balance) || 0,
          snapshotAt: String(it.snapshotAt || ""),
        });
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
  } catch (e: any) {
    console.warn("[points-accounting] fund read failed:", e?.message);
  }
  return out;
}

const CACHE_TTL_MS = 5 * 60_000;
let _cache: { at: number; items: any[] } | null = null;

function thisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// 'YYYY-MM' に delta ヶ月を足す
function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const normBrand = (b: string): "FIT365" | "JOYFIT" =>
  String(b || "").toUpperCase().startsWith("JOYFIT") ? "JOYFIT" : "FIT365";

async function loadAllSummaries(): Promise<any[]> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.items;
  const items: any[] = [];
  let lastKey: any = undefined;
  do {
    const res: any = await ddb.send(new ScanCommand({ TableName: SUMMARY_TABLE, ExclusiveStartKey: lastKey }));
    if (Array.isArray(res.Items)) items.push(...res.Items);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  _cache = { at: Date.now(), items };
  return items;
}

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const to = /^\d{4}-\d{2}$/.test(sp.get("to") || "") ? (sp.get("to") as string) : thisMonth();
  const from = /^\d{4}-\d{2}$/.test(sp.get("from") || "") ? (sp.get("from") as string) : to;
  const brandFilter = (sp.get("brand") || "").toUpperCase();

  let items: any[];
  try {
    items = await loadAllSummaries();
  } catch (e: any) {
    console.error("[points-accounting] scan error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }

  // 店舗名/ブランド/エリア/原資 の補完
  const [clubs, areaLookup, fund] = await Promise.all([
    listClubs().catch(() => [] as any[]),
    loadClubAreaLookup().catch(() => ({} as Record<string, { area: string; block: string; territory: string }>)),
    loadFund(),
  ]);
  const nameByClub = new Map<string, string>();
  const bizByClub = new Map<string, string>();
  for (const c of clubs) {
    nameByClub.set(String(c.clubCode), c.clubNameShort || c.clubName || String(c.clubCode));
    if (c.businessType) bizByClub.set(String(c.clubCode), String(c.businessType));
  }

  // 店舗ごとに: 期間内 granted/used、to まで累積残高、対象月末の会員数
  type Row = { clubCode: string; clubName: string; brand: "FIT365" | "JOYFIT"; area: string; block: string; granted: number; used: number; expired: number; balance: number; balanceSource: "fund" | "cumulative"; memberCount: number };
  const byClub = new Map<string, Row>();
  // 月次推移(全店/ブランドフィルタ後)の元データ: ym -> {granted, used}
  const monthAgg = new Map<string, { granted: number; used: number }>();
  const inBrand = (b: "FIT365" | "JOYFIT") => !(brandFilter === "FIT365" || brandFilter === "JOYFIT") || b === brandFilter;

  for (const it of items) {
    const clubCode = String(it.clubCode ?? "");
    const ym = String(it.yyyymm ?? "");
    if (!clubCode || !/^\d{4}-\d{2}$/.test(ym)) continue;
    if (ym > to) continue; // 対象月末より後は残高/推移に含めない
    const brand = normBrand(it.brand || bizByClub.get(clubCode) || "");
    if (!inBrand(brand)) continue;
    const g = num(it.granted);
    const u = num(it.used);

    // 月次推移(全期間・ブランドフィルタ後)
    const ma = monthAgg.get(ym) || { granted: 0, used: 0 };
    ma.granted += g; ma.used += u; monthAgg.set(ym, ma);

    // 店舗別
    let row = byClub.get(clubCode);
    if (!row) {
      const al = areaLookup[clubCode] || { area: "", block: "", territory: "" };
      row = { clubCode, clubName: nameByClub.get(clubCode) || clubCode, brand, area: al.area || "未分類", block: al.block || "", granted: 0, used: 0, expired: 0, balance: 0, balanceSource: "cumulative", memberCount: 0 };
      byClub.set(clubCode, row);
    }
    row.balance += g - u; // 期首〜to の累積(A方式)
    if (ym >= from && ym <= to) { row.granted += g; row.used += u; }
    if (ym === to) row.memberCount = num(it.memberCount);
  }

  // 原資(真残高 B方式)で上書き: 失効を反映し balance=発行−消費−失効 に。原資が無い店は累積(A)のまま。
  for (const row of byClub.values()) {
    const f = fund.get(row.clubCode);
    if (f) { row.expired = f.expired; row.balance = f.balance; row.balanceSource = "fund"; }
  }

  const rows = [...byClub.values()].sort((a, b) => b.balance - a.balance || a.clubCode.localeCompare(b.clubCode));

  const totals = rows.reduce(
    (t, r) => { t.granted += r.granted; t.used += r.used; t.expired += r.expired; t.balance += r.balance; return t; },
    { granted: 0, used: 0, expired: 0, balance: 0, stores: 0 }
  );
  totals.stores = rows.length;
  const fundStores = rows.filter((r) => r.balanceSource === "fund").length;

  // エリア別ロールアップ(期間内 granted/used + 失効 + 残高 + 店舗数)
  const areaMap = new Map<string, { area: string; granted: number; used: number; expired: number; balance: number; stores: number }>();
  for (const r of rows) {
    const a = areaMap.get(r.area) || { area: r.area, granted: 0, used: 0, expired: 0, balance: 0, stores: 0 };
    a.granted += r.granted; a.used += r.used; a.expired += r.expired; a.balance += r.balance; a.stores += 1;
    areaMap.set(r.area, a);
  }
  const byArea = [...areaMap.values()].sort((a, b) => b.balance - a.balance || a.area.localeCompare(b.area, "ja"));

  // 月次推移: to から遡って12ヶ月。各月の granted/used と、その月末までの累積残高。
  const monthly: { ym: string; granted: number; used: number; balance: number }[] = [];
  let running = 0;
  const start12 = addMonths(to, -11);
  // 累積残高の起点(start12より前)を先に足し込む
  for (const [ym, ma] of monthAgg) if (ym < start12) running += ma.granted - ma.used;
  for (let i = 0; i < 12; i++) {
    const ym = addMonths(start12, i);
    const ma = monthAgg.get(ym) || { granted: 0, used: 0 };
    running += ma.granted - ma.used;
    monthly.push({ ym, granted: ma.granted, used: ma.used, balance: running });
  }

  return NextResponse.json({ ok: true, from, to, brand: brandFilter || "ALL", rows, totals, byArea, monthly, fundStores, balanceMethod: fundStores > 0 ? "fund(発行-消費-失効) + cumulative fallback" : "cumulative(granted-used)" });
}
