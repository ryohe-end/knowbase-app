// types/dmNotification.ts

export type DmStatus = "SENT" | "SCHEDULED" | "DRAFT";
export type DmTargetType = "ALL" | "CONDITION";

export type DmCondition = {
  joinDateFrom?: string;
  joinDateTo?: string;
  ageFrom?: string;
  ageTo?: string;
  gender?: ("male" | "female")[];
  visitCount?: string;
  visitCountOp?: "gte" | "lte";
};

// ✅ 新規: 配信統計データ
export type DmStats = {
  targetCount: number;    // 配信対象総数
  deliveredCount: number; // 到達数
  openCount: number;      // 開封数
  errorCount: number;     // エラー(バウンス)数
};

export type DmNotification = {
  id: string;
  subject: string;
  body: string;
  imageUrl?: string;
  
  targetType: DmTargetType;
  condition?: DmCondition;

  status: DmStatus;
  scheduledAt: string;
  createdAt: string;
  
  stats?: DmStats; // ✅ 統計情報を追加
};