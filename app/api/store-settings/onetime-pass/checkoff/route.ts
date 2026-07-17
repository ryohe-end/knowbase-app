// app/api/store-settings/onetime-pass/checkoff/route.ts
//
// 1day / One Time Pass チケットのステータス操作 (相手本番DB t1pass への書き込み)。
//   action:
//     "use"    利用済みにする (消し込み)   → ticket_stat = Z, start_dt = now
//     "unuse"  未使用に戻す (消込の取消)    → ticket_stat = N, start_dt = null
//     "cancel" 取り消し (返金ステータス化)   → ticket_stat = B  ※実際の返金処理は行わない
//
// 安全策 (相手本番DBへの書き込みのため必須):
//   - 担当店舗スコープ (isClubInScope)
//   - 現在ステータスが action ごとの許可元状態のときのみ実行
//   - 対象を SELECT で一意特定してから UPDATE (多重更新防止)
//   - 監査ログ (誰が・いつ・どのチケットを・どう操作したか)
//
//   POST { clubCode, ticketId, action }  → { ok, ticketId, status, usedAt }
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { sshQuery } from "@/lib/sshDbProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET = "onetimepass";

// 取り消し(返金)ステータス。B/D いずれも返金系だが、件数が多く現行稼働している B を採用。
// D に変更する場合はここだけ書き換える。
const CANCEL_STAT = "B";

type Action = "use" | "unuse" | "cancel";

// action ごとの: 許可元ステータス / 遷移先 / start_dt の扱い / 反映後のフロント状態
const OPS: Record<Action, { from: string[]; to: string; startDt: "now" | "null" | "keep"; frontStatus: "used" | "purchased" | "refunded" }> = {
  use:    { from: ["N", "U"],           to: "Z",          startDt: "now",  frontStatus: "used" },
  unuse:  { from: ["Z", "U"],           to: "N",          startDt: "null", frontStatus: "purchased" },
  cancel: { from: ["N", "U", "Z", "E"], to: CANCEL_STAT,  startDt: "keep", frontStatus: "refunded" },
};

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const clubCode = String(body?.clubCode ?? "").trim();
  const ticketId = String(body?.ticketId ?? "").trim();
  const action = String(body?.action ?? "use") as Action;
  if (!/^\d+$/.test(clubCode)) return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  if (!ticketId) return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
  const op = OPS[action];
  if (!op) return NextResponse.json({ error: "invalid action" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) {
    return NextResponse.json({ error: "この店舗は担当外です" }, { status: 403 });
  }

  const clubCd = Number(clubCode);

  // 1) 対象チケットを一意に特定 (id = coalesce(order_id, seq::text))
  const sel = await sshQuery(
    TARGET,
    `select seq, access_key, ticket_stat from t1pass.ticket_tbl
       where club_cd = $1 and coalesce(order_id, seq::text) = $2`,
    [clubCd, ticketId]
  );
  if (!sel.ok) {
    return NextResponse.json({ error: `対象の取得に失敗しました: ${sel.error}` }, { status: 502 });
  }
  if (sel.rows.length === 0) return NextResponse.json({ error: "対象チケットが見つかりません" }, { status: 404 });
  if (sel.rows.length > 1) return NextResponse.json({ error: "対象チケットを一意に特定できませんでした" }, { status: 409 });
  const row = sel.rows[0];
  const cur = String(row.ticket_stat);
  if (!op.from.includes(cur)) {
    return NextResponse.json(
      { error: `現在のステータスではこの操作はできません（現状: ${cur}）` },
      { status: 409 }
    );
  }

  // 2) 一意キー(club_cd + seq + access_key) + 現ステータス条件付きで更新
  const startExpr = op.startDt === "now" ? "now()" : op.startDt === "null" ? "null" : "start_dt";
  const upd = await sshQuery(
    TARGET,
    `update t1pass.ticket_tbl
        set ticket_stat = $1, start_dt = ${startExpr}
      where club_cd = $2 and seq = $3 and access_key = $4 and ticket_stat = $5`,
    [op.to, clubCd, row.seq, row.access_key, cur]
  );
  if (!upd.ok) {
    await writeAudit({
      userId: user.email, userName: user.name, action: `onetimepass.ticket.${action}`,
      resource: `club:${clubCode}`, clubCodes: [clubCode],
      detail: { ticketId, from: cur, to: op.to, error: upd.error }, ip: clientIp(req), result: "error",
    });
    return NextResponse.json({ error: `操作に失敗しました: ${upd.error}` }, { status: 502 });
  }
  if ((upd.rowCount ?? 0) !== 1) {
    return NextResponse.json({ error: "対象が更新されませんでした（状態が変化した可能性）" }, { status: 409 });
  }

  const usedAt = op.startDt === "now" ? new Date().toISOString() : op.startDt === "null" ? null : undefined;
  await writeAudit({
    userId: user.email, userName: user.name, action: `onetimepass.ticket.${action}`,
    resource: `club:${clubCode}`, clubCodes: [clubCode], targetCount: 1,
    detail: { ticketId, from: cur, to: op.to }, ip: clientIp(req), result: "ok",
  });

  return NextResponse.json({ ok: true, ticketId, status: op.frontStatus, usedAt });
}
