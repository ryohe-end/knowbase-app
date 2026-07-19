// app/api/store-settings/fit365-onedaypass/route.ts
//
// FIT365 1dayパス金額設定。fit365sf(entry, MySQL) を ssh-db-proxy(target=fit365entry) 経由で扱う。
//
// 【サーバ負荷対策】相手DB(入会系=本番)への負荷を避けるため:
//   - 一覧(全店) : 相手DBへ直接ライブクエリしない。夜間集計Lambda(fit365-onedaypass-summary)が
//                  1接続で全店を読み DynamoDB(knowbie-fit365-onedaypass) へ書き込む。ここは DDB から読む。
//                  (DDB未整備時のみ、短TTLキャッシュ付きの1回ライブ集計にフォールバック)
//   - 編集(1店舗): 単一店舗のライブクエリ + 書き込み(軽量)。保存時に DDB の該当店も更新。
//
// 【アクセス制御】
//   - 管理者(isHqUser)         : 全店の参照/編集可
//   - 店舗ユーザー(clubCodes有) : 自店舗(clubCode一致)のみ参照/編集可
//
//   GET            → 一覧(スコープ内)   GET ?shopId= → 店舗詳細   POST → 保存
import { NextResponse } from "next/server";
import { getRefundUser, type RefundUser } from "@/lib/refundAuth";
import { isHqUser } from "@/lib/wellnessPass";
import { sshQuery, sshBatch } from "@/lib/sshDbProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET = "fit365entry";
const PRICE_MIN = 700;
const PRICE_MAX = 1500;
const SUMMARY_TABLE = process.env.FIT365_ONEDAYPASS_TABLE || "knowbie-fit365-onedaypass";
const LIST_CACHE_TTL = 5 * 60_000; // フォールバック時の短TTL

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" }));

function jstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
  };
}
const isYmd = (s: any) => typeof s === "string" && /^\d{8}$/.test(s) && s !== "00000000";
const validPrice = (p: any) => Number.isInteger(p) && p >= PRICE_MIN && p <= PRICE_MAX;

// アクセススコープ: admin=全店 / 店舗ユーザー=自clubCodesのみ
function scopeOf(user: RefundUser) {
  return { admin: isHqUser(user), clubCodes: new Set((user.clubCodes || []).map(String)) };
}

