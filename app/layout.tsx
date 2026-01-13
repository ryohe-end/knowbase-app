import type { Metadata } from "next";
import "./globals.css";
import SessionTimeoutWatcher from "@/components/SessionTimeoutWatcher"; // ✅ 追加

export const metadata: Metadata = {
  title: "Know Base",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <SessionTimeoutWatcher /> {/* ✅ 全ページで監視を開始 */}
        {children}
      </body>
    </html>
  );
}