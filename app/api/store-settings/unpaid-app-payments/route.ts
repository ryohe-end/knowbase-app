// app/api/store-settings/unpaid-app-payments/route.ts
//
// 「APPで未納金を支払う機能」の支払い実績(サマリー/明細)。FIT365=fit365entry / JOYFIT=ecojoy
// の入会DBを横断し、両方から集計してマージする(両DBとも同一スキーマ:
//   unpaid_history(path_type='APP', paid_flg=1) ⋈ sb_history(way=9) ⋈ shop_convert_view ⋈ shop)。
//
// 【アクセス】管理者=全店 / 店舗ユーザー=自clubCode(casio_shop_id=LPAD(clubCode,6))のみ。
//   同じ casio 群を両DBに投げても、各DBの shop_convert_view が自ブランド分だけ返す。
// 【サーバ負荷】サマリー(全店集計)は 10分キャッシュ。明細はページング。
//   GET ?view=summary&from=&to=            → 合計 + 店舗別内訳
//   GET ?view=detail&clubCode=&memberNo=&from=&to=&page=&pageSize= → 明細(ページング)
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { sshBatch } from "@/lib/sshDbProxy";
import { casioOf } from "@/lib/entryShopMap";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGETS: { target: string; brand: string }[] = [
  { target: "fit365entry", brand: "FIT365" },
  { target: "ecojoy", brand: "JOYFIT" },
];
const SUMMARY_TTL = 10 * 60 * 1000;
const MAX_PAGE_SIZE = 200;
const MAX_MERGE_FETCH = 3000; // 明細マージ時の1DSあたり取得上限(負荷ガード)

const ymd = (s: string | null) => (s && /^\d{4}-?\d{2}-?\d{2}$/.test(s) ? s.replace(/-/g, "") : null);

function buildWhere(opts: { casioIds: string[] | null; memberNo?: string | null; from?: string | null; to?: string | null }) {
  const clauses = ["uh.path_type='APP'", "uh.paid_flg=1"];
  const params: any[] = [];
  if (opts.casioIds) {
    if (opts.casioIds.length === 0) return { sql: "1=0", params };
    clauses.push(`spv.casio_shop_id IN (${opts.casioIds.map(() => "?").join(",")})`);
    params.push(...opts.casioIds);
  }
  if (opts.memberNo) { clauses.push("uh.uid = ?"); params.push(opts.memberNo); }
  if (opts.from) { clauses.push("uh.insert_date >= ?"); params.push(opts.from); }
  if (opts.to) { clauses.push("uh.insert_date <= ?"); params.push(opts.to); }
  return { sql: clauses.join(" AND "), params };
}
const BASE_JOIN = `FROM unpaid_history uh
  INNER JOIN sb_history sb ON sb.member_no=uh.uid AND sb.cust_code=uh.cust_no AND sb.order_id=uh.order_id AND sb.way=9
  INNER JOIN shop_convert_view spv ON spv.town_shop_id=sb.shop_id
  INNER JOIN shop sp ON sp.shop_id=sb.shop_id`;

