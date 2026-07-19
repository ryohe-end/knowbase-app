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

// 配信後の時間別開封数 (ダッシュボード用)
export type PushOpenTimeBucket = {
  hourOffset: number;  // 送信からの経過時間 (時)
  opens: number;
};

// 会員単位の配信/開封状況 (詳細画面: 開いた人/開いてない人)
export type PushPerson = {
  name: string;
  memberNo?: string;   // 会員番号 (app_user.member_id)
  clubCode?: string;
  clubName?: string;
  readAt?: string;     // 開封日時 (ISO)。未開封は undefined
};

export type PushNotification = {
  id: string;
  title: string;
  body: string;

  targetType: PushTargetType;
  condition?: PushCondition;

  status: PushStatus;
  scheduledAt: string;
  createdAt: string;

  // 履歴一覧/詳細の付帯情報
  clubCodes?: string[];   // 配信先クラブ
  clubNames?: string[];   // 配信先クラブ名 (表示用)
  senderName?: string;    // 配信者 (knowbie-push-meta 由来)

  stats?: PushStats;
  openTimeline?: PushOpenTimeBucket[];
  people?: { opened: PushPerson[]; unopened: PushPerson[] }; // 詳細のみ
};