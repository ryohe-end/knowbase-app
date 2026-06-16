// app/api/store-settings/points/member/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { PointTransaction as PersistedTx } from "@/types/pointTransaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const PT_TABLE = process.env.DYNAMO_POINT_TRANSACTIONS_TABLE || "yamauchi-PointTransactions";
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

// DDB の PointTransaction を画面用 PointTransaction 形式に変換
function persistedToView(t: PersistedTx, balanceAfter: number) {
  const labelMap: Record<string, string> = {
    earned: "ポイント付与",
    adjusted: t.cancelledOf ? "ポイント取り消し" : "ポイント調整",
    used: "ポイント利用",
    expired: "ポイント失効",
    refunded: "ポイント返還",
  };
  return {
    id: t.transactionId,
    occurredAt: t.occurredAt,
    type: t.type,
    points: t.points,
    balanceAfter,
    source: t.reason ?? labelMap[t.type] ?? "—",
    reference: t.cancelledOf,
    note: t.note,
    operatorName: t.operatorName,
    cancelledBy: t.cancelledBy,
    cancelledAt: t.cancelledAt,
  };
}

export type PointTxType = "earned" | "used" | "expired" | "adjusted" | "refunded";

export type PointTransaction = {
  id: string;
  occurredAt: string;
  type: PointTxType;
  points: number;        // 正=付与, 負=利用/失効
  balanceAfter: number;
  source: string;
  reference?: string;
  note?: string;
  operatorName?: string;
  cancelledBy?: string;  // 取り消されている場合の対応 transactionId
  cancelledAt?: string;
};

export type MemberPointInfo = {
  memberCode: string;
  memberName: string;
  email: string | null;
  phone: string | null;
  joinedAt: string;
  status: "active" | "dormant" | "withdrawn";
  currentBalance: number;
  lifetimeEarned: number;
  lifetimeUsed: number;
  lifetimeExpired: number;
  expiringNextMonth: number;
  expiringIn3Months: number;
  transactions: PointTransaction[];
};

function generateDemoMember(clubCode: string, memberCode: string): MemberPointInfo {
  let seed = (clubCode + memberCode).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const names = ["山田 太郎", "佐藤 花子", "鈴木 一郎", "田中 美咲", "高橋 健太", "伊藤 さくら", "渡辺 真司", "中村 由美"];
  const sources = ["店舗利用", "キャンペーン", "新規入会ボーナス", "ポイント交換", "友達紹介", "誕生月ボーナス", "オプション利用", "都度利用購入"];
  const operators = ["フロント担当 鈴木", "店長 佐藤", "システム自動", "フロント担当 田中"];

  const memberName = names[Math.floor(rand() * names.length)];
  const joinDate = new Date();
  joinDate.setMonth(joinDate.getMonth() - Math.floor(rand() * 24) - 1);

  // トランザクション履歴生成 (古い順)
  const txCount = 18 + Math.floor(rand() * 10);
  const now = new Date();
  let balance = 0;
  let lifetimeEarned = 0;
  let lifetimeUsed = 0;
  let lifetimeExpired = 0;

  const txs: PointTransaction[] = [];
  for (let i = 0; i < txCount; i++) {
    const daysAgo = Math.floor((txCount - i) * (rand() * 8 + 1));
    const occurred = new Date(now);
    occurred.setDate(occurred.getDate() - daysAgo);
    occurred.setHours(8 + Math.floor(rand() * 14), Math.floor(rand() * 60), 0, 0);

    let type: PointTxType;
    const r = rand();
    if (r < 0.55) type = "earned";
    else if (r < 0.85) type = "used";
    else if (r < 0.95) type = "expired";
    else type = "adjusted";

    let points = 0;
    if (type === "earned") {
      points = (Math.floor(rand() * 8) + 1) * 50;
      lifetimeEarned += points;
    } else if (type === "used") {
      points = -((Math.floor(rand() * 6) + 1) * 50);
      if (balance + points < 0) {
        // 残高不足の利用は付与に変える
        type = "earned";
        points = -points;
        lifetimeEarned += points;
      } else {
        lifetimeUsed += -points;
      }
    } else if (type === "expired") {
      points = -((Math.floor(rand() * 4) + 1) * 50);
      if (balance + points < 0) {
        type = "earned";
        points = -points;
        lifetimeEarned += points;
      } else {
        lifetimeExpired += -points;
      }
    } else {
      points = (rand() > 0.5 ? 1 : -1) * (Math.floor(rand() * 3) + 1) * 100;
      if (balance + points < 0) points = -points;
    }
    balance += points;

    txs.push({
      id: `demo-${memberCode}-${i}`,
      occurredAt: occurred.toISOString(),
      type,
      points,
      balanceAfter: balance,
      source: sources[Math.floor(rand() * sources.length)],
      reference: rand() > 0.5 ? `TX-${String(10000 + i).padStart(6, "0")}` : undefined,
      note: rand() > 0.8 ? "備考メモ" : undefined,
      operatorName: operators[Math.floor(rand() * operators.length)],
    });
  }

  // 新しい順に並べ替え
  txs.sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : 1));

  return {
    memberCode,
    memberName,
    email: rand() > 0.3 ? `${memberCode.toLowerCase()}@example.com` : null,
    phone: rand() > 0.4 ? `090-${String(1000 + Math.floor(rand() * 9000))}-${String(1000 + Math.floor(rand() * 9000))}` : null,
    joinedAt: joinDate.toISOString(),
    status: "active",
    currentBalance: balance,
    lifetimeEarned,
    lifetimeUsed,
    lifetimeExpired,
    expiringNextMonth: Math.floor(balance * 0.15),
    expiringIn3Months: Math.floor(balance * 0.35),
    transactions: txs,
  };
}

