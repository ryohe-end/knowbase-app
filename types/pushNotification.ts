// types/pushNotification.ts

export type PushStatus = "SENT" | "SCHEDULED" | "DRAFT";
export type PushTargetType = "ALL" | "CONDITION";

export type PushCondition = {
  joinDateFrom?: string;
  joinDateTo?: string;
  ageFrom?: string;
  ageTo?: string;
  gender?: ("male" | "female")[];
  visitCount?: string;
  visitCountOp?: "gte" | "lte";
};

// ✅ 新規: Push通知の統計データ
export type PushStats = {
  targetCount: number;    // 対象人数
  sentCount: number;      // 配信成功数
  openCount: number;      // 通知開封数
  errorCount: number;     // 配信エラー数（端末未登録など）
};

export type PushNotification = {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  
  targetType: PushTargetType;
  condition?: PushCondition;

  status: PushStatus;
  scheduledAt: string;
  createdAt: string;
  
  stats?: PushStats; // ✅ 追加
};