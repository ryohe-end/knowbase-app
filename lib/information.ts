// lib/information.ts
// お知らせ / Push通知の作成を担う集約モジュール。
//
// 会員アプリの Push+お知らせ本番パイプライン (member-app-server) の書き込みを、
// 我々が持つ会員DB(Fly PG, proxy 経由)へ「忠実に写経」したもの。ここで
// information2 + information2_destination を status='wait' で作ると、app-server の
// cron(3分毎) が拾って Push 送信・履歴記録し、アプリのお知らせ欄(WebView web/notice)
// に表示される。送信ロジック自体は再実装しない。
//
// ※ このスキーマは member-app-server 所有。挙動は server/dbService/information/
//    information.service.ts#saveInformationEntity と server/admin/information/
//    adminInformation.service.ts に一致させている。スキーマ変更時はここを追随する。
import { query } from "@/lib/memberDb";

export type AppType = "joyfit" | "fit365" | "wf";

export interface InformationDestinationInput {
  /** 個人ターゲティング: app_user.id (会員抽出→突合で解決した内部ID) */
  appUserId?: number | null;
  /** 店舗ターゲティング: club_code */
  clubCode?: string | null;
  /** ブランド (joyfit/fit365/wf)。全体配信は appUserId/clubCode 両方 null + appType */
  appType: AppType;
}

export interface CreateInformationInput {
  title: string;
  /** お知らせ本文 (WebView 表示。お知らせ欄の画像は content 内の <img> で埋め込む) */
  content: string;
  /** 「詳しくはこちら」リンク (任意) */
  linkUrl?: string | null;
  /** 掲載開始 (JST 'YYYY-MM-DD HH:mm' or ISO)。UTC へ変換して保存。 */
  startAt: string;
  /** 掲載終了 (JST) */
  endAt: string;
  /** 非公開フラグ (既定 false) */
  isPrivate?: boolean;
  /** 宛先。最低1件必須 (個人/店舗/全体のいずれか) */
  destinations: InformationDestinationInput[];
}

/**
 * お知らせを作成する (information2 + information2_destination を status='wait' で挿入)。
 * proxy は 1 インボーク=1 文のため、CTE で本体+宛先を単一文で原子的に挿入する。
 * JST 入力は Asia/Tokyo→UTC に変換 (app-server の JstToUtc と同じ)。
 * @returns 作成された information2.id
 */
export async function createInformation(
  input: CreateInformationInput
): Promise<{ informationId: number }> {
  if (!input.destinations || input.destinations.length === 0) {
    throw new Error("createInformation: destinations は最低1件必要です");
  }

  const destJson = JSON.stringify(
    input.destinations.map((d) => ({
      app_user_id: d.appUserId ?? null,
      club_code: d.clubCode ?? null,
      app_type: d.appType,
    }))
  );

  const sql = `
    WITH ins AS (
      INSERT INTO information2
        (title, content, link_url, start_at, end_at, is_private, created_at, updated_at)
      VALUES ($1, $2, $3,
              ($4::timestamp AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'utc',
              ($5::timestamp AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'utc',
              $6, timezone('utc', now()), timezone('utc', now()))
      RETURNING id
    )
    INSERT INTO information2_destination
      (information2_id, app_user_id, club_code, app_type, status, retry_count, created_at, updated_at)
    SELECT ins.id, d.app_user_id, d.club_code, d.app_type, 'wait', 0,
           timezone('utc', now()), timezone('utc', now())
    FROM ins
    CROSS JOIN jsonb_to_recordset($7::jsonb)
      AS d(app_user_id int, club_code varchar, app_type varchar)
    RETURNING information2_id
  `;

  const res = await query<{ information2_id: number }>(sql, [
    input.title,
    input.content,
    input.linkUrl ?? null,
    input.startAt,
    input.endAt,
    input.isPrivate ?? false,
    destJson,
  ]);

  const informationId = res.rows[0]?.information2_id;
  if (!informationId) {
    throw new Error("createInformation: information2 の作成に失敗しました");
  }
  return { informationId };
}
