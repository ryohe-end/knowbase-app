// app/api/admin/points-accounting/route.ts
//
// ポイント会計ダッシュボード(admin専用)。夜間集計 yamauchi-PointSummary(店舗×月, granted/used)を
// 全店横断で集計し、店舗別に「期間内の取得/使用」と「対象月末までの累積残高(取得−使用)」を返す。
//   GET ?from=YYYY-MM&to=YYYY-MM&brand=FIT365|JOYFIT
//     - 取得/使用 = [from..to] 合計
//     - 残高      = to から遡って13ヶ月の Σ(granted−used) (ローリング: CPSS失効=EXTA≈1年を近似反映)。
//                   任意月を to に選べば、その月末の失効反映残高になる(月毎の残高)。
//                   原資(knowbie-point-fund)がある店は真残高(発行−消費−失効)で上書き。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { requireAccounting } from "@/lib/accountingAuth";
import { listClubs } from "@/lib/unpaid";
import { loadClubAreaLookup } from "@/lib/clubAreas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const SUMMARY_TABLE = process.env.SUMMARY_TABLE || "yamauchi-PointSummary";
const FUND_TABLE = process.env.POINT_FUND_TABLE || "knowbie-point-fund";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// 原資(真残高) knowbie-point-fund を 対象月(yyyymm)で clubCode → {expired, balance, ...} に読む
async function loadFund(month: string): Promise<Map<string, { issued: number; consumed: number; expired: number; balance: number }>> {
  const out = new Map<string, any>();
  let lastKey: any = undefined;
  try {
    do {
      const res: any = await ddb.send(new ScanCommand({
        TableName: FUND_TABLE,
        FilterExpression: "yyyymm = :m",
        ExpressionAttributeValues: { ":m": month },
        ExclusiveStartKey: lastKey,
      }));
      for (const it of res.Items || []) {
        out.set(String(it.clubCode), {
          issued: Number(it.issued) || 0, consumed: Number(it.consumed) || 0,
          expired: Number(it.expired) || 0, balance: Number(it.balance) || 0,
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
  if (!(await requireAccounting())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const to = /^\d{4}-\d{2}$/.test(sp.get("to") || "") ? (sp.get("to") as string) : thisMonth();
  const from = /^\d{4}-\d{2}$/.test(sp.get("from") || "") ? (sp.get("from") as string) : to;
  // 残高(B方式相当): CPSSの失効=EXTA(活動から約1年ローリング)を近似するため、
  // 「to から遡って ROLLING_MONTHS ヶ月」の Σ(付与−利用) を当月末残高とみなす。
  // 古い(=失効済み)ポイントを自然に落とせ、全期間累積(A方式)の過大計上を防ぐ。
  const ROLLING_MONTHS = 13;
  const rollStart = addMonths(to, -(ROLLING_MONTHS - 1));
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
    loadFund(to),
  ]);
  const nameByClub = new Map<string, string>();
  const bizByClub = new Map<string, string>();
  for (const c of clubs) {
    nameByClub.set(String(c.clubCode), c.clubNameShort || c.clubName || String(c.clubCode));
    if (c.businessType) bizByClub.set(String(c.clubCode), String(c.businessType));
  }

  // 店舗ごとに: 期間内 granted/used、to まで累積残高、対象月末の会員数
  type Row = { clubCode: string; clubName: string; brand: "FIT365" | "JOYFIT"; area: string; block: string; granted: number; used: number; expired: number; balance: number; balanceTotal: number; balanceWithdrawn: number; balanceSource: "exta_active" | "fund" | "rolling" | "active" | "true"; memberCount: number; activeMembers?: number | null; balActive?: number | null; balTrue?: number | null; balTrueAt?: string | null; balExtaActive?: number | null; balExtaTotal?: number | null };
  const byClub = new Map<string, Row>();
  // 月次推移(全店/ブランドフィルタ後)の元データ: ym -> {granted, used, balActive合計, balActiveあり, balExtaActive合計, hasExta}
  const monthAgg = new Map<string, { granted: number; used: number; balActive: number; hasActive: boolean; balExtaActive: number; hasExta: boolean }>();
  // 月×店 残高マトリクス用: clubCode -> ym -> {g,u,ba,bxa}
  const clubMonth = new Map<string, Map<string, { g: number; u: number; ba: number | null; bxa: number | null }>>();
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

    // balanceActive(退会者除外の旧ローリング。フォールバック用)
    const baRaw = (it as any).balanceActive;
    const ba = baRaw != null && Number.isFinite(Number(baRaw)) ? Number(baRaw) : null;
    // EXTA正方式(2026-09-18): balanceExtaActive=在籍会員のみ残高(退会者除外・最優先)、balanceExta=総額(退会含む)
    const bxaRaw = (it as any).balanceExtaActive;
    const bxa = bxaRaw != null && Number.isFinite(Number(bxaRaw)) ? Math.max(0, Number(bxaRaw)) : null;
    const bxtRaw = (it as any).balanceExta;
    const bxt = bxtRaw != null && Number.isFinite(Number(bxtRaw)) ? Math.max(0, Number(bxtRaw)) : null;

    // 月次推移(全期間・ブランドフィルタ後)。EXTA在籍のみ>balActive を優先。
    const ma = monthAgg.get(ym) || { granted: 0, used: 0, balActive: 0, hasActive: false, balExtaActive: 0, hasExta: false };
    ma.granted += g; ma.used += u;
    if (ba != null) { ma.balActive += ba; ma.hasActive = true; }
    if (bxa != null) { ma.balExtaActive += bxa; ma.hasExta = true; }
    monthAgg.set(ym, ma);

    // 月×店 マトリクス用
    let cm = clubMonth.get(clubCode);
    if (!cm) { cm = new Map(); clubMonth.set(clubCode, cm); }
    cm.set(ym, { g, u, ba, bxa });

    // 店舗別
    let row = byClub.get(clubCode);
    if (!row) {
      const al = areaLookup[clubCode] || { area: "", block: "", territory: "" };
      row = { clubCode, clubName: nameByClub.get(clubCode) || clubCode, brand, area: al.area || "未分類", block: al.block || "", granted: 0, used: 0, expired: 0, balance: 0, balanceTotal: 0, balanceWithdrawn: 0, balanceSource: "rolling", memberCount: 0, activeMembers: null, balActive: null, balTrue: null, balTrueAt: null, balExtaActive: null, balExtaTotal: null };
      byClub.set(clubCode, row);
    }
    if (ym >= rollStart && ym <= to) row.balance += g - u; // フォールバック用: 直近13ヶ月Σ(付与−利用)
    if (ym >= from && ym <= to) { row.granted += g; row.used += u; }
    if (ym === to) {
      row.memberCount = num(it.memberCount);
      row.activeMembers = (it as any).activeMembers != null ? num((it as any).activeMembers) : null;
      row.balActive = ba; // 対象月末のbalanceActive(旧ローリング)
      row.balExtaActive = bxa; // 対象月末の在籍のみ残高(EXTA正方式)
      row.balExtaTotal = bxt;  // 総額(退会含む)
      const bt = (it as any).balanceTrue; // オンデマンド真残高(現在月のみ)
      if (bt != null && Number.isFinite(Number(bt))) { row.balTrue = Number(bt); row.balTrueAt = (it as any).balanceTrueAt ?? null; }
      const exRaw = (it as any).expiredExta;
      if (exRaw != null && Number.isFinite(Number(exRaw)) && bxa != null) row.expired = Math.round(Number(exRaw));
    }
  }

  // 残高の確定: EXTA在籍のみ(退会者除外)を最優先 → 真残高 → 退会者除外ローリング → 原資 → ローリング総額。
  const clampNonNeg = (n: number) => (n < 0 ? 0 : n);
  for (const row of byClub.values()) {
    if (row.balExtaActive != null) {
      row.balance = clampNonNeg(row.balExtaActive);           // 在籍のみ(経理の現役負債)
      row.balanceTotal = clampNonNeg(row.balExtaTotal ?? row.balExtaActive); // 総額(退会含む)
      row.balanceWithdrawn = clampNonNeg(row.balanceTotal - row.balance);    // 退会者ぶん
      row.balanceSource = "exta_active"; continue;
    }
    if (row.balTrue != null) { row.balance = row.balTrue; row.balanceTotal = row.balTrue; row.balanceSource = "true"; continue; }
    if (row.balActive != null) { row.balance = clampNonNeg(row.balActive); row.balanceTotal = row.balance; row.balanceSource = "active"; continue; }
    const f = fund.get(row.clubCode);
    if (f) { row.expired = f.expired; row.balance = f.balance; row.balanceTotal = f.balance; row.balanceSource = "fund"; continue; }
    row.balance = clampNonNeg(row.balance); row.balanceTotal = row.balance; // ローリング総額フォールバック
  }

  const rows = [...byClub.values()].sort((a, b) => b.balance - a.balance || a.clubCode.localeCompare(b.clubCode));

  const totals = rows.reduce(
    (t, r) => { t.granted += r.granted; t.used += r.used; t.expired += r.expired; t.balance += r.balance; t.balanceTotal += r.balanceTotal; t.balanceWithdrawn += r.balanceWithdrawn; return t; },
    { granted: 0, used: 0, expired: 0, balance: 0, balanceTotal: 0, balanceWithdrawn: 0, stores: 0 }
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

  // 月次推移: to から遡って12ヶ月。各月の granted/used と、その月末の残高。
  // 残高はその月に balanceActive(退会者除外)があればそれを優先、無ければ「その月から遡って13ヶ月のΣ(granted−used)」。
  const monthly: { ym: string; granted: number; used: number; balance: number }[] = [];
  const start12 = addMonths(to, -11);
  for (let i = 0; i < 12; i++) {
    const ym = addMonths(start12, i);
    const ma = monthAgg.get(ym) || { granted: 0, used: 0, balActive: 0, hasActive: false, balExtaActive: 0, hasExta: false };
    let bal;
    if (ma.hasExta) {
      bal = ma.balExtaActive; // EXTA在籍のみ(集計側 balanceExtaActive の全店合計)
    } else if (ma.hasActive) {
      bal = ma.balActive; // 旧: 退会者除外ローリング
    } else {
      const rs = addMonths(ym, -(ROLLING_MONTHS - 1));
      bal = 0;
      for (const [k, v] of monthAgg) if (k >= rs && k <= ym) bal += v.granted - v.used;
    }
    monthly.push({ ym, granted: ma.granted, used: ma.used, balance: clampNonNeg(bal) });
  }

  const activeStores = rows.filter((r) => r.balanceSource === "active").length;
  const trueStores = rows.filter((r) => r.balanceSource === "true").length;

  // 月×店 残高マトリクス(?matrix=1)。[from..to] の各月について、店ごとの残高を返す。
  // 残高 = その月に balanceActive(退会者除外)があればそれ(0丸め)、無ければ13ヶ月ローリング(0丸め)。
  if (new URL(req.url).searchParams.get("matrix") === "1") {
    const monthsCols: string[] = [];
    for (let m = from; m <= to; m = addMonths(m, 1)) monthsCols.push(m);
    const matrixRows = [...byClub.values()].sort((a, b) => a.clubCode.localeCompare(b.clubCode)).map((r) => {
      const cm = clubMonth.get(r.clubCode);
      const balances: Record<string, number | null> = {};
      for (const M of monthsCols) {
        if (!cm) { balances[M] = null; continue; }
        const cur = cm.get(M);
        if (cur?.bxa != null) { balances[M] = clampNonNeg(cur.bxa); continue; } // EXTA在籍のみ(最優先)
        if (cur?.ba != null) { balances[M] = clampNonNeg(cur.ba); continue; } // 旧: 退会者除外ローリング
        // フォールバック: 直近13ヶ月ローリング(その店のΣ(g-u))
        const rs = addMonths(M, -(ROLLING_MONTHS - 1));
        let bal = 0, seen = false;
        for (let k = rs; k <= M; k = addMonths(k, 1)) { const v = cm.get(k); if (v) { bal += v.g - v.u; seen = true; } }
        balances[M] = seen ? clampNonNeg(bal) : null; // データが全く無い月は空
      }
      return { clubCode: r.clubCode, clubName: r.clubName, brand: r.brand, area: r.area, balances };
    });
    return NextResponse.json({ ok: true, from, to, brand: brandFilter || "ALL", matrix: { months: monthsCols, rows: matrixRows }, note: "残高=EXTA在籍のみ(退会者除外)優先/無い月は旧ローリング・マイナスは0丸め" });
  }

  const extaActiveStores = rows.filter((r) => r.balanceSource === "exta_active").length;
  const balanceMethod = extaActiveStores > 0
    ? "EXTA在籍のみ(退会者除外・真残高に収束) 優先 → 真残高 → 旧ローリング → fund → 13ヶ月ローリング"
    : "真残高(オンデマンド) 優先 → 退会者除外ローリング(0丸め) → fund → 13ヶ月ローリング";
  return NextResponse.json({ ok: true, from, to, brand: brandFilter || "ALL", rows, totals, byArea, monthly, fundStores, activeStores, trueStores, extaActiveStores, balanceMethod });
}
