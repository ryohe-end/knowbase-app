// app/api/store-settings/onetime-pass/purchases/route.ts
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { sshQuery } from "@/lib/sshDbProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// あちらの本番DBへの負荷対策: 単一店舗・期間上限・短TTLキャッシュ。
const LIVE_MAX_DAYS = 92;               // ライブ明細取得の期間上限
const LIVE_ROW_LIMIT = 5000;
const CACHE_TTL_MS = 5 * 60_000;        // 5分
const _cache = new Map<string, { at: number; body: any }>();
function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}
function clampFrom(from: string, to: string): string {
  if (daysBetween(from, to) <= LIVE_MAX_DAYS) return from;
  const d = new Date(to + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - LIVE_MAX_DAYS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type PurchaseStatus = "purchased" | "used" | "expired" | "refunded";
export type Gender = "male" | "female" | "other" | "unknown";
export type AgeGroup = "u20" | "20s" | "30s" | "40s" | "50s" | "60plus";

export type Purchase = {
  id: string;
  purchaserName: string;
  purchaserEmail: string | null;
  purchaserPhone: string | null;
  memberCode: string | null;
  gender: Gender;
  age: number;
  ageGroup: AgeGroup;
  isFirstPurchase: boolean;
  durationMinutes: number;
  price: number;
  purchasedAt: string;
  usedAt: string | null;
  status: PurchaseStatus;
  paymentMethod: string;
};

export type DurationBreakdown = { durationMinutes: number; count: number; sales: number };
export type StatusBreakdown = { status: PurchaseStatus; count: number };
export type GenderBreakdown = { gender: Gender; count: number; sales: number };
export type AgeBreakdown = { ageGroup: AgeGroup; count: number; sales: number; averageAge: number };
export type HourlyBreakdown = { hour: number; count: number; sales: number };
export type DayOfWeekBreakdown = { dayOfWeek: number; label: string; count: number; sales: number };
export type TopCustomer = {
  memberCode: string | null;
  memberName: string;
  purchaseCount: number;
  totalSales: number;
  lastPurchasedAt: string;
};

export type PurchaseSummary = {
  rangeFrom: string;
  rangeTo: string;
  totalCount: number;
  totalSales: number;
  averagePrice: number;
  uniqueCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  repeatRate: number;          // %
  byDuration: DurationBreakdown[];
  byStatus: StatusBreakdown[];
  byGender: GenderBreakdown[];
  byAgeGroup: AgeBreakdown[];
  byHour: HourlyBreakdown[];
  byDayOfWeek: DayOfWeekBreakdown[];
  topCustomers: TopCustomer[];
};

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function ageToGroup(age: number): AgeGroup {
  if (age < 20) return "u20";
  if (age < 30) return "20s";
  if (age < 40) return "30s";
  if (age < 50) return "40s";
  if (age < 60) return "50s";
  return "60plus";
}

function emptySummary(rangeFrom: string, rangeTo: string): PurchaseSummary {
  return {
    rangeFrom,
    rangeTo,
    totalCount: 0,
    totalSales: 0,
    averagePrice: 0,
    uniqueCustomers: 0,
    newCustomers: 0,
    returningCustomers: 0,
    repeatRate: 0,
    byDuration: [],
    byStatus: [],
    byGender: [],
    byAgeGroup: [],
    byHour: [],
    byDayOfWeek: [],
    topCustomers: [],
  };
}

// --- デモデータ生成 ---
function generateDemoData(clubCode: string, brand: string): Purchase[] {
  const isJoyfit = brand?.toUpperCase().startsWith("JOYFIT");
  const durations = isJoyfit ? [30, 60, 90, 120, 150, 180, 210] : [1440];
  const priceFor: Record<number, number> = isJoyfit
    ? { 30: 500, 60: 900, 90: 1300, 120: 1700, 150: 2000, 180: 2300, 210: 2500 }
    : { 1440: 1000 };

  // 会員プール (一部は複数回購入する → リピーター)
  let seed = clubCode.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const firstNames = ["太郎", "花子", "一郎", "美咲", "健太", "さくら", "真司", "由美", "翔", "美奈", "拓海", "彩花", "智也", "麻衣", "悠斗", "千尋", "陸", "結衣", "蓮", "あかり"];
  const lastNames = ["山田", "佐藤", "鈴木", "田中", "高橋", "伊藤", "渡辺", "中村", "小林", "加藤", "吉田", "山本", "斉藤", "松本", "井上"];

  const poolSize = 36;
  const memberPool: { memberCode: string; memberName: string; gender: Gender; age: number; phone: string | null; email: string | null }[] = [];
  for (let i = 0; i < poolSize; i++) {
    const g = rand();
    const gender: Gender = g < 0.45 ? "male" : g < 0.93 ? "female" : g < 0.97 ? "other" : "unknown";
    // 年齢: 16〜75 を非正規分布で
    const age = Math.round(18 + Math.pow(rand(), 1.6) * 55);
    memberPool.push({
      memberCode: `M${String(10000 + i * 7 + Math.floor(rand() * 100)).padStart(6, "0")}`,
      memberName: `${lastNames[Math.floor(rand() * lastNames.length)]} ${firstNames[Math.floor(rand() * firstNames.length)]}`,
      gender,
      age,
      phone: rand() > 0.4 ? `090-${String(1000 + Math.floor(rand() * 9000))}-${String(1000 + Math.floor(rand() * 9000))}` : null,
      email: rand() > 0.3 ? `user${i}@example.com` : null,
    });
  }
  // ゲスト (会員以外) も少し
  const guestPoolSize = 6;
  for (let i = 0; i < guestPoolSize; i++) {
    const g = rand();
    const gender: Gender = g < 0.45 ? "male" : g < 0.93 ? "female" : "unknown";
    const age = Math.round(18 + rand() * 55);
    memberPool.push({
      memberCode: "",
      memberName: `ゲスト ${lastNames[Math.floor(rand() * lastNames.length)]}`,
      gender,
      age,
      phone: null,
      email: null,
    });
  }

  const statuses: PurchaseStatus[] = ["used", "used", "used", "used", "purchased", "purchased", "expired", "refunded"];
  const purchaseCount = 110; // 90日で110件程度

  const now = new Date();
  const rawPurchases: Purchase[] = [];
  for (let i = 0; i < purchaseCount; i++) {
    // 日付分布: 直近寄り (約90日)
    const daysAgo = Math.floor(Math.pow(rand(), 1.4) * 90);
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    // 時間: 朝/昼/夕ピーク
    const hr = rand();
    const hour =
      hr < 0.10 ? 6 + Math.floor(rand() * 4)        // 朝 6-10
      : hr < 0.25 ? 10 + Math.floor(rand() * 4)     // 昼前 10-14
      : hr < 0.40 ? 14 + Math.floor(rand() * 3)     // 昼過ぎ
      : hr < 0.85 ? 17 + Math.floor(rand() * 4)     // 夕ピーク 17-21
      : 21 + Math.floor(rand() * 2);                // 夜
    date.setHours(hour, Math.floor(rand() * 60), 0, 0);

    // 会員選択: リピート傾向のため一部に偏り
    const popularBias = Math.floor(Math.pow(rand(), 2) * memberPool.length);
    const member = memberPool[popularBias];

    const duration = durations[Math.floor(rand() * durations.length)];
    const status = statuses[Math.floor(rand() * statuses.length)];
    const usedAt =
      status === "used"
        ? new Date(date.getTime() + Math.floor(rand() * 6) * 3600 * 1000).toISOString()
        : null;

    rawPurchases.push({
      id: `demo-${clubCode}-${i}`,
      purchaserName: member.memberName,
      purchaserEmail: member.email,
      purchaserPhone: member.phone,
      memberCode: member.memberCode || null,
      gender: member.gender,
      age: member.age,
      ageGroup: ageToGroup(member.age),
      isFirstPurchase: false, // あとで計算
      durationMinutes: duration,
      price: priceFor[duration],
      purchasedAt: date.toISOString(),
      usedAt,
      status,
      paymentMethod: rand() > 0.4 ? "クレジットカード" : "店頭決済",
    });
  }

  // isFirstPurchase の計算: メンバー別に最古の購入を true に
  const earliestByMember = new Map<string, string>();
  for (const p of rawPurchases) {
    const key = p.memberCode ?? `name:${p.purchaserName}`;
    const prev = earliestByMember.get(key);
    if (!prev || p.purchasedAt < prev) earliestByMember.set(key, p.purchasedAt);
  }
  for (const p of rawPurchases) {
    const key = p.memberCode ?? `name:${p.purchaserName}`;
    if (earliestByMember.get(key) === p.purchasedAt) p.isFirstPurchase = true;
  }

  rawPurchases.sort((a, b) => (a.purchasedAt > b.purchasedAt ? -1 : 1));
  return rawPurchases;
}

function filterByRange(purchases: Purchase[], from: string, to: string): Purchase[] {
  // from/to は YYYY-MM-DD。to は当日 23:59:59 まで含む
  const fromIso = `${from}T00:00:00`;
  const toIso = `${to}T23:59:59`;
  return purchases.filter((p) => p.purchasedAt >= fromIso && p.purchasedAt <= toIso);
}

function buildSummary(purchases: Purchase[], rangeFrom: string, rangeTo: string): PurchaseSummary {
  const totalCount = purchases.length;
  const totalSales = purchases.reduce((s, p) => s + p.price, 0);
  const averagePrice = totalCount > 0 ? Math.round(totalSales / totalCount) : 0;

  // 期間別 (期間: durationMinutes)
  const byDurMap = new Map<number, { count: number; sales: number }>();
  purchases.forEach((p) => {
    const cur = byDurMap.get(p.durationMinutes) ?? { count: 0, sales: 0 };
    cur.count += 1;
    cur.sales += p.price;
    byDurMap.set(p.durationMinutes, cur);
  });
  const byDuration: DurationBreakdown[] = [...byDurMap.entries()]
    .map(([durationMinutes, v]) => ({ durationMinutes, ...v }))
    .sort((a, b) => a.durationMinutes - b.durationMinutes);

  // ステータス
  const byStatusMap = new Map<PurchaseStatus, number>();
  purchases.forEach((p) => byStatusMap.set(p.status, (byStatusMap.get(p.status) ?? 0) + 1));
  const byStatus: StatusBreakdown[] = [...byStatusMap.entries()].map(([status, count]) => ({ status, count }));

  // 性別
  const byGenderMap = new Map<Gender, { count: number; sales: number }>();
  purchases.forEach((p) => {
    const cur = byGenderMap.get(p.gender) ?? { count: 0, sales: 0 };
    cur.count += 1;
    cur.sales += p.price;
    byGenderMap.set(p.gender, cur);
  });
  const byGender: GenderBreakdown[] = (["male", "female", "other", "unknown"] as Gender[])
    .filter((g) => byGenderMap.has(g))
    .map((gender) => ({ gender, ...byGenderMap.get(gender)! }));

  // 年代
  const ageGroupOrder: AgeGroup[] = ["u20", "20s", "30s", "40s", "50s", "60plus"];
  const byAgeMap = new Map<AgeGroup, { count: number; sales: number; ageSum: number }>();
  purchases.forEach((p) => {
    const cur = byAgeMap.get(p.ageGroup) ?? { count: 0, sales: 0, ageSum: 0 };
    cur.count += 1;
    cur.sales += p.price;
    cur.ageSum += p.age;
    byAgeMap.set(p.ageGroup, cur);
  });
  const byAgeGroup: AgeBreakdown[] = ageGroupOrder
    .filter((ag) => byAgeMap.has(ag))
    .map((ageGroup) => {
      const v = byAgeMap.get(ageGroup)!;
      return {
        ageGroup,
        count: v.count,
        sales: v.sales,
        averageAge: v.count > 0 ? Math.round(v.ageSum / v.count) : 0,
      };
    });

  // 時間帯
  const byHour: HourlyBreakdown[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, sales: 0 }));
  purchases.forEach((p) => {
    const h = new Date(p.purchasedAt).getHours();
    byHour[h].count += 1;
    byHour[h].sales += p.price;
  });

  // 曜日
  const byDayOfWeek: DayOfWeekBreakdown[] = DAY_LABELS.map((label, dayOfWeek) => ({ dayOfWeek, label, count: 0, sales: 0 }));
  purchases.forEach((p) => {
    const d = new Date(p.purchasedAt).getDay();
    byDayOfWeek[d].count += 1;
    byDayOfWeek[d].sales += p.price;
  });

  // 顧客分析
  const memberMap = new Map<string, { memberCode: string | null; memberName: string; count: number; sales: number; first: string; last: string }>();
  purchases.forEach((p) => {
    const key = p.memberCode ?? `name:${p.purchaserName}`;
    const cur = memberMap.get(key);
    if (cur) {
      cur.count += 1;
      cur.sales += p.price;
      if (p.purchasedAt < cur.first) cur.first = p.purchasedAt;
      if (p.purchasedAt > cur.last) cur.last = p.purchasedAt;
    } else {
      memberMap.set(key, {
        memberCode: p.memberCode,
        memberName: p.purchaserName,
        count: 1,
        sales: p.price,
        first: p.purchasedAt,
        last: p.purchasedAt,
      });
    }
  });
  const uniqueCustomers = memberMap.size;
  // 期間内で初購入扱い = isFirstPurchase が true
  const newCustomers = purchases.filter((p) => p.isFirstPurchase).length;
  const returningCustomers = uniqueCustomers - newCustomers;
  const repeatRate = uniqueCustomers > 0
    ? Math.round((returningCustomers / uniqueCustomers) * 100)
    : 0;

  // トップ顧客
  const topCustomers: TopCustomer[] = [...memberMap.values()]
    .sort((a, b) => (b.sales - a.sales) || (b.count - a.count))
    .slice(0, 5)
    .map((m) => ({
      memberCode: m.memberCode,
      memberName: m.memberName,
      purchaseCount: m.count,
      totalSales: m.sales,
      lastPurchasedAt: m.last,
    }));

  return {
    rangeFrom,
    rangeTo,
    totalCount,
    totalSales,
    averagePrice,
    uniqueCustomers,
    newCustomers,
    returningCustomers,
    repeatRate,
    byDuration,
    byStatus,
    byGender,
    byAgeGroup,
    byHour,
    byDayOfWeek,
    topCustomers,
  };
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const fromD = new Date(now);
  fromD.setDate(fromD.getDate() - 29);
  const from = `${fromD.getFullYear()}-${String(fromD.getMonth() + 1).padStart(2, "0")}-${String(fromD.getDate()).padStart(2, "0")}`;
  return { from, to };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clubCode = searchParams.get("clubCode");
  const brand = searchParams.get("brand") ?? "";
  const demo = searchParams.get("demo");
  const def = defaultRange();
  const from = searchParams.get("from") || def.from;
  const to = searchParams.get("to") || def.to;

  if (!clubCode) {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }

  if (demo === "1") {
    const allPurchases = generateDemoData(clubCode, brand);
    const filtered = filterByRange(allPurchases, from, to);
    return NextResponse.json({
      purchases: filtered,
      summary: buildSummary(filtered, from, to),
      isDemo: true,
    });
  }

  // --- 実データ (EnjoyTimePass t1pass: ticket_tbl + user_tbl) ---
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^\d+$/.test(clubCode)) return NextResponse.json({ error: "clubCode invalid" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) {
    return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
  }

  // 期間上限で丸め、短TTLキャッシュ(店舗×期間)で相手DBの反復読取を抑制
  const fromClamped = clampFrom(from, to);
  const cacheKey = `${clubCode}|${fromClamped}|${to}`;
  const hit = _cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.body, cached: true });
  }

  const sql = `
    select
      coalesce(u.name,'') as name, u.mail_address as mail, u.tel as tel,
      u.cust_code as member_code, u.sex as sex, u.birthday as birthday,
      t.max_hour as dur, t.amount as amount, t.insert_dt as purchased_at,
      t.ticket_stat as stat, t.res_pay_method as pay,
      coalesce(t.order_id, t.seq::text) as id,
      (t.insert_dt = (select min(t2.insert_dt) from t1pass.ticket_tbl t2 where t2.access_key = t.access_key)) as is_first
    from t1pass.ticket_tbl t
    left join t1pass.user_tbl u on u.access_key = t.access_key
    where t.club_cd = $1 and t.insert_dt >= $2::date and t.insert_dt < ($3::date + interval '1 day')
    order by t.insert_dt desc
    limit ${LIVE_ROW_LIMIT}`;
  const res = await sshQuery(TARGET_ONETIMEPASS, sql, [Number(clubCode), fromClamped, to]);
  if (!res.ok) {
    return NextResponse.json({ error: `購入データの取得に失敗しました: ${res.error}`, purchases: [], summary: emptySummary(from, to) }, { status: 502 });
  }
  const asOf = new Date(`${to}T00:00:00Z`);
  const purchases: Purchase[] = res.rows.map((r: any) => {
    const age = ageFromBirthday(r.birthday, asOf);
    return {
      id: String(r.id),
      purchaserName: r.name || "—",
      purchaserEmail: r.mail || null,
      purchaserPhone: r.tel || null,
      memberCode: r.member_code ? String(r.member_code) : null,
      gender: r.sex === "1" ? "male" : r.sex === "2" ? "female" : "unknown",
      age,
      ageGroup: ageToGroup(age),
      isFirstPurchase: !!r.is_first,
      durationMinutes: Number(r.dur) || 0,
      price: Number(r.amount) || 0,
      purchasedAt: r.purchased_at ? new Date(r.purchased_at).toISOString() : "",
      usedAt: null,
      status: mapTicketStatus(r.stat),
      paymentMethod: r.pay || "—",
    };
  });
  const body = {
    purchases,
    summary: buildSummary(purchases, fromClamped, to),
    isDemo: false,
    source: "EnjoyTimePass (t1pass)",
    rangeClamped: fromClamped !== from,
  };
  _cache.set(cacheKey, { at: Date.now(), body });
  if (_cache.size > 200) { const oldest = [..._cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) _cache.delete(oldest[0]); }
  return NextResponse.json(body);
}

const TARGET_ONETIMEPASS = "onetimepass";
function mapTicketStatus(stat: string): PurchaseStatus {
  switch (stat) {
    case "Z": case "U": return "used";
    case "E": return "expired";
    case "B": case "D": return "refunded";
    default: return "purchased"; // N 等
  }
}
function ageFromBirthday(birthday: any, asOf: Date): number {
  const v = birthday == null ? "" : String(birthday);
  if (!/^\d{8}$/.test(v)) return 0;
  const y = Number(v.slice(0, 4)), m = Number(v.slice(4, 6)), d = Number(v.slice(6, 8));
  if (!y || y < 1900) return 0;
  let age = asOf.getUTCFullYear() - y;
  const mo = asOf.getUTCMonth() + 1 - m;
  if (mo < 0 || (mo === 0 && asOf.getUTCDate() < d)) age -= 1;
  return age >= 0 && age < 120 ? age : 0;
}
