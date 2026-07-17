"use client";
import React from "react";

// AI分析の非同期生成中に表示するローディング。
export default function AiSpinner({ label }: { label?: string }) {
  return (
    <div className="ai-spin-wrap">
      <div className="ai-spin-dots">
        <span /><span /><span />
      </div>
      <div className="ai-spin-ring" />
      <div className="ai-spin-label">{label || "AI分析を作成中…"}</div>
      <div className="ai-spin-sub">集計データをもとにAIが分析しています（20〜30秒ほどかかります）</div>
      <style jsx>{`
        .ai-spin-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 30px 14px; }
        .ai-spin-ring { width: 34px; height: 34px; border-radius: 50%; border: 3px solid #ede9fe; border-top-color: #7c3aed; animation: aispin 0.8s linear infinite; }
        .ai-spin-dots { display: flex; gap: 6px; }
        .ai-spin-dots span { width: 8px; height: 8px; border-radius: 50%; background: #a855f7; animation: aibounce 1.2s ease-in-out infinite; }
        .ai-spin-dots span:nth-child(2) { animation-delay: 0.15s; }
        .ai-spin-dots span:nth-child(3) { animation-delay: 0.3s; }
        .ai-spin-label { font-size: 13px; font-weight: 800; color: #6d28d9; }
        .ai-spin-sub { font-size: 11px; color: #94a3b8; }
        @keyframes aispin { to { transform: rotate(360deg); } }
        @keyframes aibounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-7px); opacity: 1; } }
      `}</style>
    </div>
  );
}
