// app/api/store-settings/unpaid/member/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type UnpaidCategory = "monthly_fee" | "option" | "onetime_pass" | "penalty" | "other";
export type UnpaidStatus = "unpaid" | "reminded" | "negotiating" | "paid" | "written_off";

export type UnpaidItem = {
  id: string;
  occurredAt: string;      // 発生日 (ISO)
  dueAt: string;           // 支払期限
  category: UnpaidCategory;
  amount: number;
  description: string;
  status: UnpaidStatus;
  lastRemindedAt: string | null;
  remindCount: number;
  paidAt: string | null;
  paymentMethod: string | null;
  note: string | null;
};

export type PaymentRecord = {
  id: string;
  paidAt: string;
  amount: number;
  method: string;
  reference: string | null;
};

export type MemberUnpaidInfo = {
  memberCode: string;
  memberName: string;
  email: string | null;
  phone: string | null;
  joinedAt: string;
  status: "active" | "dormant" | "withdrawn";
  totalUnpaid: number;
  unpaidCount: number;
  oldestUnpaidAt: string | null;
  lifetimePaid: number;
  items: UnpaidItem[];
  paymentHistory: PaymentRecord[];
};

const CATEGORIES: { category: UnpaidCategory; desc: string[] }[] = [
  { category: "monthly_fee", desc: ["1月分会費", "2月分会費", "3月分会費", "4月分会費"] },
  { category: "option", desc: ["タオルレンタル", "プールオプション", "サウナオプション"] },
  { category: "onetime_pass", desc: ["1日利用権", "30分利用権"] },
  { category: "penalty", desc: ["遅延手数料"] },
  { category: "other", desc: ["その他費用"] },
];

function generateDemoMember(clubCode: string, memberCode: string): MemberUnpaidInfo {
  let seed = (clubCode + memberCode).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const names = ["山田 太郎", "佐藤 花子", "鈴木 一郎", "田中 美咲", "高橋 健太", "伊藤 さくら", "渡辺 真司", "中村 由美"];
  const memberName = names[Math.floor(rand() * names.length)];
  const joinDate = new Date();
  joinDate.setMonth(joinDate.getMonth() - Math.floor(rand() * 36) - 3);

  const now = new Date();
  const items: UnpaidItem[] = [];
  const itemCount = Math.floor(rand() * 5) + 2;
  for (let i = 0; i < itemCount; i++) {
    const daysAgo = Math.floor(rand() * 150) + 5;
    const occurred = new Date(now);
    occurred.setDate(occurred.getDate() - daysAgo);
    const due = new Date(occurred);
    due.setDate(due.getDate() + 15);

    const catEntry = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    const description = catEntry.desc[Math.floor(rand() * catEntry.desc.length)];
    const amount =
      catEntry.category === "monthly_fee"
        ? 7000 + Math.floor(rand() * 5) * 500
        : catEntry.category === "option"
        ? 1000 + Math.floor(rand() * 4) * 500
        : catEntry.category === "onetime_pass"
        ? 500 + Math.floor(rand() * 6) * 250
        : catEntry.category === "penalty"
        ? 500 + Math.floor(rand() * 4) * 250
        : 1000 + Math.floor(rand() * 8) * 250;

    const isPaid = rand() < 0.25;
    const remindCount = isPaid ? Math.floor(rand() * 3) : Math.floor(rand() * 5);
    const lastRemindedAt = remindCount > 0
      ? new Date(occurred.getTime() + remindCount * 7 * 24 * 3600 * 1000).toISOString()
      : null;
    const paidAt = isPaid
      ? new Date(occurred.getTime() + (Math.floor(rand() * 30) + 5) * 24 * 3600 * 1000).toISOString()
      : null;
    const status: UnpaidStatus = isPaid
      ? "paid"
      : remindCount >= 3
      ? "negotiating"
      : remindCount > 0
      ? "reminded"
      : "unpaid";

    items.push({
      id: `demo-${memberCode}-${i}`,
      occurredAt: occurred.toISOString(),
      dueAt: due.toISOString(),
      category: catEntry.category,
      amount,
      description,
      status,
      lastRemindedAt,
      remindCount,
      paidAt,
      paymentMethod: isPaid ? (rand() > 0.5 ? "口座振替" : "店頭決済") : null,
      note: rand() > 0.85 ? "電話で支払い約束済み" : null,
    });
  }

  items.sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : 1));

  const unpaid = items.filter((i) => i.status !== "paid" && i.status !== "written_off");
  const paid = items.filter((i) => i.status === "paid");

  const oldestUnpaid = unpaid.length > 0 ? unpaid[unpaid.length - 1].occurredAt : null;

  const paymentHistory: PaymentRecord[] = paid.map((p) => ({
    id: `pay-${p.id}`,
    paidAt: p.paidAt!,
    amount: p.amount,
    method: p.paymentMethod ?? "—",
    reference: rand() > 0.5 ? `RCP-${String(10000 + Math.floor(rand() * 9000)).padStart(6, "0")}` : null,
  }));

  return {
    memberCode,
    memberName,
    email: rand() > 0.3 ? `${memberCode.toLowerCase()}@example.com` : null,
    phone: rand() > 0.4 ? `090-${String(1000 + Math.floor(rand() * 9000))}-${String(1000 + Math.floor(rand() * 9000))}` : null,
    joinedAt: joinDate.toISOString(),
    status: "active",
    totalUnpaid: unpaid.reduce((s, i) => s + i.amount, 0),
    unpaidCount: unpaid.length,
    oldestUnpaidAt: oldestUnpaid,
    lifetimePaid: paid.reduce((s, i) => s + i.amount, 0) + 50000 + Math.floor(rand() * 100000),
    items,
    paymentHistory,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clubCode = searchParams.get("clubCode");
  const memberCode = searchParams.get("memberCode");
  const demo = searchParams.get("demo");

  if (!clubCode) {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }
  if (!memberCode) {
    return NextResponse.json({ error: "memberCode is required" }, { status: 400 });
  }

  if (demo === "1") {
    return NextResponse.json({
      member: generateDemoMember(clubCode, memberCode),
      isDemo: true,
    });
  }

  return NextResponse.json({ member: null, isDemo: false });
}
