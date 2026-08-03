// app/api/store-settings/option-usage/catalog/route.ts
//
// オプション都度利用「提供オプションの管理（追加=ON専用）」
//   GET  ?clubCode=104        … 店舗ブランドのオプション全カタログ＋現在のON/OFF状態を返す
//   POST { clubCode, optionCode } … 未提供オプションを提供開始（shop_option へ INSERT）
//
// 相手DB(dgtk_app: デジタルチケット)への書き込み。接続ユーザは shop_option に INSERT+SELECT のみ
// (UPDATE/DELETE 権限なし)。よって本APIは「追加(ON)」だけを提供し、停止(OFF)/再開はチケット側に委ねる。
//   状態判定: shop_option 行あり & start<=今日<=end → 提供中(on) / 行あり & end<今日 → 停止中(stopped)
//             行あり & start>今日 → 開始前(scheduled) / 行なし → 未提供(off, 追加可能)
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { sshQuery, sshBatch } from "@/lib/sshDbProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ampl/Lambda は UTC 実行のため JST の YYYYMMDD を明示計算する
function jstYmd(): string {
  const j = new Date(Date.now() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}${String(j.getUTCMonth() + 1).padStart(2, "0")}${String(j.getUTCDate()).padStart(2, "0")}`;
}

type Status = "on" | "stopped" | "scheduled" | "off";
function statusOf(start: string | null, end: string | null, today: string): Status {
  if (!start && !end) return "off";           // 行なし
  const s = (start || "00000000").trim();
  const e = (end || "00000000").trim();
  if (e < today) return "stopped";             // 期限切れ=停止中
  if (s > today) return "scheduled";           // 開始前
  return "on";                                 // 提供中
}

async function resolveCatalog(club6: string, today: string) {
  // 1クエリで「店舗ブランドの全オプション × 現行料金 × 現在の提供状態」を取得
  const sql =
    `select c.brand shop_brand, c.club_name,
            m.option_code, m.option_name, m.repeat, m.order_id,
            p.price,
            s.start_date, s.end_date
     from dgtk_app.club_master c
     join dgtk_app.option_master m on m.brand = c.brand
     left join dgtk_app.option_price p
            on p.option_code = m.option_code and p.brand = m.brand
           and p.option_start <= $2 and p.option_end >= $2
     left join dgtk_app.shop_option s
            on s.club_code = c.club_code and s.option_code = m.option_code and s.brand = m.brand
     where c.club_code = $1
     order by m.order_id`;
  const res = await sshQuery("dgtk_app", sql, [club6, today]);
  return res;
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const clubCode = (new URL(req.url).searchParams.get("clubCode") || "").trim();
  if (!/^\d+$/.test(clubCode)) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) return NextResponse.json({ ok: false, error: "この店舗は担当外です" }, { status: 403 });

  const club6 = clubCode.padStart(6, "0");
  const today = jstYmd();
  const res = await resolveCatalog(club6, today);
  if (!res.ok) return NextResponse.json({ ok: false, error: `カタログ取得に失敗しました: ${res.error}` }, { status: 502 });
  if (!res.rows.length) return NextResponse.json({ ok: false, error: "この店舗のブランド情報が見つかりません（club_master 未登録）" }, { status: 404 });

  const brand = (res.rows[0].shop_brand || "").trim();
  const clubName = (res.rows[0].club_name || "").trim();
  const items = res.rows.map((r: any) => ({
    code: (r.option_code || "").trim(),
    name: (r.option_name || "").trim(),
    repeatable: r.repeat !== "N",
    price: r.price != null ? Number(r.price) : null,
    status: statusOf(r.start_date, r.end_date, today),
    startDate: r.start_date ? String(r.start_date).trim() : null,
    endDate: r.end_date ? String(r.end_date).trim() : null,
  }));
  return NextResponse.json({ ok: true, clubCode, clubName, brand, today, items });
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { /* noop */ }
  const clubCode = String(body?.clubCode || "").trim();
  const optionCode = String(body?.optionCode || "").trim();
  if (!/^\d+$/.test(clubCode) || !/^\d{1,6}$/.test(optionCode)) {
    return NextResponse.json({ ok: false, error: "clubCode / optionCode が不正です" }, { status: 400 });
  }
  if (!isClubInScope(user, clubCode)) return NextResponse.json({ ok: false, error: "この店舗は担当外です" }, { status: 403 });

  const club6 = clubCode.padStart(6, "0");
  const today = jstYmd();

  // 開始日/終了日(YYYYMMDD)。未指定なら 開始=今日 / 終了=無期限('99999999')
  const startDate = String(body?.startDate || "").trim() || today;
  const endDate = String(body?.endDate || "").trim() || "99999999";
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate)) {
    return NextResponse.json({ ok: false, error: "開始日・終了日は YYYYMMDD 形式で指定してください" }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json({ ok: false, error: "終了日は開始日以降にしてください" }, { status: 400 });
  }

  // 提供開始(ON)。INSERT...SELECT で「①店舗のブランドに属するオプションであること
  // ②既存行が無いこと」をDB側で保証。既存行(提供中/停止中)がある場合は0件INSERTになる。
  // $2(option_code) は char列への代入と trim比較の両方で使うため ::text で型を固定する
  //   $3=開始日 / $4=終了日
  const insertSql =
    `insert into dgtk_app.shop_option (club_code, option_code, brand, start_date, end_date)
     select $1, $2::text, c.brand, $3, $4
     from dgtk_app.club_master c
     where c.club_code = $1
       and exists (select 1 from dgtk_app.option_master m
                    where m.brand = c.brand and trim(m.option_code) = $2::text)
       and not exists (select 1 from dgtk_app.shop_option s
                        where s.club_code = $1 and trim(s.option_code) = $2::text and s.brand = c.brand)`;
  // INSERT のあと同一トンネルで結果状態を取得して権威ある状態を返す
  const statusSql =
    `select s.start_date, s.end_date
     from dgtk_app.shop_option s
     join dgtk_app.club_master c on c.club_code = s.club_code and s.brand = c.brand
     where s.club_code = $1 and trim(s.option_code) = $2::text`;

  const batch = await sshBatch("dgtk_app", [
    { text: insertSql, params: [club6, optionCode, startDate, endDate] },
    { text: statusSql, params: [club6, optionCode] },
  ]);
  if (!batch.ok) {
    return NextResponse.json({ ok: false, error: `提供開始に失敗しました: ${batch.error}` }, { status: 502 });
  }
  const inserted = batch.results[0]?.rowCount || 0;   // INSERT した行数(1=追加成功 / 0=既存 or 対象外)
  const rows = batch.results[1]?.rows || [];
  const st = rows.length ? statusOf(rows[0].start_date, rows[0].end_date, today) : "off";

  // 監査: 相手本番DBへの書き込みは操作者を必ず記録
  console.log(`[option-catalog] enable club=${club6} option=${optionCode} start=${startDate} end=${endDate} by=${user.email} inserted=${inserted} status=${st}`);

  if (inserted > 0) {
    return NextResponse.json({ ok: true, clubCode, optionCode, status: st, message: "提供を開始しました" });
  }
  // 0件挿入だった理由を状態から説明
  if (st === "on") {
    return NextResponse.json({ ok: false, status: st, error: "このオプションは既に提供中です。" }, { status: 409 });
  }
  if (st === "stopped" || st === "scheduled") {
    return NextResponse.json({ ok: false, status: st, error: "このオプションには既存の設定行があります。再開はデジタルチケット側で行ってください。" }, { status: 409 });
  }
  return NextResponse.json({ ok: false, status: "off", error: "追加できませんでした（対象オプションが店舗ブランドに存在しないか、追加条件を満たしません）。" }, { status: 409 });
}
