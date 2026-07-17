// types/bannerSettings.ts
// ホーム画面バナー設定。バナーは「ブランド共通(app_type 単位)」で、店舗(clubCode)単位ではない。
// 保存先は member と共有の PostgreSQL の app_banner テーブル(member-app-server のマイグレーションで作成済み)。
// member アプリは GET /member/banners で JWT の app_type に応じて取得する。
// ※ 店舗別ではないため、この設定は「ブランド管理者(admin)」が編集する想定。

export type AppType = "joyfit" | "fit365" | "wf";

/** バナー1件。 imageUrl は S3 の絶対URL(media/upload-image の publicUrl)。 */
export type AppBanner = {
  id?: number;            // 既存行の id（新規は undefined）
  imageUrl: string;       // バナー画像の絶対URL（必須）
  linkUrl?: string;       // タップ時の遷移先URL（任意。空なら遷移なし）
  title?: string;         // 管理/アクセシビリティ用（任意）
  displayOrder?: number;  // 表示順（未指定なら配列順）
  isActive: boolean;      // 掲載中フラグ
  startAt?: string | null; // 掲載開始（ISO文字列 or null=即時）
  endAt?: string | null;   // 掲載終了（ISO文字列 or null=無期限）
};

/** app_type 1つ分のバナー設定。 */
export type BannerSettings = {
  appType: AppType;
  banners: AppBanner[];
};
