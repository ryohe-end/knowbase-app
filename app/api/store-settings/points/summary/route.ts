// app/api/store-settings/points/summary/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PointTxType = "earned" | "used" | "expired" | "adjusted" | "refunded";

export type RecentTransaction = {
  id: string;
  memberCode: string;
  memberName: string;
  type: PointTxType;
  points: number;
  occurredAt: string;
  source: string;
};

export type DailyTrendPoint = {
  date: string;
  earned: number;
  used: number;
};

export type TypeBreakdown = {
  type: PointTxType;
  count: number;
  total: number;
};

export type TopMember = {
  memberCode: string;
  memberName: string;
  balance: number;
};

export type PointsSummary = {
  totalMembers: number;
  totalActiveBalance: number;
  expiringNextMonth: number;
  thisMonthEarned: number;
  thisMonthUsed: number;
  thisMonthExpired: number;
  todayTransactions: number;
  todayEarned: number;
  todayUsed: number;
  byType: TypeBreakdown[];
  dailyTrend: DailyTrendPoint[];
  topMembers: TopMember[];
  recentTransactions: RecentTransaction[];
};

function emptySummary(): PointsSummary {
  return {
    totalMembers: 0,
    totalActiveBalance: 0,
    expiringNextMonth: 0,
    thisMonthEarned: 0,
    thisMonthUsed: 0,
    thisMonthExpired: 0,
    todayTransactions: 0,
    todayEarned: 0,
    todayUsed: 0,
    byType: [],
    dailyTrend: [],
    topMembers: [],
    recentTransactions: [],
  };
}

function generateDemoSummary(clubCode: string): PointsSummary {
  let seed = clubCode.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const names = ["山田 太郎", "佐藤 花子", "鈴木 一郎", "田中 美咲", "高橋 健太", "伊藤 さくら", "渡辺 真司", "中村 由美", "小林 翔", "加藤 美奈"];
  const sources = ["店舗利用", "キャンペーン", "新規入会ボーナス", "ポイント交換", "友達紹介", "誕生月ボーナス"];
  const types: PointTxType[] = ["earned", "earned", "earned", "used", "used", "expired"];

  // 直近14日のトレンド
  const now = new Date();
  const dailyTrend: DailyTrendPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    dailyTrend.push({
      date,
      earned: Math.floor(rand() * 1500) + 500,
      used: Math.floor(rand() * 1000) + 200,
    });
  }

  // 直近トランザクション
  const recentTransactions: RecentTransaction[] = [];
  for (let i = 0; i < 8; i++) {
    const hoursAgo = Math.floor(rand() * 72);
    const occurred = new Date(now.getTime() - hoursAgo * 3600 * 1000);
    const type = types[Math.floor(rand() * types.length)];
    const basePoints = Math.floor(rand() * 500) + 50;
    recentTransactions.push({
      id: `demo-tx-${clubCode}-${i}`,
      memberCode: `M${String(10000 + Math.floor(rand() * 9000)).padStart(6, "0")}`,
      memberName: names[Math.floor(rand() * names.length)],
      type,
      points: type === "earned" || type === "adjusted" ? basePoints : -basePoints,
      occurredAt: occurred.toISOString(),
      source: sources[Math.floor(rand() * sources.length)],
    });
  }
  recentTransactions.sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : 1));

  // トップ会員
  const topMembers: TopMember[] = [];
  for (let i = 0; i < 5; i++) {
    topMembers.push({
      memberCode: `M${String(10000 + Math.floor(rand() * 9000)).padStart(6, "0")}`,
      memberName: names[i % names.length],
      balance: Math.floor(rand() * 15000) + 3000,
    });
  }
  topMembers.sort((a, b) => b.balance - a.balance);

  // 種別内訳
  const byType: TypeBreakdown[] = [
    { type: "earned", count: 320, total: 145000 },
    { type: "used", count: 210, total: 92000 },
    { type: "expired", count: 18, total: 6500 },
    { type: "adjusted", count: 4, total: 800 },
  ];

  const todayEarned = dailyTrend[dailyTrend.length - 1].earned;
  const todayUsed = dailyTrend[dailyTrend.length - 1].used;
  const thisMonthEarned = dailyTrend.reduce((sum, d) => sum + d.earned, 0);
  const thisMonthUsed = dailyTrend.reduce((sum, d) => sum + d.used, 0);

  return {
    totalMembers: 1248,
    totalActiveBalance: 487000,
    expiringNextMonth: 28000,
    thisMonthEarned,
    thisMonthUsed,
    thisMonthExpired: 6500,
    todayTransactions: byType.reduce((s, b) => s + b.count, 0) / 30 | 0,
    todayEarned,
    todayUsed,
    byType,
    dailyTrend,
    topMembers,
    recentTransactions,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clubCode = searchParams.get("clubCode");
  const demo = searchParams.get("demo");

  if (!clubCode) {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }

  if (demo === "1") {
    return NextResponse.json({ summary: generateDemoSummary(clubCode), isDemo: true });
  }

  return NextResponse.json({ summary: emptySummary(), isDemo: false });
}
