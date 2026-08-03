// app/api/store-settings/option-usage/route.ts
//
// オプション都度利用の参照(読み取り専用)。デジタルチケット系:
//   設定 = dgtk_app (shop_option × option_master × option_price)  … 店舗の提供オプションと料金
//   販売 = dgtk_sys.ticket (usage='OPTN')                         … オプション都度購入の実績
// SSHトンネル(knowbie-ssh-db-proxy)経由。価格/提供設定はデジタルチケット側で管理(表示のみ)。
//   GET ?clubCode=104
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { sshQuery, sshBatch } from "@/lib/sshDbProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// 相手DB負荷対策: 店舗単位の短TTLキャッシュ(管理者の連続閲覧でも都度叩かない)
const CACHE_TTL_MS = 5 * 60_000;
const _cache = new Map<string, { at: number; body: any }>();

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const clubCode = (new URL(req.url).searchParams.get("clubCode") || "").trim();
  if (!/^\d+$/.test(clubCode)) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) return NextResponse.json({ ok: false, error: "この店舗は担当外です" }, { status: 403 });

  const hit = _cache.get(clubCode);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.body, cached: true });
  }

  const club6 = clubCode.padStart(6, "0");   // shop_option.club_code は6桁ゼロ埋め
  const clubInt = Number(clubCode);          // ticket.ticket_sales_club は整数
  const today = todayYmd();

  // 【高速化】SSHトンネルの往復を減らすため、独立クエリは並列＋同一DBはバッチ化する。
  //   Stage1(並列): dgtk_app(提供オプション) ‖ dgtk_sys(月次販売 + 直近50件を1トンネルで)
  //   Stage2      : dgtk_app(直近の会員番号解決。Stage1のholder依存のため後段)
  const optSql =
    `select trim(m.option_code) code, m.option_name name, m.brand brand, m.repeat repeat, p.price price,
            s.start_date, s.end_date
     from dgtk_app.shop_option s
     join dgtk_app.option_master m on m.option_code = s.option_code and m.brand = s.brand
     left join dgtk_app.option_price p on p.option_code = s.option_code and p.brand = s.brand
          and p.option_start <= $2 and p.option_end >= $2
     where s.club_code = $1
     order by m.order_id`;
  const salesSql =
    `select substr(ticket_sales_date,1,6) ym, count(*) cnt, coalesce(sum(club_income),0) income
     from dgtk_sys.ticket
     where usage='OPTN' and ticket_sales_club = $1
       and ticket_sales_date >= to_char(now() - interval '12 months','YYYYMM') || '01'
     group by 1 order by 1`;
  const recentSql =
    `select ticket_name name, ticket_holder_id holder, ticket_payment_dt bought, ticket_consume_dt used
     from dgtk_sys.ticket where usage='OPTN' and ticket_sales_club = $1
     order by ticket_payment_dt desc nulls last limit 50`;

  const [optRes, sysRes] = await Promise.all([
    sshQuery("dgtk_app", optSql, [club6, today]),
    sshBatch("dgtk_sys", [
      { text: salesSql, params: [clubInt] },
      { text: recentSql, params: [clubInt] },
    ]),
  ]);

  if (!optRes.ok) {
    return NextResponse.json({ ok: false, error: `オプション設定の取得に失敗しました: ${optRes.error}` }, { status: 502 });
  }
  const options = optRes.rows.map((r: any) => ({
    code: r.code, name: (r.name || "").trim(), brand: (r.brand || "").trim(),
    repeatable: r.repeat !== "N", price: r.price != null ? Number(r.price) : null,
  }));

  const salesRows: any[] = sysRes.ok ? (sysRes.results[0]?.rows || []) : [];
  const monthly = salesRows.map((r: any) => ({ ym: `${r.ym.slice(0, 4)}-${r.ym.slice(4, 6)}`, count: Number(r.cnt), income: Number(r.income) }));
  const totalCount = monthly.reduce((s, m) => s + m.count, 0);
  const totalIncome = monthly.reduce((s, m) => s + m.income, 0);

  const recent: any[] = sysRes.ok ? (sysRes.results[1]?.rows || []) : [];
  const holders = [...new Set(recent.map((r: any) => r.holder).filter(Boolean))] as string[];
  const memberMap: Record<string, string> = {};
  if (holders.length) {
    const inList = holders.map((_, i) => `$${i + 1}`).join(",");
    const mRes = await sshQuery("dgtk_app",
      `select distinct ticket_holder_id h, member_id m from dgtk_app.readqr_history where ticket_holder_id in (${inList}) and member_id is not null`, holders);
    if (mRes.ok) for (const r of mRes.rows as any[]) memberMap[r.h] = String(r.m).trim();
  }
  const purchases = recent.map((r: any) => ({
    option: (r.name || "").trim(),
    memberId: memberMap[r.holder] || null,
    boughtAt: r.bought ? new Date(r.bought).toISOString() : null,
    usedAt: r.used ? new Date(r.used).toISOString() : null,
  }));

  const body = {
    ok: true, clubCode, readOnly: true,
    options,
    sales: { monthly, totalCount, totalIncome, months: monthly.length },
    purchases,
    source: "デジタルチケット (dgtk_app / dgtk_sys)",
  };
  _cache.set(clubCode, { at: Date.now(), body });
  if (_cache.size > 300) { const o = [..._cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (o) _cache.delete(o[0]); }
  return NextResponse.json(body);
}
