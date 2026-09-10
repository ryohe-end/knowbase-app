// types/storeAppConfig.ts

export type AppBrandType = "FIT365" | "JOYFIT" | "BOTH";

export type BusinessType = 
  | "青" | "赤SP LITE" | "赤" | "赤SP" | "赤GH" | "青GH" | "緑" 
  | "FIT365" | "青LITE" | "赤LITE" | "メディカル" | "JOYFIT+" | "";

export type MachineConfig = {
  name: string;
  imageUrl: string;
  maker?: string;
  bodyRegion?: string;
};

// ✅ 新規: 解錠機器の種類
// 既知タイプは補完候補にしつつ、DB の未知値も受け入れられるよう string も許容
export const KNOWN_UNLOCK_DEVICE_TYPES = ["入口", "出口", "更衣室", "水素水"] as const;
export type KnownUnlockDeviceType = (typeof KNOWN_UNLOCK_DEVICE_TYPES)[number];
export type UnlockDeviceType = KnownUnlockDeviceType | (string & {});

// ✅ 新規: 解錠機器設定
export type UnlockDeviceConfig = {
  id: string; // Reactのkey用の一意なID (追加時に自動生成)
  majorCode: string;
  minorCode: string;
  type: UnlockDeviceType;
  isEntrance: boolean;
  displayName: string;
};

// 拡張店舗詳細(アプリ基本設定「店舗詳細」で入力 → club__c.detail_ext__c JSONB。公開API /clubs で返す)
export type StoreSnsLink = { label: string; url: string };
export type StoreDetailExt = {
  postalCode?: string;      // 郵便番号
  access?: string;          // アクセス(最寄駅・道順など)
  parking?: string;         // 駐車場
  floorArea?: string;       // 面積(単位込み文字列可: "350㎡" 等)
  snsLinks?: StoreSnsLink[]; // SNSリンク(複数)
  photos?: string[];        // 店舗写真URL(S3 publicUrl。複数)
  facilityTags?: string[];  // 設備タグ(複数)
};

export type StoreAppConfig = {
  // --- [店舗情報] ---
  clubCode: string;
  clubName: string;
  brand: AppBrandType;
  businessType: BusinessType;
  
  inquiryEmail?: string;
  inquiryEmails?: string[];
  storeEmail?: string;
  
  latitude?: number;
  longitude?: number;
  prefecture?: string;
  address?: string;
  
  externalLink?: string;
  personalTrainingUrl?: string;

  // --- [店舗詳細(公開API用。入力があれば /api/public/clubs で返す)] ---
  businessHours?: string;      // 営業時間
  regularHoliday?: string;     // 定休日(毎週の曜日など)
  staffHours?: string;         // スタッフ対応時間
  phoneNumber?: string;        // 電話番号
  tempClosedDates?: string[];  // 臨時休館日(特定日・複数)
  preOpenDate?: string;        // プレオープン日
  grandOpenDate?: string;      // グランドオープン日

  // 拡張店舗詳細(郵便番号/アクセス/駐車場/面積/SNS/写真/設備タグ)。club__c.detail_ext__c に保存。
  detailExt?: StoreDetailExt;

  // --- [店舗設定] ---
  isPointSupported: boolean;
  pointSupportStartDate?: string;
  appPointPopup?: boolean;
  lesMillsAvailable?: boolean;
  canUseDormantMember: boolean;
  showAppEnableButton: boolean;
  enableReferral: boolean;
  showMainContractChange: boolean;
  showKioskContractChange: boolean;
  showOptionChange: boolean;
  showFamilyAdd: boolean;
  showUnpaidPayment: boolean;
  showWithdrawal: boolean;

  // --- [表示サービス(shop_service_control) の本番連携メタ] ---
  // 上記トグルのうち showAppEnableButton〜showWithdrawal(showUnpaidPayment除く) は
  // 入会DB shop_service_control が本番SoT。解決できた場合のみ実データ・編集可。
  serviceControlAvailable?: boolean;   // 入会DBの shop_id を自動特定でき、読み取れたか
  serviceShopId?: string;              // 自動対応づけた入会DBの shop_id
  serviceToggleKeys?: string[];        // 当該ブランドで有効なトグルキー(JOYFITはkiosk/family除外)

  // --- [解錠機器] ---
  unlockDevices: UnlockDeviceConfig[]; // ✅ 追加

  // --- [マシンリスト] ---
  machines: MachineConfig[];

  // --- 管理情報 ---
  createdAt: string;
  updatedAt: string;
};