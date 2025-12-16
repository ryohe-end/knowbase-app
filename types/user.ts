// /types/user.ts
export type KbUserRole = "admin" | "editor" | "viewer";

export type KbUser = {
  userId: string;
  name: string;
  email: string;
  role: KbUserRole;
  brandIds?: string[]; // "ALL" を含めれば全ブランド
  deptIds?: string[];  // "ALL_DEPT" で全部署扱い
  groupIds?: string[]; // ★追加: 属性グループID
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};