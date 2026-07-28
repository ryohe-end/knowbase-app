"use client";

import React from "react";
import Link from "next/link";
import { ToastProvider } from "@/components/Toast";
import JoyfitOneTimePassEditor from "./JoyfitOneTimePassEditor";

function Inner() {
  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      <header className="jot-page-header">
        <div className="jot-page-header-inner">
          <Link href="/store-settings" className="jot-page-back">← メニューへ戻る</Link>
          <h1>JOYFIT OneTimePass金額設定</h1>
        </div>
      </header>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px" }}>
        <JoyfitOneTimePassEditor />
      </div>
      <style jsx global>{`
        .jot-page-header { background: #fff; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 50; }
        .jot-page-header-inner { max-width: 1200px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 16px; }
        .jot-page-back { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .jot-page-header h1 { font-size: 18px; font-weight: 800; margin: 0; }
      `}</style>
    </div>
  );
}

export default function JoyfitOneTimePassPage() {
  return (<ToastProvider><Inner /></ToastProvider>);
}
