// types/pointTransaction.ts
// 店舗側でのポイント付与・取り消し記録。
// DynamoDB: yamauchi-PointTransactions (PK: transactionId)

export type PointTxType = "earned" | "used" | "expired" | "adjusted" | "refunded";

// 付与理由 (店舗側 UI のプルダウン)
export type PointReason = "歩数" | "イベント" | "パーソナルトレーニング" | "ボーナス" | "その他";

export const POINT_REASONS: PointReason[] = ["歩数", "イベント", "パーソナルトレーニング", "ボーナス", "その他"];

export type PointTransaction = {
  transactionId: string;      // PT-YYYYMMDD-XXXXXXXX
  clubCode: string;
  memberCode: string;

  type: PointTxType;          // "earned" = 付与, "adjusted" = 取り消し (反対符号), など
  points: number;             // 正=付与 / 負=取り消し・利用
  reason?: PointReason;       // earned のときの理由 (歩数 等)
  note?: string;

  occurredAt: string;         // ISO
  operatorId: string;
  operatorName: string;

  // 取り消しの場合は元 transactionId を参照
  cancelledOf?: string;
  // 逆に取り消された場合は ID を記録 (UI で「取消済」を出す)
  cancelledBy?: string;
  cancelledAt?: string;
};
