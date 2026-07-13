// app/api/store-settings/push/route.ts
//
// Push通知 + APPお知らせ欄 の本番実装。モックを廃し、会員DB(Fly PG, proxy経由)の
// information2 / information2_destination を読み書きする。送信は member-app-server の
// 既存 cron(3分毎)に委ねる (このroute は「お知らせを作る」だけ)。
//
// cron の送信条件 (server/dbService/information/information.service.ts#selectNotificationTargets):
//   status='wait' AND is_private=false AND start_at <= now() <= end_at
//   → 即時送信 = start_at=now / 予約配信 = start_at=未来 / 下書き(安全) = is_private=true
//
// ターゲティング (information2_destination):
//   - ALL       … 当該クラブ全員 = club_code=clubCode (店舗トピック)
//   - CONDITION … 抽出した個人 = app_user_id を宛先に列挙 (/members/extract の appUserId)
//
// お知らせ欄の画像は content(HTML) に <img> を埋め込む (今回スコープ)。
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { writeAudit, clientIp } from "@/lib/auditLog";
import { query } from "@/lib/memberDb";
import { createInformation, type AppType } from "@/lib/information";
import type { PushNotification, PushStatus } from "@/types/pushNotification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function brandToAppType(brand?: string): AppType {
  const b = (brand || "").toUpperCase();
  if (b.startsWith("JOYFIT")) return "joyfit";
  if (b === "FIT365") return "fit365";
  return "fit365";
}

// information2 の状態から画面用ステータスを導出
function deriveStatus(row: { is_private: boolean; start_at: string }): PushStatus {
  if (row.is_private) return "DRAFT";
  if (new Date(row.start_at).getTime() > Date.now()) return "SCHEDULED";
  return "SENT";
}

// DB行 → PushNotification (+ appType: プレビューのブランド出し分け用)
function toPush(r: any): PushNotification & { appType?: string } {
  return {
    id: String(r.id),
    title: r.title,
    body: r.content,
    targetType: "CONDITION",
    status: deriveStatus({ is_private: r.is_private, start_at: r.start_at }),
    scheduledAt: new Date(r.start_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    appType: r.app_type ?? undefined,
    stats: {
      targetCount: Number(r.target_count),
      sentCount: Number(r.sent_count),
      openCount: Number(r.open_count),
      errorCount: Number(r.error_count),
    },
  };
}

// ── GET: 一覧 (?clubCode=) / 単体 (?id=) ──
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  // スコープはログインユーザーの clubCodes で決まる (空=admin全クラブ)
  const allowedClubs = user.clubCodes;

  // 単体 (統計 + read_at から実開封タイムライン)
  if (id) {
    const infoId = Number(id);
    if (!Number.isFinite(infoId)) {
      return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
    }
    const head = await query<any>(
      `SELECT i.id, i.title, i.content, i.link_url, i.is_private,
              i.start_at, i.end_at, i.created_at,
              min(d.app_type) AS app_type,
              count(d.*) AS target_count,
              count(*) FILTER (WHERE d.status='done')  AS sent_count,
              count(*) FILTER (WHERE d.status='error') AS error_count,
              count(*) FILTER (WHERE d.read_at IS NOT NULL) AS open_count
       FROM information2 i
       JOIN information2_destination d ON d.information2_id = i.id
       WHERE i.id = $1
       GROUP BY i.id`,
      [infoId]
    );
    if (head.rows.length === 0) {
      return NextResponse.json({ notification: null });
    }
    // 開封タイムライン: read_at を start_at からの経過時間(h)で集計
    const tl = await query<{ hour_offset: number; opens: number }>(
      `SELECT floor(extract(epoch FROM (d.read_at - i.start_at)) / 3600)::int AS hour_offset,
              count(*)::int AS opens
       FROM information2_destination d
       JOIN information2 i ON i.id = d.information2_id
       WHERE d.information2_id = $1 AND d.read_at IS NOT NULL
       GROUP BY 1 ORDER BY 1`,
      [infoId]
    );
    return NextResponse.json({
      notification: toPush(head.rows[0]),
      openTimeline: tl.rows.map((t) => ({ hourOffset: t.hour_offset, opens: t.opens })),
    });
  }

  // 一覧: ログインユーザーの担当クラブ宛(店舗ターゲット) or その店舗の個人宛
  // clubCodes が空の admin は全クラブ (フィルタ無し)。
  const selectCols = `SELECT i.id, i.title, i.content, i.link_url, i.is_private,
            i.start_at, i.end_at, i.created_at,
            min(d.app_type) AS app_type,
            count(d.*) AS target_count,
            count(*) FILTER (WHERE d.status='done')  AS sent_count,
            count(*) FILTER (WHERE d.status='error') AS error_count,
            count(*) FILTER (WHERE d.read_at IS NOT NULL) AS open_count
     FROM information2 i
     JOIN information2_destination d ON d.information2_id = i.id
     LEFT JOIN app_user au ON au.id = d.app_user_id`;
  const tail = ` GROUP BY i.id ORDER BY i.start_at DESC LIMIT 200`;

  const list =
    allowedClubs.length > 0
      ? await query<any>(
          `${selectCols}
           WHERE d.club_code = ANY($1::text[])
              OR (d.app_user_id IS NOT NULL AND au.club_code = ANY($1::text[]))
           ${tail}`,
          [allowedClubs]
        )
      : await query<any>(`${selectCols}${tail}`);
  return NextResponse.json({ notifications: list.rows.map(toPush) });
}

