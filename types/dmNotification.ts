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

// ✅ 新規: 配信統計データ (SendGrid Event Webhook で実データ化)
export type DmStats = {
  targetCount: number;    // 配信対象総数
  deliveredCount: number; // 到達数 (delivered)
  openCount: number;      // 開封数 (open, 総数。MPP等で過大計上あり)
  errorCount: number;     // エラー数 (bounce + dropped)
  // 追加指標 (任意。webhook 集計。旧UI互換のため上4つは必須のまま)
  uniqueOpenCount?: number;  // ユニーク開封数 (メールアドレス単位で重複排除)
  clickCount?: number;       // クリック総数
  uniqueClickCount?: number; // ユニーククリック数
  spamReportCount?: number;  // 迷惑メール報告
  unsubscribeCount?: number; // 配信停止
  lastEventAt?: string;      // 最終イベント受信時刻 (ISO)
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

  // 履歴一覧/詳細の付帯情報
  clubCode?: string;   // 配信先クラブ
  clubName?: string;   // 配信先クラブ名 (表示用)
  senderName?: string; // 配信者

  stats?: DmStats; // ✅ 統計情報を追加
  people?: DmPeople; // 詳細のみ: 開いた人/開いてない人
};

// 詳細画面: メール宛先単位の開封状況
export type DmPerson = { email: string; name?: string; at?: string };
export type DmPeople = {
  recipientsCaptured: boolean; // false=旧配信で宛先未保存 (未開封者を特定不可)
  opened: DmPerson[];
  unopened: DmPerson[];
};