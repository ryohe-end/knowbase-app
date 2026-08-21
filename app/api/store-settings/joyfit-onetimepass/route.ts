// app/api/store-settings/joyfit-onetimepass/route.ts
//
// JOYFIT OneTimePass(時間別 30〜210分) 金額設定。EnjoyTimePass(t1pass) の
// club_time_price_tbl を ssh-db-proxy(target=onetimepass) 経由で参照/更新する。
//   PK=(club_cd, start_dt, valid_minutes) / DELETE不可・UPDATE/INSERT可・delete_flg列なし
//   基本価格 = start_dt='00000000' end_dt='99999999' の行。
//   予約/キャンペーン = 期間指定(bounded) or 予約変更(end_dt='99999999')の行。
//
// 【サーバ負荷対策】
//   一覧 = t1pass.club_tbl(club_cd + 名称、225行の静的な小テーブル)を1クエリで取得し、
//          モジュール内で10分キャッシュ。全ユーザー横断でも相手DBへは10分に1回だけ。
//          価格の全店横断集計は一切しない(それが重い操作なので)。
//   詳細/保存 = 単一クラブのライブクエリのみ(軽量)。
// 【アクセス制御】管理者=全店 / 店舗ユーザー=自clubCodeのみ (club_cd=clubCode)。
//   GET → JOYFITクラブ一覧   GET ?clubCode= → 詳細(7段+予約)   POST → 保存(upsert)
import { NextResponse } from "next/server";
import { getRefundUser, type RefundUser } from "@/lib/refundAuth";
import { isHqUser } from "@/lib/wellnessPass";
import { sshBatch } from "@/lib/sshDbProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET = "onetimepass";
const TIERS = [30, 60, 90, 120, 150, 180, 210];
const PRICE_MIN = 100;
const PRICE_MAX = 20000;
const BASE_START = "00000000";
const FOREVER = "99999999";
const CLUB_CACHE_MS = 10 * 60 * 1000;

const isYmd = (s: any) => typeof s === "string" && /^\d{8}$/.test(s);
const validPrice = (p: any) => Number.isInteger(p) && p >= PRICE_MIN && p <= PRICE_MAX;
const isBase = (r: { start_dt: string; end_dt: string }) => r.start_dt === BASE_START && r.end_dt === FOREVER;
function jstDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}
function scopeOf(user: RefundUser) {
  return { admin: isHqUser(user), clubCodes: new Set((user.clubCodes || []).map(String)) };
}

