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
  previewUrl?: string | null;
  embedUrl?: string | null;
  externalUrl?: string;
  downloadUrl?: string | null;
  noDownload?: boolean | null;
};