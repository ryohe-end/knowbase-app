export type ExternalLink = {
  linkId: string;
  title: string;
  url: string;
  description?: string; // 説明文
  sortOrder?: number;
  isActive: boolean;
};