// ── POST: お知らせ作成 (createInformation 経由) ──
interface PushPostBody {
  clubCode?: string;
  brand?: string; // "JOYFIT" | "FIT365"
  title?: string;
  body?: string;
  imageUrl?: string; // お知らせ欄に埋め込む画像
  contentHtml?: string; // AI生成などの完成HTML。あればお知らせ本文にそのまま使う。
  linkUrl?: string;
  targetType?: "ALL" | "CONDITION";
  appUserIds?: number[]; // CONDITION 時の宛先 (抽出結果)
  isImmediate?: boolean;
  scheduledAt?: string; // JST 'YYYY-MM-DD HH:mm'
  endAt?: string; // 掲載終了 (JST)。省略時は開始+90日
  isDraft?: boolean; // true で is_private=true (送信も表示もしない安全な下書き)
}

// Date → JST 'YYYY-MM-DD HH:mm'
function toJstString(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: PushPostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // クラブは複数(clubCodes)または単一(clubCode)
  const bodyClubCodes = Array.isArray((body as any).clubCodes) ? (body as any).clubCodes.map((s: any) => String(s).trim()).filter(Boolean) : [];
  const clubCode = (body.clubCode || bodyClubCodes[0] || "").trim();
  const clubCodes: string[] = bodyClubCodes.length > 0 ? bodyClubCodes : (clubCode ? [clubCode] : []);
  if (clubCodes.length === 0) return NextResponse.json({ ok: false, error: "clubCode(s) required" }, { status: 400 });
  // 担当外クラブへの配信を禁止 (clubCodes 空=admin全クラブ)
  if (user.clubCodes.length > 0) {
    const scope = new Set(user.clubCodes);
    if (clubCodes.some((c) => !scope.has(c))) {
      return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
    }
  }
  const title = (body.title || "").trim();
  const content = (body.body || "").trim();
  if (!title || !content) {
    return NextResponse.json({ ok: false, error: "title and body are required" }, { status: 400 });
  }
  const appType = brandToAppType(body.brand);
  const targetType = body.targetType === "ALL" ? "ALL" : "CONDITION";

  // 宛先
  let destinations: { appUserId?: number; clubCode?: string; appType: AppType }[];
  if (targetType === "ALL") {
    destinations = [{ clubCode, appType }];
  } else {
    const ids = Array.isArray(body.appUserIds) ? body.appUserIds.filter((n) => Number.isFinite(n)) : [];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "appUserIds required for CONDITION" }, { status: 400 });
    }
    destinations = ids.map((appUserId) => ({ appUserId, appType }));
  }

  // 掲載期間
  const startAt = body.isImmediate || !body.scheduledAt ? toJstString(new Date()) : body.scheduledAt;
  const endAt = body.endAt || toJstString(new Date(Date.now() + 90 * 24 * 3600 * 1000)); // 既定90日表示

  // お知らせ欄の本文: AI生成HTML(contentHtml)があればそのまま、無ければ画像+本文を組み立て
  const finalContent = body.contentHtml && body.contentHtml.trim()
    ? body.contentHtml
    : body.imageUrl
    ? `<p><img src="${body.imageUrl}" alt="" style="max-width:100%;height:auto;" /></p>\n${content}`
    : content;

  try {
    const { informationId } = await createInformation({
      title,
      content: finalContent,
      linkUrl: body.linkUrl || null,
      startAt,
      endAt,
      isPrivate: !!body.isDraft, // 下書き=送信も表示もしない
      destinations,
    });
    void writeAudit({
      userId: (user as any).email || (user as any).userId || "unknown",
      userName: (user as any).name,
      action: body.isDraft ? "push.draft" : "push.send",
      clubCodes,
      targetCount: targetType === "ALL" ? undefined : destinations.length,
      resource: `information:${informationId}`,
      detail: { title, brand: body.brand, targetType, isImmediate: !!body.isImmediate, scheduledAt: body.scheduledAt ?? null },
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, id: String(informationId) });
  } catch (e: any) {
    console.error("[push POST] createInformation failed:", e);
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 500 });
  }
}
