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
import { checkSendGuards } from "@/lib/sendGuards";
import { query } from "@/lib/memberDb";
import { createInformation, type AppType } from "@/lib/information";
import { getClubNames } from "@/lib/clubScope";
import { putPushMeta, batchGetPushMeta } from "@/lib/pushMeta";
import type { PushNotification, PushStatus, PushPerson } from "@/types/pushNotification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// HTML属性値エスケープ (imageUrl の src 属性インジェクション対策)
function attrEscape(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// NGワード判定用: HTMLタグを除去してタグ跨ぎの回避を防ぐ
function stripTags(s: string): string {
  return String(s).replace(/<[^>]*>/g, " ");
}

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
  const clubCodes: string[] = Array.isArray(r.club_codes) ? r.club_codes.map(String).filter(Boolean) : [];
  return {
    id: String(r.id),
    title: r.title,
    body: r.content,
    targetType: "CONDITION",
    status: deriveStatus({ is_private: r.is_private, start_at: r.start_at }),
    scheduledAt: new Date(r.start_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    appType: r.app_type ?? undefined,
    clubCodes,
    stats: {
      targetCount: Number(r.target_count),
      sentCount: Number(r.sent_count),
      openCount: Number(r.open_count),
      errorCount: Number(r.error_count),
    },
  };
}

// 一覧/詳細に クラブ名 と 配信者名 を付与する (knowbie-clubs + knowbie-push-meta)。
async function enrichPush(items: (PushNotification & { appType?: string })[]): Promise<void> {
  const allCodes = new Set<string>();
  for (const it of items) for (const c of it.clubCodes || []) allCodes.add(c);
  const [nameMap, metaMap] = await Promise.all([
    getClubNames([...allCodes]),
    batchGetPushMeta(items.map((i) => i.id)),
  ]);
  for (const it of items) {
    it.clubNames = (it.clubCodes || []).map((c) => nameMap[c] || c);
    const meta = metaMap[it.id];
    if (meta) {
      it.senderName = meta.createdByName || meta.createdBy;
      // メタに配信先が保存されていて、集計側にクラブが無い場合の補完
      if ((!it.clubCodes || it.clubCodes.length === 0) && meta.clubCodes?.length) {
        it.clubCodes = meta.clubCodes;
        it.clubNames = meta.clubCodes.map((c) => nameMap[c] || c);
      }
    }
  }
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
    // 担当外の通知を閲覧できないようスコープ検査 (admin=clubCodes空は全件可)。
    // 一覧GETと同じ判定 (宛先の club_code / app_user.club_code が担当内か)。
    if (allowedClubs.length > 0) {
      const scoped = await query<{ ok: number }>(
        `SELECT 1 AS ok FROM information2_destination d
           LEFT JOIN app_user au ON au.id = d.app_user_id
          WHERE d.information2_id = $1
            AND (d.club_code = ANY($2::text[]) OR (LEFT(au.member_id,3) = ANY($2::text[]) OR LEFT(au.member_id,4) = ANY($2::text[])))
          LIMIT 1`,
        [infoId, allowedClubs]
      );
      if (scoped.rows.length === 0) {
        return NextResponse.json({ notification: null });
      }
    }
    const head = await query<any>(
      `SELECT i.id, i.title, i.content, i.link_url, i.is_private,
              i.start_at, i.end_at, i.created_at,
              min(d.app_type) AS app_type,
              array_remove(array_agg(DISTINCT coalesce(d.club_code, au.club_code)), NULL) AS club_codes,
              count(d.*) AS target_count,
              count(*) FILTER (WHERE d.status='done')  AS sent_count,
              count(*) FILTER (WHERE d.status='error') AS error_count,
              count(*) FILTER (WHERE d.read_at IS NOT NULL) AS open_count
       FROM information2 i
       JOIN information2_destination d ON d.information2_id = i.id
       LEFT JOIN app_user au ON au.id = d.app_user_id
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
    // 会員単位の開封/未開封 (個人宛=CONDITION のみ enumerable。店舗トピック=ALL は宛先が個人でないため対象外)
    // 店舗ユーザーは自店舗の会員に限定 (admin=clubCodes空は全件)。
    const peopleRows = await query<any>(
      `SELECT au.name, au.member_id, au.club_code, d.read_at, d.status
         FROM information2_destination d
         JOIN app_user au ON au.id = d.app_user_id
        WHERE d.information2_id = $1 AND d.app_user_id IS NOT NULL
          ${allowedClubs.length > 0 ? "AND (LEFT(au.member_id,3) = ANY($2::text[]) OR LEFT(au.member_id,4) = ANY($2::text[]))" : ""}
        ORDER BY (d.read_at IS NOT NULL) DESC, d.read_at DESC, au.name
        LIMIT 5000`,
      allowedClubs.length > 0 ? [infoId, allowedClubs] : [infoId]
    );
    const pClubNames = await getClubNames(peopleRows.rows.map((r) => String(r.club_code || "")));
    const opened: PushPerson[] = [];
    const unopened: PushPerson[] = [];
    for (const r of peopleRows.rows) {
      const p: PushPerson = {
        name: r.name || "(名称未設定)",
        memberNo: r.member_id ? String(r.member_id) : undefined,
        clubCode: r.club_code ? String(r.club_code) : undefined,
        clubName: r.club_code ? (pClubNames[String(r.club_code)] || String(r.club_code)) : undefined,
        readAt: r.read_at ? new Date(r.read_at).toISOString() : undefined,
      };
      (p.readAt ? opened : unopened).push(p);
    }
    const notification = toPush(head.rows[0]);
    await enrichPush([notification]);
    notification.people = { opened, unopened };
    return NextResponse.json({
      notification,
      openTimeline: tl.rows.map((t) => ({ hourOffset: t.hour_offset, opens: t.opens })),
    });
  }

  // 一覧: ログインユーザーの担当クラブ宛(店舗ターゲット) or その店舗の個人宛
  // clubCodes が空の admin は全クラブ (フィルタ無し)。
  const selectCols = `SELECT i.id, i.title, i.content, i.link_url, i.is_private,
            i.start_at, i.end_at, i.created_at,
            min(d.app_type) AS app_type,
            array_remove(array_agg(DISTINCT coalesce(d.club_code, au.club_code)), NULL) AS club_codes,
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
              OR (d.app_user_id IS NOT NULL AND (LEFT(au.member_id,3) = ANY($1::text[]) OR LEFT(au.member_id,4) = ANY($1::text[])))
           ${tail}`,
          [allowedClubs]
        )
      : await query<any>(`${selectCols}${tail}`);
  const notifications = list.rows.map(toPush);
  await enrichPush(notifications);
  return NextResponse.json({ notifications });
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

  // 送信ガード: NGワード / 配信時間帯 (8:00〜21:00 JST)。下書きは時間帯チェック免除。
  const guard = checkSendGuards({
    subject: title,
    body: `${content}\n${stripTags(body.contentHtml || "")}`,
    isDraft: !!body.isDraft,
    isImmediate: !!body.isImmediate,
    scheduledAt: body.scheduledAt,
  });
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.error }, { status: 400 });
  }

  const appType = brandToAppType(body.brand);
  const targetType = body.targetType === "ALL" ? "ALL" : "CONDITION";

  // 宛先
  let destinations: { appUserId?: number; clubCode?: string; appType: AppType }[];
  if (targetType === "ALL") {
    // 複数店舗の全体配信でも全クラブを宛先に含める(先頭1店舗のみのサイレント欠落を防ぐ)
    destinations = clubCodes.map((c) => ({ clubCode: c, appType }));
  } else {
    const ids = Array.isArray(body.appUserIds) ? body.appUserIds.map((n) => Number(n)).filter((n) => Number.isInteger(n)) : [];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "appUserIds required for CONDITION" }, { status: 400 });
    }
    // 担当外会員への配信を防ぐ: appUserIds が担当スコープ内かサーバ側で再検証
    // (フロントは抽出済みIDを渡すが、API直叩き時の担当外混入を弾く。admin=clubCodes空は免除)
    //
    // 判定は「会員の所属クラブ = 会員番号(member_id)の先頭クラブコード」で行う。
    // app_user.club_code は"アプリ登録クラブ"で契約クラブと異なることが多く(相互利用/転籍等)、
    // それで判定すると自店会員が「担当外」と誤判定されるため使わない(抽出側はOracle契約
    // クラブコードで絞っており、それと整合させる)。クラブコードは3桁/4桁混在なので両方で照合。
    if (user.clubCodes.length > 0) {
      const chk = await query<{ id: number }>(
        `SELECT id FROM app_user
          WHERE id = ANY($1::int[])
            AND (LEFT(member_id, 3) = ANY($2::text[]) OR LEFT(member_id, 4) = ANY($2::text[]))`,
        [ids, user.clubCodes]
      );
      const allowed = new Set(chk.rows.map((r) => Number(r.id)));
      const bad = ids.filter((n) => !allowed.has(Number(n)));
      if (bad.length > 0) {
        return NextResponse.json(
          { ok: false, error: `担当外の会員が宛先に含まれています（${bad.length}件）` },
          { status: 403 }
        );
      }
    }
    destinations = ids.map((appUserId) => ({ appUserId, appType }));
  }

  // 予約(掲載開始)日時の検証: 指定があるのに不正フォーマットなら 400 で弾く。
  if (!body.isImmediate && body.scheduledAt) {
    const ms = Date.parse(String(body.scheduledAt).replace(" ", "T") + "+09:00");
    if (!Number.isFinite(ms)) {
      return NextResponse.json({ ok: false, error: "予約日時の形式が不正です" }, { status: 400 });
    }
  }
  // 掲載期間
  const startAt = body.isImmediate || !body.scheduledAt ? toJstString(new Date()) : body.scheduledAt;
  const endAt = body.endAt || toJstString(new Date(Date.now() + 90 * 24 * 3600 * 1000)); // 既定90日表示

  // お知らせ欄の本文: AI生成HTML(contentHtml)があればそのまま、無ければ画像+本文を組み立て
  const finalContent = body.contentHtml && body.contentHtml.trim()
    ? body.contentHtml
    : body.imageUrl
    ? `<p><img src="${attrEscape(body.imageUrl)}" alt="" style="max-width:100%;height:auto;" /></p>\n${content}`
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
    // 配信者メタ (information2 に配信者列が無いため別持ち。ベストエフォート)
    void putPushMeta({
      informationId: String(informationId),
      createdBy: (user as any).email || (user as any).userId || "unknown",
      createdByName: (user as any).name,
      brand: body.brand,
      clubCodes,
      targetType,
      createdAt: new Date().toISOString(),
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

// ── DELETE: 予約(未送信)の取り消し ──
// 送信は cron が start_at <= now AND is_private=false の時に行うため、start_at が未来のうちに
// is_private=true にすれば送信・表示ともされない(＝キャンセル)。送信済みは取り消せない。
export async function DELETE(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  const infoId = Number(id);
  if (!Number.isFinite(infoId)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const allowedClubs = user.clubCodes;

  // 担当スコープ検査 (一覧/詳細と同じ)
  if (allowedClubs.length > 0) {
    const scoped = await query<{ ok: number }>(
      `SELECT 1 AS ok FROM information2_destination d LEFT JOIN app_user au ON au.id = d.app_user_id
        WHERE d.information2_id = $1 AND (d.club_code = ANY($2::text[]) OR (LEFT(au.member_id,3) = ANY($2::text[]) OR LEFT(au.member_id,4) = ANY($2::text[]))) LIMIT 1`,
      [infoId, allowedClubs]
    );
    if (scoped.rows.length === 0) return NextResponse.json({ ok: false, error: "担当外です" }, { status: 403 });
  }
  // 未送信(start_at が未来)のみ取り消し可
  const upd = await query(
    `UPDATE information2 SET is_private = true, updated_at = timezone('utc', now())
      WHERE id = $1 AND start_at > timezone('utc', now())`,
    [infoId]
  );
  if ((upd.rowCount ?? 0) === 0) {
    return NextResponse.json({ ok: false, error: "既に送信済み、または取り消せる予約がありません" }, { status: 409 });
  }
  void writeAudit({
    userId: (user as any).email || (user as any).userId || "unknown", userName: (user as any).name,
    action: "push.cancel", clubCodes: allowedClubs, resource: `information:${infoId}`, ip: clientIp(req),
  });
  return NextResponse.json({ ok: true });
}