const summaryCache = new Map<string, { at: number; data: any }>();

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "summary";
  const from = ymd(searchParams.get("from"));
  const to = ymd(searchParams.get("to"));

  const isAdmin = user.clubCodes.length === 0;
  const scopeCasio = isAdmin ? null : user.clubCodes.map(casioOf);

  // ── 明細 ──
  if (view === "detail") {
    const clubCode = searchParams.get("clubCode");
    let casioIds = scopeCasio;
    if (clubCode) {
      const c = casioOf(clubCode);
      if (!isAdmin && !scopeCasio!.includes(c)) return NextResponse.json({ ok: false, error: "この店舗は担当外です" }, { status: 403 });
      casioIds = [c];
    }
    const memberNo = (searchParams.get("memberNo") || "").trim() || null;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50));
    const { sql, params } = buildWhere({ casioIds, memberNo, from, to });
    const fetchN = Math.min(MAX_MERGE_FETCH, page * pageSize);

    const per = await Promise.all(TARGETS.map(async ({ target, brand }) => {
      const res = await sshBatch(target, [
        { text: `SELECT COUNT(*) cnt, COALESCE(SUM(uh.amount),0) total ${BASE_JOIN} WHERE ${sql}`, params },
        { text: `SELECT uh.uid, uh.amount, uh.insert_date, uh.insert_time, uh.order_id, sp.name ${BASE_JOIN} WHERE ${sql}
                 ORDER BY uh.insert_date DESC, uh.insert_time DESC LIMIT ?`, params: [...params, fetchN] },
      ]);
      if (!res.ok) return { brand, count: 0, total: 0, rows: [] as any[], error: res.error };
      const head = res.results[0].rows[0] || { cnt: 0, total: 0 };
      return {
        brand, count: Number(head.cnt), total: Number(head.total),
        rows: res.results[1].rows.map((r: any) => ({
          memberNo: String(r.uid), amount: Number(r.amount), date: String(r.insert_date), time: String(r.insert_time),
          orderId: String(r.order_id), shopName: String(r.name), brand,
        })),
      };
    }));
    const errors = per.filter((p) => (p as any).error).map((p) => `${p.brand}: ${(p as any).error}`);
    const totalCount = per.reduce((a, p) => a + p.count, 0);
    const totalAmount = per.reduce((a, p) => a + p.total, 0);
    const merged = per.flatMap((p) => p.rows)
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
      .slice((page - 1) * pageSize, page * pageSize);
    // 2DB横断マージのため、page*pageSize が取得上限を超える深いページは正確性を保証できない。
    // 実運用では店舗(=単一ブランド)で絞れば単一DBとなり正確。超過時はフラグで通知。
    const multiBrandActive = per.filter((p) => p.count > 0).length > 1;
    const deepUnreliable = multiBrandActive && page * pageSize > MAX_MERGE_FETCH;
    // 会員別の支払明細(PII)閲覧を監査記録
    void writeAudit({
      userId: (user as any).email || (user as any).userId || "unknown", userName: (user as any).name,
      action: "unpaidApp.detail.view", clubCodes: clubCode ? [clubCode] : (isAdmin ? [] : user.clubCodes),
      targetCount: totalCount, detail: { clubCode: clubCode || null, memberNo: memberNo || null, from, to, page }, ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, page, pageSize, totalCount, totalAmount, rows: merged, deepPageUnreliable: deepUnreliable, warnings: errors.length ? errors : undefined });
  }

  // ── サマリー ──
  const cacheKey = `${isAdmin ? "ALL" : (scopeCasio || []).join(",")}|${from || ""}|${to || ""}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SUMMARY_TTL) return NextResponse.json(cached.data);

  const { sql, params } = buildWhere({ casioIds: scopeCasio, from, to });
  const per = await Promise.all(TARGETS.map(async ({ target, brand }) => {
    const res = await sshBatch(target, [
      { text: `SELECT COUNT(*) cnt, COALESCE(SUM(uh.amount),0) total ${BASE_JOIN} WHERE ${sql}`, params },
      { text: `SELECT spv.casio_shop_id, sp.name, COUNT(*) cnt, COALESCE(SUM(uh.amount),0) total ${BASE_JOIN} WHERE ${sql}
               GROUP BY spv.casio_shop_id, sp.name ORDER BY total DESC`, params },
    ]);
    if (!res.ok) return { brand, count: 0, total: 0, byShop: [] as any[], error: res.error };
    const head = res.results[0].rows[0] || { cnt: 0, total: 0 };
    return {
      brand, count: Number(head.cnt), total: Number(head.total),
      byShop: res.results[1].rows.map((r: any) => ({
        casioShopId: String(r.casio_shop_id), shopName: String(r.name), count: Number(r.cnt), amount: Number(r.total), brand,
      })),
    };
  }));
  const errors = per.filter((p) => (p as any).error).map((p) => `${p.brand}: ${(p as any).error}`);
  const data = {
    ok: true, isAdmin,
    totalCount: per.reduce((a, p) => a + p.count, 0),
    totalAmount: per.reduce((a, p) => a + p.total, 0),
    byShop: per.flatMap((p) => p.byShop).sort((a, b) => b.amount - a.amount),
    warnings: errors.length ? errors : undefined,
  };
  summaryCache.set(cacheKey, { at: Date.now(), data });
  return NextResponse.json(data);
}
