// app/api/store-settings/points/member/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { PointTransaction as PersistedTx } from "@/types/pointTransaction";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { getClubBusinessType, cpssBrandForBusinessType, resolveHomeClub } from "@/lib/clubScope";
import { cpssCall } from "@/lib/cpssProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const PT_TABLE = process.env.DYNAMO_POINT_TRANSACTIONS_TABLE || "yamauchi-PointTransactions";
const MS_API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const MS_API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";
const CPSS_ENV = (process.env.CPSS_ENV as "stg" | "prod") || "stg";
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

  // --- 実データ(RDS/CPSS)連携で追加される会員情報 ---
  plan?: string | null;          // 会員区分 (member-search)
  planCode?: number | string | null;
  isCorporate?: boolean;
  withdrawnAt?: string | null;   // 退会日
  tenureLabel?: string | null;   // 継続期間 "N年Mヶ月"
  tenureMonths?: number | null;
  rank?: string | null;          // CPSS ランクコード
  rankName?: string | null;      // CPSS ランク名
  age?: number | null;
  gender?: string | null;
  brand?: "JOYFIT" | "FIT365";
  cpssAvailable?: boolean;       // CPSS 参照可否
  cpssError?: string | null;
};

// 入会日→(退会日 or 現在)の継続期間を「N年Mヶ月」で
function tenure(joinDate: string | null, endDate: string | null): { months: number; label: string } | null {
  if (!joinDate) return null;
  const j = new Date(joinDate + "T00:00:00+09:00");
  const e = endDate ? new Date(endDate + "T00:00:00+09:00") : new Date();
  if (isNaN(j.getTime()) || isNaN(e.getTime()) || e < j) return null;
  let months = (e.getFullYear() - j.getFullYear()) * 12 + (e.getMonth() - j.getMonth());
  if (e.getDate() < j.getDate()) months -= 1;
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return { months, label: y > 0 ? `${y}年${m}ヶ月` : `${m}ヶ月` };
}

// RDS(member-search type=refundable) から会員情報を取得。決済履歴が無い会員は null。
async function fetchRdsMember(memberNo: string, clubCode: string): Promise<any | null> {
  if (!MS_API_BASE || !MS_API_KEY) return null;
  try {
    const url = new URL(`${MS_API_BASE}/members/search`);
    url.searchParams.set("type", "refundable");
    url.searchParams.set("memberNo", memberNo);
    url.searchParams.set("clubCode", clubCode);
    url.searchParams.set("fromMonth", "190001"); // 契約が拾えるよう全期間
    const up = await fetch(url.toString(), { headers: { "x-api-key": MS_API_KEY }, cache: "no-store" });
    if (!up.ok) { console.error("[points/member] member-search", up.status); return null; }
    const j = (await up.json()) as { results?: { member?: any } };
    return j.results?.member ?? null;
  } catch (e) {
    console.error("[points/member] member-search fetch failed", e);
    return null;
  }
}

