// types/manual.ts
export type Manual = {
  manualId: string;
  title: string;
  desc?: string | null;

  type?: "video" | "doc";
  startDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  brand?: string | null;
  biz?: string | null;
  tags?: string[] | null;

  // シリーズ (旧称: カテゴリ)。1階層のフラット構造に統一。
  categoryId?: string | null;
  // シリーズ内の表示順 (小さい順)
  seriesOrder?: number | null;

  previewUrl?: string | null;
  embedUrl?: string | null;
  externalUrl?: string;
  downloadUrl?: string | null;
  noDownload?: boolean | null;
  viewScope?: "all" | "direct";
};