// --- 一覧はまず DDB(夜間集計) から。空ならライブ集計(短TTLキャッシュ)にフォールバック ---
let _liveCache: { at: number; rows: any[] } | null = null;
async function loadShopSummaries(): Promise<{ rows: any[]; source: "ddb" | "live" }> {
  try {
    const r = await ddb.send(new ScanCommand({ TableName: SUMMARY_TABLE }));
    if (r.Items && r.Items.length > 0) return { rows: r.Items, source: "ddb" };
  } catch (e) {
    console.error("[fit365-onedaypass] DDB scan failed:", (e as Error)?.message);
  }
  // フォールバック: 相手DBを1回だけライブ集計してキャッシュ(全店横断だがTTLで負荷抑制)
  if (_liveCache && Date.now() - _liveCache.at < LIST_CACHE_TTL) return { rows: _liveCache.rows, source: "live" };
  const today = jstNow().date;
  const res = await sshQuery(TARGET, `
    select s.shop_id, s.name, s.one_day_flg, s.prefecture_id, cl.price as base_price,
           (select cp.price from one_day_cp_price cp where cp.shop_id=s.shop_id and cp.delete_flg=0
             and cp.cp_start_date<=? and cp.cp_end_date>=? order by cp.seq desc limit 1) as current_cp_price
      from shop s left join one_day_shop_price_classification cl on cl.shop_id=s.shop_id
     where s.delete_flag=0 order by s.one_day_flg desc, s.shop_id`, [today, today]);
  if (!res.ok) throw new Error(res.error);
  const rows = res.rows.map((r: any) => ({
    shopId: r.shop_id, name: r.name, oneDayFlg: !!Number(r.one_day_flg), prefectureId: r.prefecture_id,
    basePrice: r.base_price != null ? Number(r.base_price) : null,
    currentPrice: r.current_cp_price != null ? Number(r.current_cp_price) : null,
    clubCode: null, // ライブ経路では clubCode 未解決 (夜間集計で付与)
  }));
  _liveCache = { at: Date.now(), rows };
  return { rows, source: "live" };
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = scopeOf(user);
  const shopId = new URL(req.url).searchParams.get("shopId");
  const today = jstNow().date;

  // --- 店舗詳細(単一店舗ライブクエリ) ---
  if (shopId) {
    if (!/^\d{6}$/.test(shopId)) return NextResponse.json({ error: "shopId invalid" }, { status: 400 });
    // 店舗ユーザーは自店舗のみ (shop→clubCode を DDB で解決して照合)
    if (!scope.admin) {
      const club = await shopClubCode(shopId);
      if (!club || !scope.clubCodes.has(club)) {
        return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
      }
    }
    const res = await sshBatch(TARGET, [
      { text: "select shop_id, name, one_day_flg from shop where shop_id=? and delete_flag=0", params: [shopId] },
      { text: "select shop_classification, price from one_day_shop_price_classification where shop_id=?", params: [shopId] },
      { text: "select seq, price, cp_start_date, cp_end_date from one_day_cp_price where shop_id=? and delete_flg=0 order by cp_start_date, seq", params: [shopId] },
    ]);
    if (!res.ok) return NextResponse.json({ error: `参照に失敗しました: ${res.error}` }, { status: 502 });
    const shop = res.results[0].rows[0];
    if (!shop) return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
    const base = res.results[1].rows[0];
    return NextResponse.json({
      today, priceRange: { min: PRICE_MIN, max: PRICE_MAX },
      shop: { shopId: shop.shop_id, name: shop.name, oneDayFlg: !!Number(shop.one_day_flg) },
      base: base ? { classification: Number(base.shop_classification), price: Number(base.price) } : null,
      campaigns: res.results[2].rows.map((r: any) => ({ seq: Number(r.seq), price: Number(r.price), startDate: String(r.cp_start_date), endDate: String(r.cp_end_date) })),
    });
  }

  // --- 一覧(DDB優先・相手DB負荷を避ける) ---
  let summary;
  try { summary = await loadShopSummaries(); }
  catch (e: any) { return NextResponse.json({ error: `一覧の取得に失敗しました: ${e?.message || e}` }, { status: 502 }); }
  let shops = summary.rows.map((r: any) => ({
    shopId: r.shopId, name: r.name, oneDayFlg: !!r.oneDayFlg, prefectureId: r.prefectureId ?? null,
    basePrice: r.basePrice ?? null, currentPrice: r.currentPrice ?? null, clubCode: r.clubCode ?? null,
  }));
  if (!scope.admin) shops = shops.filter((s: any) => s.clubCode && scope.clubCodes.has(String(s.clubCode)));
  shops.sort((a: any, b: any) => (b.oneDayFlg ? 1 : 0) - (a.oneDayFlg ? 1 : 0) || String(a.shopId).localeCompare(String(b.shopId)));
  return NextResponse.json({ today, priceRange: { min: PRICE_MIN, max: PRICE_MAX }, source: summary.source, isAdmin: scope.admin, shops });
}