// DDB に保存された付与/取り消しを取得 (会員別)
async function fetchPersisted(clubCode: string, memberCode: string): Promise<PersistedTx[]> {
  try {
    const res = await ddb.send(new ScanCommand({ TableName: PT_TABLE }));
    return ((res.Items ?? []) as PersistedTx[]).filter(
      (t) => t.clubCode === clubCode && t.memberCode === memberCode
    );
  } catch (e) {
    console.error("[points member] persisted scan failed", e);
    return [];
  }
}

// 履歴 (demo + DDB) をマージし、新しい順に並べて balanceAfter を再計算
function mergeAndRecompute(demo: MemberPointInfo | null, persisted: PersistedTx[]): MemberPointInfo {
  const base: MemberPointInfo = demo ?? {
    memberCode: persisted[0]?.memberCode ?? "",
    memberName: persisted[0]?.memberCode ?? "",
    email: null,
    phone: null,
    joinedAt: new Date().toISOString(),
    status: "active",
    currentBalance: 0,
    lifetimeEarned: 0,
    lifetimeUsed: 0,
    lifetimeExpired: 0,
    expiringNextMonth: 0,
    expiringIn3Months: 0,
    transactions: [],
  };

  const demoTxs = base.transactions ?? [];
  const persistedView = persisted.map((p) => persistedToView(p, 0));

  // 古い順に並べ、累積で balanceAfter を再計算
  const all = [...demoTxs, ...persistedView].sort(
    (a, b) => (a.occurredAt > b.occurredAt ? 1 : -1)
  );
  let balance = 0;
  for (const t of all) {
    balance += t.points;
    t.balanceAfter = balance;
  }

  // 新しい順
  all.sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : 1));

  return {
    ...base,
    currentBalance: balance,
    lifetimeEarned: all.filter((t) => t.points > 0).reduce((s, t) => s + t.points, 0),
    lifetimeUsed: -all.filter((t) => t.type === "used").reduce((s, t) => s + t.points, 0),
    lifetimeExpired: -all.filter((t) => t.type === "expired").reduce((s, t) => s + t.points, 0),
    transactions: all,
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

  const demoMember = demo === "1" ? generateDemoMember(clubCode, memberCode) : null;
  const persisted = await fetchPersisted(clubCode, memberCode);

  if (!demoMember && persisted.length === 0) {
    return NextResponse.json({ member: null, isDemo: false });
  }

  const member = mergeAndRecompute(demoMember, persisted);
  return NextResponse.json({ member, isDemo: !!demoMember });
}
