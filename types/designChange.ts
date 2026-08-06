// types/designChange.ts
// 設計業務① 仕様書・標準図の「変更依頼」ワークフロー。
// DynamoDB: yamauchi-DesignChangeRequests (PK: requestId)
//   MVP は Scan + filter。量が増えたら by-status / by-brand GSI を足すだけで切替可能。

// C-1 依頼 → C-2 検討 → C-3 承認 → D 周知(=承認済) → E 検証 → F/G 完了。差戻しは C-1 へ。
export type DesignStatus = "依頼" | "検討中" | "承認待ち" | "承認済" | "検証中" | "完了" | "差戻し";

export const DESIGN_STATUSES: DesignStatus[] = ["依頼", "検討中", "承認待ち", "承認済", "検証中", "完了", "差戻し"];

// 変更規模（配信先が変わる: 微修正=設計のみ / 軽微=+新店開発 / 大=+運営・本部）
export type DesignScale = "微修正" | "軽微" | "大";
export const DESIGN_SCALES: DesignScale[] = ["微修正", "軽微", "大"];

export type DesignCategory = "仕様書" | "標準図" | "その他";
export const DESIGN_CATEGORIES: DesignCategory[] = ["仕様書", "標準図", "その他"];

export type DesignBrand = "共通" | "FIT365" | "JOYFIT" | "ジョイリハ";
export const DESIGN_BRANDS: DesignBrand[] = ["共通", "FIT365", "JOYFIT", "ジョイリハ"];

export type DesignAttachment = { name: string; url: string };

// 誰が・いつ・何を・なぜ（監査＝G履歴管理の実体）
export type DesignEvent = {
  at: string;                 // ISO
  byUserId: string;
  byUserName: string;
  action: "create" | "review" | "submit" | "approve" | "reject" | "verify" | "complete" | "comment";
  fromStatus?: DesignStatus;
  toStatus?: DesignStatus;
  comment?: string;
};

// 依頼ごとの壁打ちチャット（運営⇔設計⇔本部のラリー）
export type DesignMessage = {
  id: string;
  at: string;                 // ISO
  byUserId: string;
  byUserName: string;
  byDept?: string;
  text: string;
};

export type DesignChangeRequest = {
  requestId: string;          // DCR-YYYYMMDD-XXXX
  title: string;              // 変更対象（仕様書名 / 標準図名）
  category: DesignCategory;
  brand: DesignBrand;
  scale: DesignScale;
  reason: string;             // なぜ変えるか
  detail: string;            // 何を変えるか
  attachments?: DesignAttachment[];

  requestedById: string;
  requestedByName: string;
  requestedByDept?: string;

  status: DesignStatus;
  applyFrom?: string;         // 新仕様の適用開始日（周知時）YYYY-MM-DD

  events: DesignEvent[];
  messages?: DesignMessage[];  // 壁打ちチャット
  createdAt: string;
  updatedAt: string;
};
