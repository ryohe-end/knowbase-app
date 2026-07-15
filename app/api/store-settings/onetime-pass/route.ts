// app/api/store-settings/onetime-pass/route.ts
//
// 1day / One Time Pass 設定の参照(読み取り専用)。JOYFIT EnjoyTimePass(t1pass) を
// SSHトンネル(knowbie-ssh-db-proxy)経由で読む。価格は EnjoyTimePass 側で管理するため
// knowbase からは表示のみ (保存不可)。
//   GET ?clubCode=511  → { config, available, source, readOnly }
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { getClubBusinessType, cpssBrandForBusinessType } from "@/lib/clubScope";
import { sshQuery } from "@/lib/sshDbProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET = "onetimepass";
const JOYFIT_DURATIONS = [30, 60, 90, 120, 150, 180, 210];

export type PricePeriod = { id: string; price: number; validFrom: string; validTo: string | null };
export type DurationPrices = { durationMinutes: number; periods: PricePeriod[] };
export type OneTimePassConfig = {
  clubCode: string; brand: string; unitType: "1day" | "30min";
  durations: DurationPrices[]; updatedAt: string; source?: string; readOnly?: boolean;
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDate(s: any): string | null {
  const v = s == null ? "" : String(s);
  if (!/^\d{8}$/.test(v) || v === "00000000" || v === "99999999") return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clubCode = (new URL(req.url).searchParams.get("clubCode") || "").trim();
  if (!/^\d+$/.test(clubCode)) {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }
  if (!isClubInScope(user, clubCode)) {
    return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
  }

  const brand = cpssBrandForBusinessType(await getClubBusinessType(clubCode));
  const unitType: "1day" | "30min" = brand === "JOYFIT" ? "30min" : "1day";
  const clubCd = Number(clubCode);
  const today = todayYmd();

  // 対象店舗 (EnjoyTimePass = JOYFIT系のみ)
  const clubRes = await sshQuery(TARGET,
    "select club_cd, club_name, sales_end_dt from t1pass.club_tbl where club_cd = $1", [clubCd]);
  if (!clubRes.ok) {
    return NextResponse.json({ error: `参照に失敗しました: ${clubRes.error}`, config: null }, { status: 502 });
  }
  const club = clubRes.rows[0];
  if (!club) {
    // 未対象 (FIT365 や EnjoyTimePass 未設定店)
    return NextResponse.json({ config: null, available: false, brand, source: "EnjoyTimePass (t1pass)" });
  }

  // 時間制価格 (有効期間内)。valid_minutes ごとに period。
  const tierRes = await sshQuery(TARGET,
    "select valid_minutes, price, start_dt, end_dt from t1pass.club_time_price_tbl where club_cd = $1 and start_dt <= $2 and end_dt >= $2 order by valid_minutes asc",
    [clubCd, today]);
  const tiers = tierRes.ok ? tierRes.rows : [];
  const byMin = new Map<number, PricePeriod[]>();
  for (const t of tiers) {
    const m = Number(t.valid_minutes);
    const arr = byMin.get(m) || [];
    arr.push({ id: `t1-${m}`, price: Number(t.price), validFrom: fmtDate(t.start_dt) || "", validTo: fmtDate(t.end_dt) });
    byMin.set(m, arr);
  }

  // 定額(1day)
  const flatRes = await sshQuery(TARGET,
    "select price, start_dt from t1pass.club_price_tbl where club_cd = $1 and start_dt <= $2 order by start_dt desc limit 1",
    [clubCd, today]);
  const flat = flatRes.ok ? flatRes.rows[0] : null;

  const durations: DurationPrices[] = unitType === "30min"
    ? JOYFIT_DURATIONS.map((m) => ({ durationMinutes: m, periods: byMin.get(m) ?? [] }))
    : [{ durationMinutes: 1440, periods: flat ? [{ id: "flat", price: Number(flat.price), validFrom: fmtDate(flat.start_dt) || "", validTo: null }] : [] }];

  const config: OneTimePassConfig = {
    clubCode, brand, unitType, durations,
    updatedAt: new Date().toISOString(),
    source: "EnjoyTimePass (t1pass)", readOnly: true,
  };
  const salesEnded = club.sales_end_dt && club.sales_end_dt !== "99999999" && String(club.sales_end_dt) < today;
  return NextResponse.json({
    config, available: true, readOnly: true, brand,
    club: { clubCd: club.club_cd, clubName: club.club_name, salesEnded },
    flatPrice: flat ? Number(flat.price) : null,
    source: "EnjoyTimePass (t1pass)",
  });
}

// 保存は不可 (価格は EnjoyTimePass 側で管理)。
export async function POST() {
  return NextResponse.json(
    { ok: false, readOnly: true, error: "この設定は参照のみです。価格の変更は EnjoyTimePass 側で行ってください。" },
    { status: 403 }
  );
}