// RDS会員情報 + CPSSポイント + DDB店舗操作履歴 をマージした実データを構築
async function buildRealMember(
  clubCode: string, memberCode: string
): Promise<MemberPointInfo | null> {
  // clubCode は呼び出し側で resolveHomeClub 済みの所属クラブ(3桁/4桁)。ブランド・RDSともこれを使う。
  const brand = cpssBrandForBusinessType(await getClubBusinessType(clubCode));

  const [rds, cp, persisted] = await Promise.all([
    fetchRdsMember(memberCode, clubCode),
    cpssCall(brand, CPSS_ENV, "getMemberForApp", { aid: memberCode, cumulus: true, expires: true }),
    fetchPersisted(clubCode, memberCode),
  ]);
  const cpss = cp.ok ? cp.result : null;
  if (!rds && !cpss && persisted.length === 0) return null;

  const endDate = rds?.status === "withdrawn" ? rds?.withdrawnAt ?? null : null;
  const cont = tenure(rds?.joinDate ?? null, endDate);

  // 店舗操作履歴 (DDB): 保存済みの CPSS 残高をそのまま表示。新しい順。
  const txs: PointTransaction[] = persisted
    .map((p) => persistedToView(p, typeof p.cpssBalanceAfter === "number" ? p.cpssBalanceAfter : 0))
    .sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : 1));

  const cpssBalance = typeof cpss?.balance === "number" ? cpss.balance : 0;
  const cpssName = cpss ? `${cpss.familynamekj ?? ""} ${cpss.firstnamekj ?? ""}`.trim() : "";
  const memberName = rds?.name || cpssName || memberCode;

  return {
    memberCode,
    memberName,
    email: null,
    phone: rds?.phone ?? null,
    joinedAt: rds?.joinDate ? `${rds.joinDate}T00:00:00+09:00` : "",
    status: rds?.status === "withdrawn" ? "withdrawn" : "active",
    currentBalance: cpssBalance,
    lifetimeEarned: txs.filter((t) => t.points > 0).reduce((s, t) => s + t.points, 0),
    lifetimeUsed: -txs.filter((t) => t.type === "used").reduce((s, t) => s + t.points, 0),
    lifetimeExpired: 0,
    expiringNextMonth: 0,
    expiringIn3Months: 0,
    transactions: txs,
    plan: rds?.plan ?? null,
    planCode: rds?.planCode ?? null,
    isCorporate: rds?.isCorporate ?? false,
    withdrawnAt: rds?.withdrawnAt ?? null,
    tenureLabel: cont?.label ?? null,
    tenureMonths: cont?.months ?? null,
    rank: cpss?.rank ?? null,
    rankName: cpss?.rankname ?? null,
    age: cpss?.age ?? null,
    gender: cpss?.gender ?? null,
    brand,
    cpssAvailable: !!cpss,
    cpssError: cp.ok ? null : cp.error,
  };
}

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
  const memberCode = (searchParams.get("memberCode") || "").trim();
  const demo = searchParams.get("demo");

  if (!clubCode) {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }
  if (!memberCode) {
    return NextResponse.json({ error: "memberCode is required" }, { status: 400 });
  }

  // サンプル表示はデモ生成 (認証・実データ参照なし)
  if (demo === "1") {
    const demoMember = generateDemoMember(clubCode, memberCode);
    const persisted = await fetchPersisted(clubCode, memberCode);
    const member = mergeAndRecompute(demoMember, persisted);
    return NextResponse.json({ member, isDemo: true });
  }

  // 実データ: 認証 + スコープ。会員の所属クラブ(会員番号先頭3桁)で厳密に絞る。
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^\d{4,}$/.test(memberCode)) {
    return NextResponse.json({ error: "会員番号を正しく入力してください" }, { status: 400 });
  }
  const homeClub = await resolveHomeClub(memberCode); // 3桁/4桁クラブを正しく解決
  // 選択店舗・会員所属クラブの両方が担当スコープ内であること
  if (!isClubInScope(user, homeClub) || !isClubInScope(user, clubCode)) {
    return NextResponse.json({ error: "この会員は担当クラブ外です" }, { status: 403 });
  }

  // ブランド/API・RDS は会員の所属クラブ(homeClub)から解決 (JOYFIT/FIT365 を会員単位で振り分け)
  const member = await buildRealMember(homeClub, memberCode);
  void writeAudit({
    userId: user.email || user.userId, userName: user.name,
    action: "points.memberLookup", resource: `member:${memberCode}`,
    clubCodes: [homeClub], result: member ? "ok" : "error",
    detail: {
      brand: member?.brand, found: !!member,
      balance: member?.currentBalance ?? null, cpssAvailable: member?.cpssAvailable ?? null,
    },
    ip: clientIp(req),
  });
  return NextResponse.json({ member, isDemo: false });
}
