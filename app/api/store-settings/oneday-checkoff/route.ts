// app/api/store-settings/oneday-checkoff/route.ts
//
// FIT365 1dayパス チケットの消し込み。入会DB(fit365entry) の one_day_ticket を操作する。
// EnjoyTimePass(ticket_tbl)と違い ticket_stat 列は無く、状態はフラグ/日付から導出する:
//   未使用 = payment_flg=1 AND use_date 空 AND is_expired=0 AND del_flg=0
//   消し込み(use)   = use_date/use_time に利用日時をセット (1dayは時間枠が無いので開始/終了計算は不要)
//   未使用に戻す(unuse)= use_date/use_time を NULL に戻す
// キー = token + serial_number。店舗は shop_convert_view(casio_shop_id=LPAD(clubCode,6))でスコープ。
//
//   GET  ?month=YYYYMM&shopName=&memberNo=&clubCode=  → 未使用チケット一覧(スコープ内)
//   POST { token, serialNumber, action:'use'|'unuse', useDt? }  → 消し込み/取消
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { sshBatch, sshQuery } from "@/lib/sshDbProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET = "fit365entry";
const casioOf = (c: string) => String(c).replace(/\D/g, "").padStart(6, "0").slice(-6);
const LIST_LIMIT = 500;

