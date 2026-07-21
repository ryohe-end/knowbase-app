// lib/roles.ts
// ロール判定の共通ヘルパー。
// SV(加盟店スーパーバイザー, role="sv") は「店舗設定」内では admin と同等の機能権限を持つが、
// データ範囲は加盟店(FC)店舗に限定される(スコープは effectiveClubCodes 側で付与)。
// 注意: /admin(knowbase管理: ユーザー管理/マニュアル/ニュース 等)は SV 対象外。
//       そのため isAdminRequest 等のグローバルな admin 判定は変更せず、
//       店舗設定の権限ゲートでのみ isAdminLike を使う。

export type AppRole = "admin" | "sv" | "editor" | "store" | "finance" | "viewer";

// 店舗設定で admin 相当の機能権限を持つロールか (admin または SV)。
export function isAdminLike(role?: string | null): boolean {
  return role === "admin" || role === "sv";
}

// 加盟店SV ロールか。
export function isSv(role?: string | null): boolean {
  return role === "sv";
}
