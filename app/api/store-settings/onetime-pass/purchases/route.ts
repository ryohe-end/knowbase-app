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
  rawStat?: string; // 生の ticket_stat (B=手動消し込み対象)
  paymentMethod: string;
};

export type DurationBreakdown = { durationMinutes: number; count: number; sales: number };
export type StatusBreakdown = { status: PurchaseStatus; count: number };
export type GenderBreakdown = { gender: Gender; count: number; sales: number };
// 年代内訳は男女別サブカウントを持つ (積み上げ表示用)
export type AgeBreakdown = {
  ageGroup: AgeGroup; count: number; sales: number; averageAge: number;
  male: number; female: number; other: number; unknown: number;
};
export type HourlyBreakdown = { hour: number; count: number; sales: number };
// 曜日別は購入数(count)に加えて利用数(usedCount = 実際に使われた日ベース)を持つ
export type DayOfWeekBreakdown = { dayOfWeek: number; label: string; count: number; sales: number; usedCount: number };
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

  // 年代 (男女別サブカウントも集計)
  const ageGroupOrder: AgeGroup[] = ["u20", "20s", "30s", "40s", "50s", "60plus"];
  const byAgeMap = new Map<AgeGroup, { count: number; sales: number; ageSum: number; male: number; female: number; other: number; unknown: number }>();
  purchases.forEach((p) => {
    const cur = byAgeMap.get(p.ageGroup) ?? { count: 0, sales: 0, ageSum: 0, male: 0, female: 0, other: 0, unknown: 0 };
    cur.count += 1;
    cur.sales += p.price;
    cur.ageSum += p.age;
    cur[p.gender] += 1;
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
        male: v.male, female: v.female, other: v.other, unknown: v.unknown,
      };
    });

  // 時間帯
  const byHour: HourlyBreakdown[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, sales: 0 }));
  purchases.forEach((p) => {
    const h = new Date(p.purchasedAt).getHours();
    byHour[h].count += 1;
    byHour[h].sales += p.price;
  });

  // 曜日 (購入は purchasedAt ベース / 利用は usedAt ベース)
  const byDayOfWeek: DayOfWeekBreakdown[] = DAY_LABELS.map((label, dayOfWeek) => ({ dayOfWeek, label, count: 0, sales: 0, usedCount: 0 }));
  purchases.forEach((p) => {
    const d = new Date(p.purchasedAt).getDay();
    byDayOfWeek[d].count += 1;
    byDayOfWeek[d].sales += p.price;
    if (p.usedAt) {
      const ud = new Date(p.usedAt).getDay();
      if (ud >= 0 && ud <= 6) byDayOfWeek[ud].usedCount += 1;
    }
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

  const asOf = new Date(`${to}T00:00:00Z`);
  const isJoyfit = brand.toUpperCase().startsWith("JOYFIT");
  let purchases: Purchase[];
  let source: string;

  if (isJoyfit) {
    // JOYFIT: EnjoyTimePass t1pass (Postgres)
    const sql = `
      select
        coalesce(u.name,'') as name, u.mail_address as mail, u.tel as tel,
        u.cust_code as member_code, u.sex as sex, u.birthday as birthday,
        t.max_hour as dur, t.amount as amount, t.insert_dt as purchased_at,
        t.start_dt as used_at,
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
    purchases = res.rows.map((r: any) => {
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
        usedAt: r.used_at ? new Date(r.used_at).toISOString() : null,
        status: mapTicketStatus(r.stat),
        rawStat: String(r.stat || ""), // 生の ticket_stat (消し込み対象=B の判定用)
        paymentMethod: r.pay || "—",
      };
    });
    source = "EnjoyTimePass (t1pass)";
  } else {
    // FIT365 1day: 入会DB fit365entry.one_day_ticket (MySQL)。会員は member 結合、
    // 価格は キャンペーン価格(one_day_cp_price) 優先→定価(one_day_shop_price_classification)。
    const casio6 = String(clubCode).replace(/\D/g, "").padStart(6, "0").slice(-6);
    const fromYmd = fromClamped.replace(/-/g, "");
    const toYmd = to.replace(/-/g, "");
    const sql = `
      select
        concat(t.token,'-',t.serial_number) as id,
        m.own_name_js as name, coalesce(m.pc_mail_address, m.mobile_mail_address) as mail, m.co_tel as tel,
        t.member_no as member_code, m.sex as sex, m.birthday as birthday,
        coalesce(
          (select cp.price from one_day_cp_price cp
             where cp.shop_id = t.shop_id and cp.delete_flg = 0
               and cp.cp_start_date <= t.purchase_date and cp.cp_end_date >= t.purchase_date
             order by cp.seq desc limit 1),
          cl.price) as amount,
        concat(t.purchase_date, lpad(coalesce(nullif(t.purchase_time,''),'0'),6,'0')) as purchased_at,
        case when t.use_date is not null and t.use_date<>''
             then concat(t.use_date, lpad(coalesce(nullif(t.use_time,''),'0'),6,'0')) else null end as used_at,
        t.is_expired as is_expired, t.del_flg as del_flg, t.use_date as use_date,
        (t.insert_date = (select min(t2.insert_date) from one_day_ticket t2 where t2.shop_id=t.shop_id and t2.member_no=t.member_no)) as is_first
      from one_day_ticket t
      inner join shop_convert_view spv on spv.town_shop_id = t.shop_id
      left join one_day_shop_price_classification cl on cl.shop_id = t.shop_id
      left join member m on m.shop_id = t.shop_id and m.member_no = t.member_no
      where spv.casio_shop_id = ? and t.purchase_date between ? and ? and t.del_flg = 0 and t.payment_flg = 1
      order by t.purchase_date desc, t.purchase_time desc
      limit ${LIVE_ROW_LIMIT}`;
    const res = await sshQuery(TARGET_FIT365ENTRY, sql, [casio6, fromYmd, toYmd]);
    if (!res.ok) {
      return NextResponse.json({ error: `購入データの取得に失敗しました: ${res.error}`, purchases: [], summary: emptySummary(from, to) }, { status: 502 });
    }
    purchases = res.rows.map((r: any) => {
      const age = ageFromBirthday(r.birthday, asOf);
      const used = r.use_date != null && String(r.use_date) !== "";
      const status: PurchaseStatus =
        Number(r.del_flg) === 1 ? "refunded" : used ? "used" : Number(r.is_expired) === 1 ? "expired" : "purchased";
      return {
        id: String(r.id),
        purchaserName: r.name || "—",
        purchaserEmail: r.mail || null,
        purchaserPhone: r.tel || null,
        memberCode: r.member_code != null ? String(r.member_code) : null,
        gender: r.sex === "1" ? "male" : r.sex === "2" ? "female" : "unknown",
        age,
        ageGroup: ageToGroup(age),
        isFirstPurchase: !!r.is_first,
        durationMinutes: 1440,
        price: Number(r.amount) || 0,
        purchasedAt: jst14ToIso(r.purchased_at) || "",
        usedAt: jst14ToIso(r.used_at),
        status,
        rawStat: "",
        paymentMethod: "—",
      };
    });
    source = "1dayパス (fit365entry)";
  }

  const body = {
    purchases,
    summary: buildSummary(purchases, fromClamped, to),
    isDemo: false,
    source,
    rangeClamped: fromClamped !== from,
  };
  _cache.set(cacheKey, { at: Date.now(), body });
  if (_cache.size > 200) { const oldest = [..._cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) _cache.delete(oldest[0]); }
  return NextResponse.json(body);
}

const TARGET_ONETIMEPASS = "onetimepass";
const TARGET_FIT365ENTRY = "fit365entry";

// char14 'YYYYMMDDHHMMSS'(JST壁時計) → ISO文字列。不正/空は null。
function jst14ToIso(s: any): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
// EnjoyTimePass ticket_stat の正式マッピング:
//   B=未使用 / N=未使用(購入直後・標準) / U=利用中 / Z=使用済 / E=期限切 / D=削除済
function mapTicketStatus(stat: string): PurchaseStatus {
  switch (stat) {
    case "B": case "N": return "purchased"; // 未使用
    case "U": case "Z": return "used";      // 利用中 / 使用済
    case "E": return "expired";             // 期限切
    case "D": return "refunded";            // 削除済
    default: return "purchased";
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
