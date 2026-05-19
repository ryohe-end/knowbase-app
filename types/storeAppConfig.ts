// types/storeAppConfig.ts

export type AppBrandType = "FIT365" | "JOYFIT" | "BOTH";

export type BusinessType = 
  | "青" | "赤SP LITE" | "赤" | "赤SP" | "赤GH" | "青GH" | "緑" 
  | "FIT365" | "青LITE" | "赤LITE" | "メディカル" | "JOYFIT+" | "";

export type MachineConfig = {
  name: string;
  imageUrl: string;
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

  // --- [解錠機器] ---
  unlockDevices: UnlockDeviceConfig[]; // ✅ 追加

  // --- [マシンリスト] ---
  machines: MachineConfig[];

  // --- 管理情報 ---
  createdAt: string;
  updatedAt: string;
};