// 'YYYY-MM-DDTHH:mm(:ss)'(JST) → { date:'YYYYMMDD', time:'HHMMSS' }。不正は null。
function jstParts(s: string): { date: string; time: string } | null {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return { date: `${m[1]}${m[2]}${m[3]}`, time: `${m[4]}${m[5]}${m[6] || "00"}` };
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const isAdmin = !user.clubCodes || user.clubCodes.length === 0;

  const clauses = ["t.payment_flg=1", "(t.use_date IS NULL OR t.use_date='')", "t.is_expired=0", "t.del_flg=0"];
  const params: any[] = [];

  // スコープ (casio_shop_id)
  const clubCode = sp.get("clubCode");
  let casioIds: string[] | null = isAdmin ? null : user.clubCodes.map(casioOf);
  if (clubCode) {
    const c = casioOf(clubCode);
    if (!isAdmin && !casioIds!.includes(c)) return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
    casioIds = [c];
  }
  if (casioIds) {
    if (casioIds.length === 0) return NextResponse.json({ tickets: [] });
    clauses.push(`spv.casio_shop_id IN (${casioIds.map(() => "?").join(",")})`);
    params.push(...casioIds);
  }
  const month = sp.get("month");
  if (month && /^\d{6}$/.test(month)) { clauses.push("LEFT(t.purchase_date,6)=?"); params.push(month); }
  const shopName = (sp.get("shopName") || "").trim();
  if (shopName) { clauses.push("sp.name LIKE ?"); params.push(`%${shopName}%`); }
  const memberNo = (sp.get("memberNo") || "").trim();
  if (memberNo) { clauses.push("t.member_no=?"); params.push(memberNo); }
  // 氏名/カナ 部分一致 (member.own_name_js=氏名, own_name_cc=カナ)
  const name = (sp.get("name") || "").trim();
  if (name) { clauses.push("(m.own_name_js LIKE ? OR m.own_name_cc LIKE ?)"); params.push(`%${name}%`, `%${name}%`); }

  const res = await sshBatch(TARGET, [{
    text: `SELECT t.token, t.serial_number, t.member_no, t.shop_id, sp.name shop_name, spv.casio_shop_id,
                  t.purchase_date, t.purchase_time, t.expiration_date, t.expiration_time,
                  m.own_name_js member_name, m.own_name_cc member_kana
             FROM one_day_ticket t
             INNER JOIN shop_convert_view spv ON spv.town_shop_id=t.shop_id
             INNER JOIN shop sp ON sp.shop_id=t.shop_id
             LEFT JOIN member m ON m.shop_id=t.shop_id AND m.member_no=t.member_no
            WHERE ${clauses.join(" AND ")}
            ORDER BY t.purchase_date DESC, t.purchase_time DESC LIMIT ${LIST_LIMIT}`,
    params,
  }]);
  if (!res.ok) return NextResponse.json({ error: `取得に失敗しました: ${res.error}`, tickets: [] }, { status: 502 });
  return NextResponse.json({
    tickets: res.results[0].rows.map((r: any) => ({
      token: String(r.token), serialNumber: Number(r.serial_number), memberNo: String(r.member_no || ""),
      memberName: String(r.member_name || ""), memberKana: String(r.member_kana || ""),
      shopName: String(r.shop_name || ""), casioShopId: String(r.casio_shop_id),
      purchaseDate: String(r.purchase_date || ""), purchaseTime: String(r.purchase_time || ""),
      expirationDate: String(r.expiration_date || ""),
    })),
    limited: res.results[0].rows.length >= LIST_LIMIT,
  });
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const token = String(body?.token ?? "").trim();
  const serialNumber = Number(body?.serialNumber);
  const action = String(body?.action ?? "use");
  if (!token || !Number.isInteger(serialNumber)) return NextResponse.json({ error: "token/serialNumber が不正です" }, { status: 400 });
  if (action !== "use" && action !== "unuse") return NextResponse.json({ error: "invalid action" }, { status: 400 });

  // 1) 対象を特定し、店舗スコープ + 現在状態を確認
  const sel = await sshQuery(
    TARGET,
    `SELECT t.shop_id, spv.casio_shop_id, t.use_date, t.payment_flg, t.del_flg, t.is_expired
       FROM one_day_ticket t INNER JOIN shop_convert_view spv ON spv.town_shop_id=t.shop_id
      WHERE t.token=? AND t.serial_number=?`,
    [token, serialNumber]
  );
  if (!sel.ok) return NextResponse.json({ error: `対象の取得に失敗しました: ${sel.error}` }, { status: 502 });
  if (sel.rows.length === 0) return NextResponse.json({ error: "対象チケットが見つかりません" }, { status: 404 });
  const t = sel.rows[0];
  const clubCandidate = String(Number(t.casio_shop_id)); // 000375 → 375
  if (!isClubInScope(user, clubCandidate) && !isClubInScope(user, String(t.casio_shop_id))) {
    return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
  }
  const used = t.use_date != null && String(t.use_date) !== "";

  let setClause: string;
  let setParams: any[] = [];
  let usedAtIso: string | null | undefined;
  if (action === "use") {
    if (used) return NextResponse.json({ error: "既に使用済みのチケットです" }, { status: 409 });
    if (Number(t.del_flg) === 1 || Number(t.is_expired) === 1 || Number(t.payment_flg) !== 1) {
      return NextResponse.json({ error: "このチケットは消し込みできません（削除/期限切/未払い）" }, { status: 409 });
    }
    const parts = jstParts(String(body?.useDt ?? ""));
    if (!parts) return NextResponse.json({ error: "利用日時(useDt)を指定してください" }, { status: 400 });
    setClause = "use_date=?, use_time=?"; // パラメータ化(値はjstPartsで数字のみに検証済だが安全側)
    setParams = [parts.date, parts.time];
    usedAtIso = new Date(Date.parse(String(body.useDt).replace(" ", "T") + "+09:00")).toISOString();
  } else {
    if (!used) return NextResponse.json({ error: "未使用のチケットです（戻す必要はありません）" }, { status: 409 });
    setClause = "use_date=NULL, use_time=NULL";
    usedAtIso = null;
  }

  // 2) 条件付き UPDATE (状態が変わっていないときのみ)
  const guard = action === "use" ? "AND (use_date IS NULL OR use_date='')" : "AND use_date IS NOT NULL AND use_date<>''";
  const upd = await sshQuery(
    TARGET,
    `UPDATE one_day_ticket SET ${setClause} WHERE token=? AND serial_number=? ${guard}`,
    [...setParams, token, serialNumber]
  );
  if (!upd.ok) {
    await writeAudit({ userId: user.email, userName: user.name, action: `oneday.ticket.${action}`, resource: `token:${token}`, clubCodes: [clubCandidate], detail: { serialNumber, error: upd.error }, ip: clientIp(req), result: "error" });
    return NextResponse.json({ error: `操作に失敗しました: ${upd.error}` }, { status: 502 });
  }
  if ((upd.rowCount ?? 0) !== 1) return NextResponse.json({ error: "対象が更新されませんでした（状態が変化した可能性）" }, { status: 409 });
  await writeAudit({ userId: user.email, userName: user.name, action: `oneday.ticket.${action}`, resource: `token:${token}`, clubCodes: [clubCandidate], targetCount: 1, detail: { serialNumber, useDt: usedAtIso }, ip: clientIp(req), result: "ok" });
  return NextResponse.json({ ok: true, token, serialNumber, status: action === "use" ? "used" : "unused", usedAt: usedAtIso });
}
