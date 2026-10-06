// app/admin/bi/layout.tsx — BI共通レイアウト(v5デザイン)。全ボードに固定ヘッダ+グローバルフィルタ+左レール。
import "./bi.css";
import BiShell from "@/components/bi/BiShell";

export default function BiAdminLayout({ children }: { children: React.ReactNode }) {
  return <BiShell>{children}</BiShell>;
}
