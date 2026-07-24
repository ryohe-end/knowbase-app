// app/api/store-settings/push/test/route.ts
//
// PUSH/お知らせのテスト送信。指定した複数の会員番号(app_user.member_id)にだけ、作成中の内容を
// 即時配信する(本番配信の事前確認用)。タイトルに[テスト]を付与。cron が拾って送信・お知らせ表示。
// 担当スコープ内の会員のみ。
//   POST { memberNos: string[](またはカンマ改行区切り), title, body, contentHtml?, brand, clubCode }  → { ok, sent, notFound }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/memberDb";
import { createInformation, type AppType } from "@/lib/information";
import { writeAudit, clientIp } from "@/lib/auditLog";
import { oracleAppMembersInClubs } from "@/lib/memberScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function brandToAppType(brand?: string): AppType {
  const b = (brand || "").toUpperCase();
  if (b.startsWith("JOYFIT")) return "joyfit";
  return "fit365";
}
function toJstString(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const raw: string[] = Array.isArray(body?.memberNos) ? body.memberNos : String(body?.memberNos || body?.memberNo || "").split(/[\s,;、]+/);
  const seen = new Set<string>();
  const memberNos = raw.map((s) => String(s).trim()).filter((s) => s && !seen.has(s) && seen.add(s));
  if (memberNos.length === 0) return NextResponse.json({ ok: false, error: "テスト送信先の会員番号を入力してください" }, { status: 400 });
  if (memberNos.length > 50) return NextResponse.json({ ok: false, error: "テスト送信は50件までにしてください" }, { status: 400 });

  const title = String(body?.title || "").trim();
  const content = String(body?.body || "").trim();
  if (!title || !content) return NextResponse.json({ ok: false, error: "タイトルと本文を入力してください" }, { status: 400 });

  // 会員番号 → app_user。担当スコープは Oracle の会員契約クラブで判定する(admin=clubCodes空は全件)。
  // app_user.club_code(アプリ登録クラブ)や member_id 先頭(発行クラブ)は契約クラブと異なる
  // ことがあり誤判定になるため使わない。担当クラブに契約している会員番号集合(Oracle)で絞り込む。
  const scoped = user.clubCodes.length > 0;
  const rows = await query<{ id: number; member_id: string; club_code: string }>(
    `SELECT id, member_id, club_code FROM app_user WHERE member_id = ANY($1::text[])`,
    [memberNos]
  );
  let found = rows.rows;
  if (scoped) {
    const inScope = await oracleAppMembersInClubs(user.clubCodes);
    found = found.filter((r) => inScope.has(String(r.member_id)));
  }
  if (found.length === 0) return NextResponse.json({ ok: false, error: "該当するアプリ会員が見つかりません（会員番号・担当店舗を確認してください）" }, { status: 404 });
  const foundNos = new Set(found.map((r) => String(r.member_id)));
  const notFound = memberNos.filter((m) => !foundNos.has(m));

  const appType = brandToAppType(body?.brand);
  const startAt = toJstString(new Date());
  const endAt = toJstString(new Date(Date.now() + 7 * 24 * 3600 * 1000));
  const finalContent = body?.contentHtml && String(body.contentHtml).trim() ? String(body.contentHtml) : content;

  try {
    const { informationId } = await createInformation({
      title: `[テスト] ${title}`,
      content: finalContent,
      linkUrl: body?.linkUrl || null,
      startAt, endAt, isPrivate: false,
      destinations: found.map((r) => ({ appUserId: r.id, appType })),
    });
    void writeAudit({
      userId: (user as any).email || (user as any).userId || "unknown", userName: (user as any).name,
      action: "push.test", targetCount: found.length, resource: `information:${informationId}`,
      detail: { title, brand: body?.brand, sent: found.length, notFound }, ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, sent: found.length, notFound });
  } catch (e: any) {
    console.error("[push test] failed:", e);
    return NextResponse.json({ ok: false, error: "テスト送信に失敗しました" }, { status: 500 });
  }
}
