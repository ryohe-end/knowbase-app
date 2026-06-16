// app/api/store-settings/unpaid/list/route.ts
// クラブ単位の未納者一覧。本番ソース未接続のため demo モードで seed データを返す。

import { NextResponse } from "next/server";
import type { UnpaidCategory } from "../summary/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type UnpaidMemberRow = {
  memberCode: string;
  memberName: string;
  memberKana: string;
  phone: string | null;
  email: string | null;
  plan: string;
  status: "active" | "dormant" | "withdrawn";
  totalUnpaid: number;            // 未納合計金額
  unpaidCount: number;            // 未納件数
  oldestUnpaidAt: string;         // 最古未納の発生日 (ISO)
  oldestUnpaidDays: number;       // 経過日数
  categories: { category: UnpaidCategory; count: number; amount: number }[];
  lastRemindedAt: string | null;
};

function emptyList() {
  return { members: [] as UnpaidMemberRow[], totalAmount: 0, totalMembers: 0 };
}

function generateDemoList(clubCode: string): UnpaidMemberRow[] {
  let seed = clubCode.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const NAMES = [
    { name: "山田 太郎",  kana: "ヤマダ タロウ" },
    { name: "佐藤 花子",  kana: "サトウ ハナコ" },
    { name: "鈴木 一郎",  kana: "スズキ イチロウ" },
    { name: "田中 美咲",  kana: "タナカ ミサキ" },
    { name: "高橋 健太",  kana: "タカハシ ケンタ" },
    { name: "伊藤 さくら", kana: "イトウ サクラ" },
    { name: "渡辺 真司",  kana: "ワタナベ シンジ" },
    { name: "中村 由美",  kana: "ナカムラ ユミ" },
    { name: "小林 翔",    kana: "コバヤシ ショウ" },
    { name: "加藤 美奈",  kana: "カトウ ミナ" },
    { name: "斎藤 雄一",  kana: "サイトウ ユウイチ" },
    { name: "山本 結衣",  kana: "ヤマモト ユイ" },
    { name: "森 健二",    kana: "モリ ケンジ" },
    { name: "井上 真理",  kana: "イノウエ マリ" },
    { name: "松本 直樹",  kana: "マツモト ナオキ" },
    { name: "横内 みちつな", kana: "ヨコウチ ミチツナ" },
    { name: "佐々木 玲",  kana: "ササキ レイ" },
    { name: "石田 翔太",  kana: "イシダ ショウタ" },
    { name: "野村 理沙",  kana: "ノムラ リサ" },
    { name: "前田 健",    kana: "マエダ ケン" },
    { name: "藤田 結子",  kana: "フジタ ユイコ" },
    { name: "原田 拓郎",  kana: "ハラダ タクロウ" },
    { name: "村上 美奈子", kana: "ムラカミ ミナコ" },
    { name: "近藤 大輔",  kana: "コンドウ ダイスケ" },
    { name: "竹内 美和",  kana: "タケウチ ミワ" },
    { name: "千葉 翼",    kana: "チバ ツバサ" },
    { name: "三浦 さやか", kana: "ミウラ サヤカ" },
    { name: "酒井 慎一",  kana: "サカイ シンイチ" },
  ];

  const PLANS = ["フィットネス", "プレミアム", "スタンダード", "1980円会員", "法人個人A"];
  const CATEGORIES: UnpaidCategory[] = ["monthly_fee", "option", "onetime_pass", "penalty"];
  const STATUSES: UnpaidMemberRow["status"][] = ["active", "active", "active", "dormant", "withdrawn"];

  const now = new Date();
  const list: UnpaidMemberRow[] = NAMES.map((n, i) => {
    const oldestDays = Math.floor(rand() * 160) + 5;
    const oldest = new Date(now);
    oldest.setDate(oldest.getDate() - oldestDays);
    const unpaidCount = Math.floor(rand() * 3) + 1;
    // 月会費を主軸に、たまにオプションや事務手数料も
    const categories: UnpaidMemberRow["categories"] = [];
    let total = 0;
    for (let j = 0; j < unpaidCount; j++) {
      const cat = j === 0 ? "monthly_fee" : CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
      const amount = cat === "monthly_fee" ? 7980 : cat === "penalty" ? 3300 : Math.floor(rand() * 4000) + 550;
      total += amount;
      const existing = categories.find((c) => c.category === cat);
      if (existing) {
        existing.count += 1;
        existing.amount += amount;
      } else {
        categories.push({ category: cat, count: 1, amount });
      }
    }
    const lastRemind = rand() > 0.4
      ? new Date(now.getTime() - Math.floor(rand() * oldestDays * 0.8) * 86400000).toISOString()
      : null;
    return {
      memberCode: `M${String(10000 + i * 137 % 89999).padStart(6, "0")}`,
      memberName: n.name,
      memberKana: n.kana,
      phone: rand() > 0.2 ? `0${Math.floor(rand() * 90) + 70}-${String(Math.floor(rand() * 10000)).padStart(4, "0")}-${String(Math.floor(rand() * 10000)).padStart(4, "0")}` : null,
      email: rand() > 0.3 ? `member${i + 1}@example.com` : null,
      plan: PLANS[i % PLANS.length],
      status: STATUSES[Math.floor(rand() * STATUSES.length)],
      totalUnpaid: total,
      unpaidCount,
      oldestUnpaidAt: oldest.toISOString(),
      oldestUnpaidDays: oldestDays,
      categories,
      lastRemindedAt: lastRemind,
    };
  });
  // 古い順 → 金額の大きい順
  list.sort((a, b) => b.oldestUnpaidDays - a.oldestUnpaidDays || b.totalUnpaid - a.totalUnpaid);
  return list;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clubCode = searchParams.get("clubCode");
  const demo = searchParams.get("demo");

  if (!clubCode) {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }

  if (demo === "1") {
    const members = generateDemoList(clubCode);
    return NextResponse.json({
      members,
      totalMembers: members.length,
      totalAmount: members.reduce((s, m) => s + m.totalUnpaid, 0),
      isDemo: true,
    });
  }

  // 本番ソース未接続。空配列で返す (Oracle 連携時に差し替え)。
  return NextResponse.json({ ...emptyList(), isDemo: false });
}
