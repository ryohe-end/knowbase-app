// types/manualCategory.ts

/** シリーズに紐づく外部リンク */
export type SeriesLink = {
  label: string;
  url: string;
};

/**
 * マニュアルカテゴリ (大/中の 2 階層を想定)
 * - parentId が null/undefined → 大カテゴリ (ジャンル)
 * - parentId が set → 中カテゴリ (サブジャンル)
 */
export type ManualCategory = {
  categoryId: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  /** 概要・コメント (シリーズの説明文) */
  description?: string | null;
  /** 配信部署 ID (depts テーブルの deptId と紐付く) */
  bizId?: string | null;
  /** 配信部署名 (表示用キャッシュ) */
  biz?: string | null;
  /** 配信日 (YYYY-MM-DD) */
  publishedAt?: string | null;
  /** サムネイル画像 URL */
  thumbnailUrl?: string | null;
  /** シリーズに紐づく外部リンク (管理コンソールで登録) */
  links?: SeriesLink[];
  createdAt?: string;
  updatedAt?: string;
};

/** 表示用に階層をネスト化した型 */
export type ManualCategoryTree = ManualCategory & {
  children: ManualCategory[];
};
