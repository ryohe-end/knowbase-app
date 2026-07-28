"use client";

import React from "react";
import Link from "next/link";
import { ToastProvider } from "@/components/Toast";
import OneDayCheckoffEditor from "./OneDayCheckoffEditor";

function Inner() {
  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      <header className="odc-page-header">
        <div className="odc-page-header-inner">
          <Link href="/store-settings" className="odc-page-back">← メニューへ戻る</Link>
          <h1>1dayパス チケット消し込み<span className="odc-page-badge">FIT365</span></h1>
        </div>
      </header>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px" }}>
        <OneDayCheckoffEditor />
      </div>
      <style jsx global>{`
        .odc-page-header { background: #fff; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 50; }
        .odc-page-header-inner { max-width: 1100px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 16px; }
        .odc-page-back { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .odc-page-header h1 { font-size: 18px; font-weight: 800; margin: 0; display: flex; align-items: center; gap: 8px; }
        .odc-page-badge { font-size: 10px; font-weight: 800; color: #be185d; background: #fce7f3; border: 1px solid #fbcfe8; padding: 2px 8px; border-radius: 99px; }
      `}</style>
    </div>
  );
}

export default function OneDayCheckoffPage() {
  return (<ToastProvider><Inner /></ToastProvider>);
}
