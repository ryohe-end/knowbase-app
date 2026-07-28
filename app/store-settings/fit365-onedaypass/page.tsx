"use client";

import React from "react";
import Link from "next/link";
import { ToastProvider } from "@/components/Toast";
import Fit365OneDayPassEditor from "./Fit365OneDayPassEditor";

function Inner() {
  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      <header className="f1d-page-header">
        <div className="f1d-page-header-inner">
          <Link href="/store-settings" className="f1d-page-back">← メニューへ戻る</Link>
          <h1>FIT365 1dayパス金額設定</h1>
        </div>
      </header>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px" }}>
        <Fit365OneDayPassEditor />
      </div>
      <style jsx global>{`
        .f1d-page-header { background: #fff; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 50; }
        .f1d-page-header-inner { max-width: 1200px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 16px; }
        .f1d-page-back { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .f1d-page-header h1 { font-size: 18px; font-weight: 800; margin: 0; }
      `}</style>
    </div>
  );
}

export default function Fit365OneDayPassPage() {
  return (<ToastProvider><Inner /></ToastProvider>);
}