// JOYFITクラブ一覧: t1pass.club_tbl を10分キャッシュ (相手DBへは10分に1回のみ)
type ClubRow = { clubCode: string; name: string };
let clubCache: { at: number; clubs: ClubRow[] } | null = null;
async function joyfitClubs(): Promise<ClubRow[]> {
  if (clubCache && Date.now() - clubCache.at < CLUB_CACHE_MS) return clubCache.clubs;
  const res = await sshBatch(TARGET, [
    { text: "select club_cd, club_name from t1pass.club_tbl where end_dt >= $1 order by club_cd", params: [jstDate()] },
  ]);
  if (!res.ok) {
    if (clubCache) return clubCache.clubs; // 失敗時は古いキャッシュで代替
    throw new Error(res.error);
  }
  const clubs = res.results[0].rows.map((r: any) => ({ clubCode: String(r.club_cd), name: String(r.club_name || r.club_cd) }));
  clubCache = { at: Date.now(), clubs };
  return clubs;
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = scopeOf(user);
  const clubCode = new URL(req.url).searchParams.get("clubCode");
  const today = jstDate();

  // --- 詳細(単一クラブ・ライブ) ---
  if (clubCode) {
    if (!/^\d+$/.test(clubCode)) return NextResponse.json({ error: "clubCode invalid" }, { status: 400 });
    if (!scope.admin && !scope.clubCodes.has(clubCode)) return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
    const res = await sshBatch(TARGET, [
      { text: "select valid_minutes, price, start_dt, end_dt from t1pass.club_time_price_tbl where club_cd = $1 order by valid_minutes, start_dt", params: [Number(clubCode)] },
    ]);
    if (!res.ok) return NextResponse.json({ error: `参照に失敗しました: ${res.error}` }, { status: 502 });
    const rows = res.results[0].rows;
    const base: Record<number, number> = {};
    const campaigns: { validMinutes: number; price: number; startDate: string; endDate: string }[] = [];
    for (const r of rows) {
      const vm = Number(r.valid_minutes);
      if (isBase(r)) base[vm] = Number(r.price);
      else campaigns.push({ validMinutes: vm, price: Number(r.price), startDate: String(r.start_dt), endDate: String(r.end_dt) });
    }
    return NextResponse.json({
      today, tiers: TIERS, priceRange: { min: PRICE_MIN, max: PRICE_MAX },
      clubCode,
      base: TIERS.map((vm) => ({ validMinutes: vm, price: base[vm] ?? null })),
      campaigns,
    });
  }

  // --- 一覧(自前clubsから・相手DB非参照) ---
  let clubs = await joyfitClubs();
  if (!scope.admin) clubs = clubs.filter((c) => scope.clubCodes.has(c.clubCode));
  return NextResponse.json({ today, isAdmin: scope.admin, tiers: TIERS, clubs });
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = scopeOf(user);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const clubCode = String(body?.clubCode ?? "");
  if (!/^\d+$/.test(clubCode)) return NextResponse.json({ error: "clubCode invalid" }, { status: 400 });
  if (!scope.admin && !scope.clubCodes.has(clubCode)) return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
  const cc = Number(clubCode);
  const today = jstDate();

  const writes: { text: string; params: any[] }[] = [];
  // 基本価格(00000000/99999999)への upsert を作る小関数。アプリ購入画面が参照するのはこの行。
  const upsertBase = (vm: number, price: number) => ({
    text: `insert into t1pass.club_time_price_tbl (club_cd, start_dt, valid_minutes, price, end_dt)
           values ($1,$2,$3,$4,$5)
           on conflict (club_cd, start_dt, valid_minutes) do update set price = excluded.price, end_dt = excluded.end_dt`,
    params: [cc, BASE_START, vm, price, FOREVER],
  });

  // 基本価格 (tier別) : upsert (PKは club_cd,start_dt,valid_minutes)
  const base = Array.isArray(body.base) ? body.base : [];
  for (const b of base) {
    const vm = Number(b.validMinutes);
    if (!TIERS.includes(vm)) continue;
    if (b.price == null) continue;
    if (!validPrice(b.price)) return NextResponse.json({ error: `価格は ${PRICE_MIN}〜${PRICE_MAX} 円で入力してください` }, { status: 400 });
    writes.push({
      text: `insert into t1pass.club_time_price_tbl (club_cd, start_dt, valid_minutes, price, end_dt)
             values ($1,$2,$3,$4,$5)
             on conflict (club_cd, start_dt, valid_minutes) do update set price = excluded.price, end_dt = excluded.end_dt`,
      params: [cc, BASE_START, vm, Number(b.price), FOREVER],
    });
  }

  // 予約/キャンペーン : upsert。void(無効化)= end_dt を前日に。DELETE権限が無いため論理的に期限切れ化。
  const campaigns = Array.isArray(body.campaigns) ? body.campaigns : [];
  for (const c of campaigns) {
    const vm = Number(c.validMinutes);
    if (!TIERS.includes(vm)) return NextResponse.json({ error: "利用時間(分)が不正です" }, { status: 400 });
    if (!isYmd(c.startDate)) return NextResponse.json({ error: "開始日が不正です (YYYYMMDD)" }, { status: 400 });
    if (c.void) {
      // 無効化: 開始日の前日を終了日にして期限切れ化 (start>end で非適用)
      const expired = "00000001";
      writes.push({ text: "update t1pass.club_time_price_tbl set end_dt=$4 where club_cd=$1 and start_dt=$2 and valid_minutes=$3", params: [cc, String(c.startDate), vm, expired] });
      continue;
    }
    if (!validPrice(c.price)) return NextResponse.json({ error: `価格は ${PRICE_MIN}〜${PRICE_MAX} 円で入力してください` }, { status: 400 });
    if (!isYmd(c.endDate)) return NextResponse.json({ error: "終了日が不正です (YYYYMMDD)" }, { status: 400 });
    if (String(c.startDate) > String(c.endDate)) return NextResponse.json({ error: "終了日は開始日以降にしてください" }, { status: 400 });
    if (c.startDate === BASE_START && c.endDate === FOREVER) return NextResponse.json({ error: "予約価格に基本期間(全期間)は使えません" }, { status: 400 });
    // 【処理変更】恒久変更(予約変更=end_dt が FOREVER)で、開始日が既に到来している(<=本日)ものは
    //   別行ではなく「基本価格(00000000/99999999)」に書き込む。アプリ購入画面は基本価格しか
    //   参照しないため、別行のままだと反映されない不具合になる(上新庄/東淡路の事象)。
    //   ※開始日が未来の予約変更は従来どおり日付行として保存し、到来時に別途昇格させる想定。
    if (String(c.endDate) === FOREVER && String(c.startDate) <= today) {
      writes.push(upsertBase(vm, Number(c.price)));
      // 既存の別行(予約変更)が残っていれば期限切れ化して基本価格に集約(重複表示防止)。
      // 基本行(start_dt=00000000)は対象外。実効価格は基本価格が正なので変わらない。
      writes.push({
        text: "update t1pass.club_time_price_tbl set end_dt=$4 where club_cd=$1 and start_dt=$2 and valid_minutes=$3 and start_dt<>$5",
        params: [cc, String(c.startDate), vm, "00000001", BASE_START],
      });
      continue;
    }
    writes.push({
      text: `insert into t1pass.club_time_price_tbl (club_cd, start_dt, valid_minutes, price, end_dt)
             values ($1,$2,$3,$4,$5)
             on conflict (club_cd, start_dt, valid_minutes) do update set price = excluded.price, end_dt = excluded.end_dt`,
      params: [cc, String(c.startDate), vm, Number(c.price), String(c.endDate)],
    });
  }

  if (writes.length === 0) return NextResponse.json({ ok: true, changed: 0 });

  const res = await sshBatch(TARGET, writes);
  if (!res.ok) {
    void writeAudit({ userId: user.email, userName: user.name, action: "joyfit.onetimepass.save", resource: `club:${clubCode}`, clubCodes: [clubCode], detail: { error: res.error }, ip: clientIp(req), result: "error" });
    return NextResponse.json({ error: `保存に失敗しました: ${res.error}` }, { status: 502 });
  }
  void writeAudit({ userId: user.email, userName: user.name, action: "joyfit.onetimepass.save", resource: `club:${clubCode}`, clubCodes: [clubCode], targetCount: writes.length, detail: { baseTiers: base.length, campaigns: campaigns.length }, ip: clientIp(req), result: "ok" });
  return NextResponse.json({ ok: true, changed: writes.length });
}
