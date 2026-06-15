// types/refundApplication.ts
// 返金申請の永続化型。DynamoDB テーブル `yamauchi-RefundApplications` のスキーマと一致。
// 推奨スキーマ:
//   PK: applicationId (String)
//   GSI1: by-club  (HASH: clubCode,  RANGE: createdAt) — クラブごとの履歴/一覧
//   GSI2: by-status (HASH: status,    RANGE: updatedAt) — 承認待ち/差戻し等のキュー
// MVP は Scan + filter で動かし、量が増えたら GSI を追加するだけで切替可能。

export type RefundStatus = "下書き" | "承認待ち" | "振込手配中" | "承認済み" | "差戻し";
export type StepRole = "applicant" | "approver" | "finance";
export type StepState = "完了" | "対応中" | "未対応" | "差戻し";

export type ApprovalStep = {
  role: StepRole;
  userId: string;
  userName: string;
  dept: string;
  email: string;
  state: StepState;
  actedAt?: string;
  comment?: string;
};

export type RefundItem = {
  id: string;
  label: string;
  amount: number;
  paidAt?: string;
  targetMonth?: string;
  category?: string;
};

export type BankAccount = {
  bankCode?: string;
  bankName: string;
  branchCode?: string;
  branchName: string;
  accountType: "普通" | "当座";
  accountNumber: string;
  holderName: string;
  source?: string;
};

export type TransferResult = "成功" | "失敗" | "保留";

// 操作履歴 (誰がいつ何をしたか) — 監査用
export type RefundEvent = {
  at: string;                  // ISO timestamp
  byUserId: string;
  byUserName: string;
  action: "create" | "edit" | "submit" | "approve" | "reject" | "arrange" | "transfer";
  fromStatus?: RefundStatus;
  toStatus?: RefundStatus;
  role?: StepRole;             // どの段階での操作か
  comment?: string;
  metadata?: Record<string, any>;
};

export type RefundApplication = {
  applicationId: string;            // RF-YYYYMMDD-### 形式
  clubCode: string;

  status: RefundStatus;

  memberNo: string;
  memberName: string;
  memberKana?: string;
  memberPhone?: string;
  memberPlan?: string;

  targetMonthFrom: string;          // "YYYY-MM"
  targetMonthTo: string;            // "YYYY-MM"
  items: RefundItem[];
  totalAmount: number;
  reason: string;
  attachments?: string[];

  bankAccount?: BankAccount;

  steps: ApprovalStep[];

  // 経理ステージ
  transferBatchId?: string;          // CSV 出力したバッチ ID
  transferScheduledDate?: string;    // 振込予定日 (YYYY-MM-DD)
  transferArrangedAt?: string;       // CSV 出力時刻
  transferAttemptedAt?: string;
  transferCompletedAt?: string;
  transferResult?: TransferResult;
  transferErrorCode?: string;
  transferErrorMessage?: string;
  failureReason?: string;            // 振込失敗理由 (口座番号相違 等)
  failureDetail?: string;

  // 監査用イベントログ (作成順に append のみ)
  events?: RefundEvent[];

  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};
