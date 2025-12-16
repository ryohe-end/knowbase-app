export type Manual = {
  manualId: string;
  title: string;
  brandId?: string;
  brand?: string;
  bizId?: string;
  biz?: string;
  desc?: string | null;
  updatedAt?: string;
  tags?: string[];
  embedUrl?: string;
  isNew?: boolean;
  noDownload?: boolean;
  readCount?: number;
};
