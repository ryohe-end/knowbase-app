// types/depositApplication.ts
// 入金 (会費振込連絡) 申請。承認ステップを挟まず、店舗 → 経理 の 2 段階。
// DynamoDB: yamauchi-DepositApplications (PK: applicationId)

export type DepositStatus = "下書き" | "受付中" | "消込完了" | "差戻し";
export type DepositStepRole = "applicant" | "finance";
export type DepositStepState = "完了" | "対応中" | "未対応" | "差戻し";

export type DepositStep = {
  role: DepositStepRole;
  userId: string;
  userName: string;
  dept: string;
  email: string;
  state: DepositStepState;
  actedAt?: string;
  comment?: string;
};

export type UnpaidItem = {
  id: string;
  label: string;
  amount: number;
  targetMonth?: string;        // "YYYY-MM"
  dueDate?: string;            // "YYYY-MM-DD"
  overdueDays?: number;
  category?: string;           // 月会費 / オプション / 事務手数料 等
  oracleInvoiceId?: string;    // 消込時に Oracle 側へ渡す内部 ID
};

export type PaymentMethod = "現金" | "銀行振込" | "クレジット再請求" | "コンビニ収納" | "店舗端末(PayPay等)";

export type DepositEvent = {
  at: string;
  byUserId: string;
  byUserName: string;
  action: "create" | "edit" | "submit" | "close" | "reject";
  fromStatus?: DepositStatus;
  toStatus?: DepositStatus;
  role?: DepositStepRole;
  comment?: string;
  metadata?: Record<string, any>;
};

export type DepositClosing = {
  closedAt: string;
  receiptDate: string;          // "YYYY-MM-DD" 実際の入金日
  oracleBatchId: string;
  operator: string;
  note?: string;
};

export type DepositApplication = {
  applicationId: string;        // "DP-YYYYMMDD-XXXXXXXX"
  clubCode: string;

  status: DepositStatus;

  memberNo: string;
  memberName: string;
  memberKana?: string;
  memberPhone?: string;
  memberPlan?: string;

  // 入金フローは "会員から会費を振込む連絡が来た" を経理に伝えるだけ。
  // 未納明細との突き合わせは経理消込で行うため、申請時の項目選択は不要。
  unpaidItems?: UnpaidItem[];   // 任意 (過去データ互換のため optional)
  totalAmount: number;          // 連絡を受けた入金額 (店舗が直接入力)
  paymentMethod?: PaymentMethod;// 任意 (情報として残せるが必須ではない)
  scheduledDate: string;        // 入金予定日
  memo?: string;

  steps: DepositStep[];

  closing?: DepositClosing;
  failureReason?: string;
  failureDetail?: string;

  events?: DepositEvent[];

  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};
