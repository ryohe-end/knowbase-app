"use client";

import { useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function SessionTimeoutWatcher() {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = useCallback(async () => {
    try {
      // ログアウトAPIを呼び出し
      const res = await fetch("/api/logout", { method: "POST" });
      if (res.ok) {
        router.push("/login");
        router.refresh();
      }
    } catch (error) {
      console.error("自動ログアウトに失敗しました", error);
    }
  }, [router]);

  useEffect(() => {
    // ログイン関連のページではタイマーを動かさない
    if (pathname === "/login" || pathname === "/login/forgot-password") return;

    let timer: NodeJS.Timeout;
    const INACTIVE_LIMIT = 60 * 60 * 1000; // 1時間（ミリ秒）

    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(handleLogout, INACTIVE_LIMIT);
    };

    // ユーザーの操作イベントを監視
    const events = ["mousedown", "keydown", "scroll", "touchstart"];

    // 初回セット
    resetTimer();

    // イベントリスナーの登録
    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [pathname, handleLogout]);

  return null; // 画面には何も表示しない
}