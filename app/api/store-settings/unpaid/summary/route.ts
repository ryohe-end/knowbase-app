// app/api/store-settings/unpaid/summary/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type UnpaidCategory = "monthly_fee" | "option" | "onetime_pass" | "penalty" | "other";

export type AgingBucket = {
  key: "0-30" | "31-60" | "61-90" | "91+";
  label: string;
  count: number;
  amount: number;
};

export type CategoryBreakdown = {
  category: UnpaidCategory;
  count: number;
  amount: number;
};

export type MonthlyTrend = {
  month: string;       // YYYY/MM
  occurred: number;    // 発生額
  collected: number;   // 回収額
};

export type TopUnpaidMember = {
  memberCode: string;
  memberName: string;
  amount: number;
  oldestUnpaidAt: string;
  unpaidCount: number;
};

export type RecentReminder = {
  id: string;
  memberCode: string;
  memberName: string;
  amount: number;
  remindedAt: string;
  channel: "email" | "sms" | "phone" | "letter";
};

export type UnpaidSummary = {
  totalUnpaidAmount: number;
  totalUnpaidMembers: number;
  totalUnpaidCount: number;
  thisMonthOccurred: number;
  thisMonthCollected: number;
  collectionRate: number;
  averageDaysOverdue: number;
  oldestUnpaidDays: number;
  aging: AgingBucket[];
  byCategory: CategoryBreakdown[];
  monthlyTrend: MonthlyTrend[];
  topUnpaid: TopUnpaidMember[];
  recentReminders: RecentReminder[];
};

function emptySummary(): UnpaidSummary {
  return {
    totalUnpaidAmount: 0,
    totalUnpaidMembers: 0,
    totalUnpaidCount: 0,
    thisMonthOccurred: 0,
    thisMonthCollected: 0,
    collectionRate: 0,
    averageDaysOverdue: 0,
    oldestUnpaidDays: 0,
    aging: [
      { key: "0-30", label: "0〜30日", count: 0, amount: 0 },
      { key: "31-60", label: "31〜60日", count: 0, amount: 0 },
      { key: "61-90", label: "61〜90日", count: 0, amount: 0 },
      { key: "91+", label: "91日以上", count: 0, amount: 0 },
    ],
    byCategory: [],
    monthlyTrend: [],
    topUnpaid: [],
    recentReminders: [],
  };
}

function generateDemoSummary(clubCode: string): UnpaidSummary {
  let seed = clubCode.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const names = ["山田 太郎", "佐藤 花子", "鈴木 一郎", "田中 美咲", "高橋 健太", "伊藤 さくら", "渡辺 真司", "中村 由美", "小林 翔", "加藤 美奈"];
  const channels: RecentReminder["channel"][] = ["email", "sms", "phone", "letter"];

  // エイジング (0-30, 31-60, 61-90, 91+)
  const aging: AgingBucket[] = [
    { key: "0-30", label: "0〜30日", count: 18, amount: 142000 },
    { key: "31-60", label: "31〜60日", count: 9, amount: 87000 },
    { key: "61-90", label: "61〜90日", count: 4, amount: 38500 },
    { key: "91+", label: "91日以上", count: 3, amount: 32500 },
  ];

  const totalUnpaidAmount = aging.reduce((s, b) => s + b.amount, 0);
  const totalUnpaidCount = aging.reduce((s, b) => s + b.count, 0);

  // カテゴリ別
  const byCategory: CategoryBreakdown[] = [
    { category: "monthly_fee", count: 22, amount: 198000 },
    { category: "option", count: 7, amount: 42000 },
    { category: "onetime_pass", count: 3, amount: 9000 },
    { category: "penalty", count: 2, amount: 6000 },
  ];

  // 月次トレンド (直近6ヶ月)
  const now = new Date();
  const monthlyTrend: MonthlyTrend[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthlyTrend.push({
      month: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      occurred: Math.floor(rand() * 80000) + 120000,
      collected: Math.floor(rand() * 70000) + 90000,
    });
  }

  // トップ未納者
  const topUnpaid: TopUnpaidMember[] = [];
  for (let i = 0; i < 5; i++) {
    const daysAgo = Math.floor(rand() * 120) + 20;
    const oldest = new Date(now);
    oldest.setDate(oldest.getDate() - daysAgo);
    topUnpaid.push({
      memberCode: `M${String(10000 + Math.floor(rand() * 9000)).padStart(6, "0")}`,
      memberName: names[i % names.length],
      amount: Math.floor(rand() * 30000) + 8000,
      oldestUnpaidAt: oldest.toISOString(),
      unpaidCount: Math.floor(rand() * 4) + 1,
    });
  }
  topUnpaid.sort((a, b) => b.amount - a.amount);

  // 直近の督促履歴
  const recentReminders: RecentReminder[] = [];
  for (let i = 0; i < 6; i++) {
    const hoursAgo = Math.floor(rand() * 168);
    const d = new Date(now.getTime() - hoursAgo * 3600 * 1000);
    recentReminders.push({
      id: `demo-rem-${clubCode}-${i}`,
      memberCode: `M${String(10000 + Math.floor(rand() * 9000)).padStart(6, "0")}`,
      memberName: names[Math.floor(rand() * names.length)],
      amount: Math.floor(rand() * 15000) + 3000,
      remindedAt: d.toISOString(),
      channel: channels[Math.floor(rand() * channels.length)],
    });
  }
  recentReminders.sort((a, b) => (a.remindedAt > b.remindedAt ? -1 : 1));

  const thisMonthOccurred = monthlyTrend[monthlyTrend.length - 1].occurred;
  const thisMonthCollected = monthlyTrend[monthlyTrend.length - 1].collected;

  return {
    totalUnpaidAmount,
    totalUnpaidMembers: 28,
    totalUnpaidCount,
    thisMonthOccurred,
    thisMonthCollected,
    collectionRate: Math.round((thisMonthCollected / Math.max(thisMonthOccurred, 1)) * 100),
    averageDaysOverdue: 38,
    oldestUnpaidDays: 142,
    aging,
    byCategory,
    monthlyTrend,
    topUnpaid,
    recentReminders,
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
