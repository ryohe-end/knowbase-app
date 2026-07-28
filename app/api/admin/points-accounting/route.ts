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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const SUMMARY_TABLE = process.env.SUMMARY_TABLE || "yamauchi-PointSummary";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

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

  // 店舗名/ブランドの補完
  const clubs = await listClubs().catch(() => [] as any[]);
  const nameByClub = new Map<string, string>();
  const bizByClub = new Map<string, string>();
  for (const c of clubs) {
    nameByClub.set(String(c.clubCode), c.clubNameShort || c.clubName || String(c.clubCode));
    if (c.businessType) bizByClub.set(String(c.clubCode), String(c.businessType));
  }

  // 店舗ごとに: 期間内 granted/used、to まで累積残高、対象月末の会員数
  type Row = { clubCode: string; clubName: string; brand: "FIT365" | "JOYFIT"; granted: number; used: number; balance: number; memberCount: number };
  const byClub = new Map<string, Row>();
  for (const it of items) {
    const clubCode = String(it.clubCode ?? "");
    const ym = String(it.yyyymm ?? "");
    if (!clubCode || !/^\d{4}-\d{2}$/.test(ym)) continue;
    if (ym > to) continue; // 対象月末より後は残高に含めない
    const brand = normBrand(it.brand || bizByClub.get(clubCode) || "");
    let row = byClub.get(clubCode);
    if (!row) {
      row = { clubCode, clubName: nameByClub.get(clubCode) || clubCode, brand, granted: 0, used: 0, balance: 0, memberCount: 0 };
      byClub.set(clubCode, row);
    }
    const g = num(it.granted);
    const u = num(it.used);
    row.balance += g - u; // 期首〜to の累積
    if (ym >= from && ym <= to) {
      row.granted += g;
      row.used += u;
    }
    if (ym === to) row.memberCount = num(it.memberCount);
  }

  let rows = [...byClub.values()];
  if (brandFilter === "FIT365" || brandFilter === "JOYFIT") {
    rows = rows.filter((r) => r.brand === brandFilter);
  }
  rows.sort((a, b) => b.balance - a.balance || a.clubCode.localeCompare(b.clubCode));

  const totals = rows.reduce(
    (t, r) => { t.granted += r.granted; t.used += r.used; t.balance += r.balance; return t; },
    { granted: 0, used: 0, balance: 0, stores: 0 }
  );
  totals.stores = rows.length;

  return NextResponse.json({ ok: true, from, to, brand: brandFilter || "ALL", rows, totals, balanceMethod: "cumulative(granted-used)" });
}
