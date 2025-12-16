// /types/news.ts
export type News = {
  newsId: string;
  title: string;
  body: string;
  brandId: string; // "ALL" or brandId
  deptId: string;  // "ALL" or deptId
  targetGroupIds?: string[]; // ★追加: ターゲット権限グループID
  publishedAt: string;

  visibleFrom?: string | null;
  visibleTo?: string | null;

  isPinned?: boolean;
  isActive?: boolean;
  linkUrl?: string | null;
};