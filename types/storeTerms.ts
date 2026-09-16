// types/storeTerms.ts

export const DEFAULT_VARIANT_KEY = "_default";

export type TermVersion = {
  id: string;
  label: string;            // e.g. "v1", "v2", "v2.1"
  note: string;             // 改訂メモ
  createdAt: string;        // ISO
  isCurrent: boolean;
  // バリアントごとの本文 (HTMLまたはプレーンテキストでフリー記述)
  contentByVariant: Record<string, string>;
  // バリアントごとの生成済み PDF 公開URL (S3)。保存時にサーバ側で生成・更新する
  pdfUrlByVariant?: Record<string, string>;
};

export type StoreTerm = {
  termId: string;           // `${brand}__${baseTitleSlug}`
  brand: string;
  baseTitle: string;        // バリアント表記を除いたタイトル
  variants: string[];       // 例: ["赤①", "赤②", "青"] / variant 無しは []
  categories: string[];     // 同名タイトルが現れたカテゴリの集合
  isRequired: boolean;      // 同意必須(true) / 任意(false)。公開APIにも返す
  versions: TermVersion[];
  createdAt: string;
  updatedAt: string;
};
