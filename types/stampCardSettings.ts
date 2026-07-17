// types/stampCardSettings.ts
// 来館スタンプカードの「景品ラインナップ / 促進文言 / ご案内事項」設定（店舗=clubCode 単位）。
// 保存先は member と共有の PostgreSQL:
//   - 1:1 設定 → club__c の追加カラム (stamp_card_support_flag__c / _month_label__c / _promo_text__c / _announcement__c)
//   - 景品(1:多) → stamp_card_prize テーブル (club_code 単位)
// これらは member-app-server のマイグレーションで作成済み(要 dev/prod 適用)。
// member アプリは GET /member/stamp-card で参照する。

/** 景品1件（マイルストーン）。 imageUrl は S3 の絶対URL(media/upload-image の publicUrl)。 */
export type StampCardPrize = {
  id?: number;            // 既存行の id（新規は undefined）
  requiredCount: number;  // 何回来館(スタンプ数)で獲得できるか（正の整数）
  name: string;           // 景品名（必須）
  imageUrl: string;       // 景品画像の絶対URL（必須）
  description?: string;   // 補足説明（任意）
  displayOrder?: number;  // 表示順（未指定なら配列順）
};

/** 店舗1つ分のスタンプカード設定。 */
export type StampCardSettings = {
  clubCode: string;
  supportFlag: boolean;   // club__c.stamp_card_support_flag__c（この店舗でスタンプカード機能ON/OFF）
  monthLabel?: string;    // club__c.stamp_card_month_label__c（例: "7月"）
  promoText?: string;     // club__c.stamp_card_promo_text__c（空ならアプリが prizes から自動生成）
  announcement?: string;  // club__c.stamp_card_announcement__c（ご案内事項）
  prizes: StampCardPrize[];
};
