// lib/designSpecAuth.ts
// 設計業務① 仕様書・標準図ライブラリの認可。
//   - 登録/編集/削除/アップロード = 設計担当のみ(許可メール制)。
//   - 閲覧 = ログインユーザー全般。viewScope(ALL/DIRECT/FC)で絞り込む。
// 認証は返金APIと同じ getRefundUser(cookie kb_user → yamauchi-Users) を流用する。

import { getRefundUser, type RefundUser } from "@/lib/refundAuth";
import type { SpecViewScope } from "@/types/specDocument";

// 設計担当の許可メール。既定は r-endo@okamoto-group.co.jp。
// 追加は環境変数 DESIGN_SPEC_EDITORS(カンマ区切り)で拡張可。
const EDITOR_EMAILS = new Set(
  [
    "r-endo@okamoto-group.co.jp",
    ...String(process.env.DESIGN_SPEC_EDITORS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ].map((s) => s.toLowerCase())
);

export type DesignUser = RefundUser & { canEdit: boolean };

// 現在のユーザーを解決(未ログインは null)。canEdit=設計担当か。
export async function getDesignUser(): Promise<DesignUser | null> {
  const u = await getRefundUser();
  if (!u) return null;
  const email = String(u.email || "").toLowerCase();
  const canEdit = EDITOR_EMAILS.has(email) || (u.role || "").toLowerCase() === "admin";
  return { ...u, canEdit };
}

export function isSpecEditor(email?: string | null, role?: string | null): boolean {
  const e = String(email || "").toLowerCase();
  return EDITOR_EMAILS.has(e) || String(role || "").toLowerCase() === "admin";
}

// viewScope 閲覧可否。設計担当/admin は全て可。
//   ALL    → 全員
//   DIRECT → 直営+本部(FCは不可)。FC判定は role=sv(FC限定スコープ)。
//   FC     → FC+本部
// role の確定情報が乏しいため、MVP では role=sv を FC とみなし、それ以外は直営扱い。
export function canViewScope(user: { role?: string | null } & { canEdit?: boolean }, scope: SpecViewScope): boolean {
  if (user.canEdit) return true;
  if (scope === "ALL") return true;
  const isFc = String(user.role || "").toLowerCase() === "sv";
  if (scope === "FC") return isFc;
  if (scope === "DIRECT") return !isFc;
  return true;
}
