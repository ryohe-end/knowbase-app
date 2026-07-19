// app/api/store-settings/onetime-pass/checkoff/route.ts
//
// EnjoyTimePass チケットのステータス操作 (相手本番DB t1pass への書き込み)。
// 正式な ticket_stat: B=未使用 / N=未使用(購入直後) / U=利用中 / Z=使用済 / E=期限切 / D=削除済
//   action:
//     "use"    消し込み(使用済にする)  → B→Z。終了日時(endDt)を受け取り、
//                start_dt = endDt − max_hour(分)、end_dt = endDt(YYYYMMDDHH24MISS)。
//     "unuse"  未使用に戻す(消込の取消) → Z/U→B。start_dt=null。
//     "cancel" 取り消し(削除)          → B/N/U/Z/E→D。
//
// 安全策(本番DB書き込み): 担当店舗スコープ / 許可元ステータスのみ / 一意特定してから条件付きUPDATE / 監査ログ。
//   POST { clubCode, ticketId, action, endDt? }  → { ok, ticketId, status, usedAt }
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { sshQuery } from "@/lib/sshDbProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET = "onetimepass";
type Action = "use" | "unuse" | "cancel";

// action ごとの: 許可元ステータス / 遷移先 / フロント表示状態
const OPS: Record<Action, { from: string[]; to: string; frontStatus: "used" | "purchased" | "refunded" }> = {
  use:    { from: ["B", "N"],                to: "Z", frontStatus: "used" },
  unuse:  { from: ["Z", "U"],                to: "B", frontStatus: "purchased" },
  cancel: { from: ["B", "N", "U", "Z", "E"], to: "D", frontStatus: "refunded" },
};

// JST の epoch(ms) → 'YYYYMMDDHHmmss' (end_dt 用, JST 壁時計)
function jstStamp(ms: number): string {
  const d = new Date(ms + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
// 'YYYY-MM-DD HH:mm(:ss)' (JST) or ISO → epoch(ms)。不正は NaN。
function parseJst(s: string): number {
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(t)) return Date.parse(t.replace(" ", "T") + "+09:00");
  return Date.parse(t);
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const clubCode = String(body?.clubCode ?? "").trim();
  const ticketId = String(body?.ticketId ?? "").trim();
  const action = String(body?.action ?? "use") as Action;
  if (!/^\d+$/.test(clubCode)) return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  if (!ticketId) return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
  const op = OPS[action];
  if (!op) return NextResponse.json({ error: "invalid action" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });

  const clubCd = Number(clubCode);

  // 消し込みは利用した期間(開始・終了)を指定する。開始必須、終了は省略時 開始+利用時間(max_hour)。
  let startMs = NaN;
  let endMs = NaN;
  if (action === "use") {
    startMs = parseJst(String(body?.startDt ?? ""));
    if (!Number.isFinite(startMs)) return NextResponse.json({ error: "利用開始日時(startDt)を指定してください" }, { status: 400 });
    if (body?.endDt) {
      endMs = parseJst(String(body.endDt));
      if (!Number.isFinite(endMs)) return NextResponse.json({ error: "利用終了日時(endDt)が不正です" }, { status: 400 });
    }
    if (Number.isFinite(endMs) && endMs <= startMs) return NextResponse.json({ error: "終了日時は開始日時より後にしてください" }, { status: 400 });
    if (startMs > Date.now() + 60 * 60 * 1000) return NextResponse.json({ error: "利用開始日時が未来すぎます" }, { status: 400 });
  }

  // 1) 対象チケットを一意に特定
  const sel = await sshQuery(
    TARGET,
    `select seq, access_key, ticket_stat, max_hour from t1pass.ticket_tbl
       where club_cd = $1 and coalesce(order_id, seq::text) = $2`,
    [clubCd, ticketId]
  );
  if (!sel.ok) return NextResponse.json({ error: `対象の取得に失敗しました: ${sel.error}` }, { status: 502 });
  if (sel.rows.length === 0) return NextResponse.json({ error: "対象チケットが見つかりません" }, { status: 404 });
  if (sel.rows.length > 1) return NextResponse.json({ error: "対象チケットを一意に特定できませんでした" }, { status: 409 });
  const row = sel.rows[0];
  const cur = String(row.ticket_stat);
  if (!op.from.includes(cur)) {
    return NextResponse.json({ error: `現在のステータスではこの操作はできません（現状: ${cur}）` }, { status: 409 });
  }

  // 2) 条件付き UPDATE
  let setClause: string;
  let params: any[];
  if (action === "use") {
    const maxHour = Number(row.max_hour) || 0; // 実際は「分」
    // 終了未指定なら 開始 + 利用時間(max_hour)
    const effEndMs = Number.isFinite(endMs) ? endMs : startMs + maxHour * 60 * 1000;
    const startIso = new Date(startMs).toISOString();
    const endStamp = jstStamp(effEndMs);
    setClause = "ticket_stat = $1, start_dt = $6::timestamptz, end_dt = $7";
    params = [op.to, clubCd, row.seq, row.access_key, cur, startIso, endStamp];
  } else if (action === "unuse") {
    setClause = "ticket_stat = $1, start_dt = null";
    params = [op.to, clubCd, row.seq, row.access_key, cur];
  } else {
    setClause = "ticket_stat = $1"; // cancel: 状態のみ D に
    params = [op.to, clubCd, row.seq, row.access_key, cur];
  }
  const upd = await sshQuery(
    TARGET,
    `update t1pass.ticket_tbl set ${setClause}
      where club_cd = $2 and seq = $3 and access_key = $4 and ticket_stat = $5`,
    params
  );
  if (!upd.ok) {
    await writeAudit({ userId: user.email, userName: user.name, action: `onetimepass.ticket.${action}`, resource: `club:${clubCode}`, clubCodes: [clubCode], detail: { ticketId, from: cur, to: op.to, error: upd.error }, ip: clientIp(req), result: "error" });
    return NextResponse.json({ error: `操作に失敗しました: ${upd.error}` }, { status: 502 });
  }
  if ((upd.rowCount ?? 0) !== 1) return NextResponse.json({ error: "対象が更新されませんでした（状態が変化した可能性）" }, { status: 409 });

  const usedAt = action === "use" ? new Date(startMs).toISOString() : action === "unuse" ? null : undefined;
  await writeAudit({ userId: user.email, userName: user.name, action: `onetimepass.ticket.${action}`, resource: `club:${clubCode}`, clubCodes: [clubCode], targetCount: 1, detail: { ticketId, from: cur, to: op.to, startDt: action === "use" ? new Date(startMs).toISOString() : undefined }, ip: clientIp(req), result: "ok" });

  return NextResponse.json({ ok: true, ticketId, status: op.frontStatus, usedAt });
}