// shop_id → clubCode を DDB(集計) から解決
async function shopClubCode(shopId: string): Promise<string | null> {
  try {
    const r = await ddb.send(new GetCommand({ TableName: SUMMARY_TABLE, Key: { shopId } }));
    return r.Item?.clubCode ? String(r.Item.clubCode) : null;
  } catch { return null; }
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = scopeOf(user);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const shopId = String(body?.shopId ?? "");
  if (!/^\d{6}$/.test(shopId)) return NextResponse.json({ error: "shopId invalid" }, { status: 400 });

  // 店舗ユーザーは自店舗のみ書き込み可
  let shopClub: string | null = null;
  if (!scope.admin) {
    shopClub = await shopClubCode(shopId);
    if (!shopClub || !scope.clubCodes.has(shopClub)) {
      return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
    }
  }

  const now = jstNow();
  const writes: { text: string; params: any[] }[] = [];

  if (body.basePrice != null) {
    if (!validPrice(body.basePrice)) return NextResponse.json({ error: `通常価格は ${PRICE_MIN}〜${PRICE_MAX} 円で入力してください` }, { status: 400 });
    writes.push({ text: "update one_day_shop_price_classification set price=? where shop_id=?", params: [Number(body.basePrice), shopId] });
  }

  const campaigns = Array.isArray(body.campaigns) ? body.campaigns : [];
  let maxSeq = 0;
  if (campaigns.some((c: any) => c.seq == null && !c.deleted)) {
    const mx = await sshQuery(TARGET, "select coalesce(max(seq),0) m from one_day_cp_price where shop_id=?", [shopId]);
    if (!mx.ok) return NextResponse.json({ error: `採番に失敗しました: ${mx.error}` }, { status: 502 });
    maxSeq = Number(mx.rows[0]?.m ?? 0);
  }
  for (const c of campaigns) {
    if (c.deleted) {
      if (c.seq != null) writes.push({ text: "update one_day_cp_price set delete_flg=1, update_date=?, update_time=? where shop_id=? and seq=?", params: [now.date, now.time, shopId, Number(c.seq)] });
      continue;
    }
    if (!validPrice(c.price)) return NextResponse.json({ error: `キャンペーン価格は ${PRICE_MIN}〜${PRICE_MAX} 円で入力してください` }, { status: 400 });
    if (!isYmd(c.startDate) || !isYmd(c.endDate)) return NextResponse.json({ error: "キャンペーン期間の日付が不正です (YYYYMMDD)" }, { status: 400 });
    if (String(c.startDate) > String(c.endDate)) return NextResponse.json({ error: "キャンペーン終了日は開始日以降にしてください" }, { status: 400 });
    if (c.seq != null) {
      writes.push({ text: "update one_day_cp_price set price=?, cp_start_date=?, cp_end_date=?, update_date=?, update_time=? where shop_id=? and seq=?", params: [Number(c.price), String(c.startDate), String(c.endDate), now.date, now.time, shopId, Number(c.seq)] });
    } else {
      maxSeq += 1;
      writes.push({ text: "insert into one_day_cp_price (shop_id, seq, price, cp_start_date, cp_end_date, delete_flg, insert_date, insert_time, update_date, update_time) values (?,?,?,?,?,0,?,?,?,?)", params: [shopId, maxSeq, Number(c.price), String(c.startDate), String(c.endDate), now.date, now.time, now.date, now.time] });
    }
  }

  if (writes.length === 0) return NextResponse.json({ ok: true, changed: 0 });

  const res = await sshBatch(TARGET, writes);
  if (!res.ok) {
    void writeAudit({ userId: user.email, userName: user.name, action: "fit365.onedaypass.save", resource: `fit365shop:${shopId}`, clubCodes: shopClub ? [shopClub] : undefined, detail: { error: res.error }, ip: clientIp(req), result: "error" });
    return NextResponse.json({ error: `保存に失敗しました: ${res.error}` }, { status: 502 });
  }

  // 一覧用DDBの該当店だけ最新化 (相手DB負荷なし: 単一店舗の再取得)
  await refreshSummaryRow(shopId).catch((e) => console.error("[fit365-onedaypass] summary refresh failed:", (e as Error)?.message));

  void writeAudit({ userId: user.email, userName: user.name, action: "fit365.onedaypass.save", resource: `fit365shop:${shopId}`, clubCodes: shopClub ? [shopClub] : undefined, targetCount: writes.length, detail: { shopId, basePrice: body.basePrice ?? null, campaignChanges: campaigns.length }, ip: clientIp(req), result: "ok" });
  return NextResponse.json({ ok: true, changed: writes.length });
}

// 保存後: 該当店の集計行(通常価格/本日CP価格)だけ更新。clubCode は既存値を保持。
async function refreshSummaryRow(shopId: string) {
  const today = jstNow().date;
  const res = await sshQuery(TARGET, `
    select s.name, s.one_day_flg, s.prefecture_id, cl.price base_price,
           (select cp.price from one_day_cp_price cp where cp.shop_id=s.shop_id and cp.delete_flg=0 and cp.cp_start_date<=? and cp.cp_end_date>=? order by cp.seq desc limit 1) current_cp
      from shop s left join one_day_shop_price_classification cl on cl.shop_id=s.shop_id
     where s.shop_id=? and s.delete_flag=0`, [today, today, shopId]);
  if (!res.ok || !res.rows[0]) return;
  const r = res.rows[0];
  let clubCode: string | null = null;
  try { const g = await ddb.send(new GetCommand({ TableName: SUMMARY_TABLE, Key: { shopId } })); clubCode = g.Item?.clubCode ?? null; } catch {}
  await ddb.send(new PutCommand({ TableName: SUMMARY_TABLE, Item: {
    shopId, name: r.name, oneDayFlg: !!Number(r.one_day_flg), prefectureId: r.prefecture_id,
    basePrice: r.base_price != null ? Number(r.base_price) : null,
    currentPrice: r.current_cp != null ? Number(r.current_cp) : null,
    clubCode, updatedAt: new Date().toISOString(),
  } }));
  _liveCache = null; // ライブキャッシュも無効化
}
