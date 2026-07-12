// app/store-settings/push/layout.tsx
// /push/* 配下で共有する styled-jsx グローバル CSS。
// page.tsx と new/page.tsx と [id]/page.tsx で同じスタイルが効くようにする。

"use client";

import React from "react";

export default function PushLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <style jsx global>{`
        .push-root { background: #f8fafc; min-height: 100vh; font-family: 'Inter', sans-serif; color: #1e293b; }

        /* Header (shared) */
        .push-header { background: #fff; border-bottom: 1px solid #e2e8f0; height: 64px; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .push-header-inner { width: 100%; max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; }
        .push-header-left { display: flex; align-items: center; gap: 8px; }
        .push-header-title { font-size: 1.15rem; font-weight: 800; color: #0f172a; }
        .push-back-btn { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; color: #64748b; background: #f1f5f9; transition: 0.2s; }
        .push-back-btn:hover { background: #e2e8f0; color: #0f172a; }
        .push-primary-btn { background: #0f172a; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; text-decoration: none; }
        .push-primary-btn:hover { background: #1e293b; }
        .push-primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        /* List page */
        .push-main-content { max-width: 1400px; margin: 0 auto; padding: 24px; }
        .push-kpi-section { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .push-kpi-tile { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .push-kpi-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .push-kpi-value { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1.2; margin: 4px 0; }
        .push-kpi-value small { font-size: 16px; color: #64748b; margin-left: 2px; }
        .push-kpi-sub { font-size: 11px; color: #94a3b8; }
        @media (max-width: 900px) { .push-kpi-section { grid-template-columns: repeat(2, 1fr); } }

        .push-history-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
        .push-table-container { overflow-x: auto; }
        .push-history-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .push-history-table th { background: #f8fafc; padding: 12px 16px; font-weight: 700; color: #475569; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .push-history-table td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
        .push-history-table .clickable-row { cursor: pointer; transition: background 0.12s; }
        .push-history-table .clickable-row:hover { background: #f8fafc; }
        .push-history-table .empty-row { text-align: center; color: #94a3b8; padding: 40px; }
        .date-cell { white-space: nowrap; color: #475569; }
        .subj-cell { font-weight: 600; color: #0f172a; }
        .status-pill { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; }
        .status-pill.sent { background: #ecfdf5; color: #047857; }
        .status-pill.scheduled { background: #eff6ff; color: #1d4ed8; }
        .status-pill.draft { background: #f1f5f9; color: #475569; }

        /* New page (3 column layout) */
        .push-new-main { max-width: 1500px; margin: 0 auto; padding: 24px; }
        .push-new-grid { display: grid; grid-template-columns: 340px 1fr 320px; gap: 16px; align-items: start; }
        @media (max-width: 1200px) { .push-new-grid { grid-template-columns: 1fr; } }

        .push-col-config, .push-col-list, .push-col-preview { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }

        .push-step-group { margin-bottom: 20px; }
        .push-step-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .push-step-badge { width: 22px; height: 22px; border-radius: 50%; background: #0f172a; color: #fff; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
        .push-step-header h3 { font-size: 13px; font-weight: 800; margin: 0; color: #0f172a; }
        .push-divider { height: 1px; background: #e2e8f0; margin: 14px 0; }
        .push-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .push-field label { font-size: 11px; font-weight: 700; color: #475569; }
        .req { color: #ef4444; }
        .push-input, .push-textarea, .push-field input, .push-field textarea { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; box-sizing: border-box; background: #fff; color: #0f172a; outline: none; transition: border-color 0.15s; font-family: inherit; }
        .push-input:focus, .push-textarea:focus, .push-field input:focus, .push-field textarea:focus { border-color: #0f172a; }
        .push-textarea { resize: vertical; }
        .push-row-2 { display: flex; gap: 6px; align-items: center; }
        .push-row-2 > input { flex: 1; min-width: 0; height: 34px; box-sizing: border-box; }
        .push-row-2 > span { flex: 0 0 auto; font-size: 11px; color: #94a3b8; }
        .push-check-row { display: flex; gap: 12px 16px; flex-wrap: wrap; }
        .push-check-row label { font-size: 12px; font-weight: 600; color: #334155; display: flex; align-items: center; gap: 6px; }
        .push-check-row input, .push-check-grid input { flex: 0 0 auto; margin: 0; }
        .push-check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; align-items: start; }
        .push-check-grid label { font-size: 12px; font-weight: 600; color: #334155; display: flex; align-items: center; gap: 6px; cursor: pointer; line-height: 1.4; }
        .push-label-row { display: flex; align-items: center; justify-content: space-between; }
        .push-bulk-toggle { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #94a3b8; }
        .push-bulk-toggle button { background: none; border: none; padding: 0; font-size: 11px; font-weight: 700; color: #0f172a; cursor: pointer; text-decoration: underline; }
        .push-bulk-toggle button:hover { color: #2563eb; }
        .contract-chip { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; font-weight: 700; }
        .push-unpaid-check { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #334155; }
        .push-filter-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
        .push-extract-btn { width: 100%; background: #0f172a; color: #fff; border: none; padding: 10px; border-radius: 6px; font-weight: 700; cursor: pointer; margin-top: 4px; font-size: 13px; }
        .push-extract-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .push-radio-box { display: flex; gap: 8px; }
        .push-radio-box label { flex: 1; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; font-size: 12px; font-weight: 600; color: #475569; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: 0.15s; }
        .push-radio-box label.active { border-color: #0f172a; background: #0f172a; color: #fff; }
        .push-radio-box input { display: none; }
        .mt-2 { margin-top: 8px; }
        .push-hint { font-size: 11px; color: #64748b; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; line-height: 1.5; margin-top: 8px; }

        /* List inside create */
        .push-panel-header-sticky { font-size: 12px; font-weight: 800; color: #475569; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
        .push-col-list { display: flex; flex-direction: column; max-height: 78vh; }
        .push-list-container { flex: 1; overflow-y: auto; }
        .push-list-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .push-list-table th, .push-list-table td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; text-align: left; }
        .push-list-table th { background: #f8fafc; font-weight: 700; color: #475569; font-size: 11px; position: sticky; top: 0; }
        .push-list-table tr.excluded { opacity: 0.4; }
        .push-u-info strong { font-size: 12px; color: #0f172a; }
        .push-u-info small { display: block; font-size: 10px; color: #94a3b8; }
        .push-u-meta { display: flex; gap: 6px; align-items: center; }
        .status-badge { font-size: 10px; padding: 2px 6px; border-radius: 99px; font-weight: 700; }
        .status-badge.stable { background: #ecfdf5; color: #047857; }
        .status-badge.leaver { background: #fee2e2; color: #b91c1c; }
        .visit-count { font-size: 11px; color: #64748b; font-weight: 600; }
        .date-info { font-size: 10px; color: #94a3b8; }
        .unpaid-dot { display: inline-block; width: 18px; height: 18px; border-radius: 50%; background: #fef3c7; color: #b45309; font-size: 11px; font-weight: 800; text-align: center; line-height: 18px; }
        .push-empty-state { text-align: center; color: #94a3b8; padding: 60px 20px; font-size: 13px; }
        .push-list-pager { display: flex; justify-content: center; align-items: center; gap: 12px; padding: 10px 0; font-size: 12px; color: #475569; border-top: 1px solid #e2e8f0; }
        .push-list-pager button { background: #f1f5f9; border: none; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; }
        .push-list-pager button:disabled { opacity: 0.4; }

        /* Preview phone mockup */
        .push-preview-frame { display: flex; justify-content: center; padding: 12px 0; }
        .push-phone-mockup { width: 260px; height: 420px; background: linear-gradient(180deg, #1e1b4b 0%, #3730a3 100%); border-radius: 32px; padding: 22px 12px 12px; position: relative; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25); }
        .push-notch { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); width: 90px; height: 18px; background: #0f172a; border-radius: 12px; }
        .push-screen { display: flex; flex-direction: column; gap: 12px; }
        .push-time { color: #fff; font-size: 20px; font-weight: 800; text-align: center; margin-top: 18px; }
        .push-notification-bubble { background: rgba(255,255,255,0.95); border-radius: 14px; padding: 10px 12px; }
        .push-bubble-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .push-app-info { display: flex; align-items: center; gap: 6px; }
        .push-app-icon { width: 18px; height: 18px; background: linear-gradient(135deg, #f97316, #ef4444); border-radius: 4px; }
        .push-app-name { font-size: 11px; font-weight: 700; color: #475569; }
        .push-now { font-size: 10px; color: #94a3b8; }
        .push-bubble-title { font-size: 13px; font-weight: 800; color: #0f172a; }
        .push-bubble-body { font-size: 11px; color: #334155; margin-top: 2px; line-height: 1.45; }

        /* Detail page */
        .push-detail-main { max-width: 1300px; margin: 0 auto; padding: 24px; }
        .push-detail-grid { display: grid; grid-template-columns: 360px 1fr; gap: 16px; align-items: start; }
        @media (max-width: 1100px) { .push-detail-grid { grid-template-columns: 1fr; } }
        .push-detail-side { display: flex; flex-direction: column; gap: 16px; }
        .push-detail-main-col { display: flex; flex-direction: column; gap: 16px; }
        .push-detail-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .push-detail-card-title { font-size: 12px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; }
        .push-detail-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 13px; }
        .push-detail-row span:first-child { color: #64748b; font-weight: 600; font-size: 11px; }
        .push-detail-row span:last-child { color: #0f172a; font-weight: 700; }
        .push-detail-block { margin-bottom: 10px; }
        .push-detail-label { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; }
        .push-detail-val { font-size: 13px; color: #0f172a; }
        .push-detail-val.multiline { white-space: pre-wrap; }
        .push-report-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .kpi-item { background: #f8fafc; border-radius: 8px; padding: 12px; text-align: center; }
        .kpi-item label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .kpi-val { font-size: 24px; font-weight: 800; color: #0f172a; line-height: 1.2; margin-top: 4px; }
        .kpi-val small { font-size: 14px; color: #64748b; margin-left: 2px; }
        .kpi-val.text-blue { color: #0284c7; }
        .kpi-val.text-green { color: #16a34a; }
        .error-bar { background: #fef2f2; border: 1px solid #fecaca; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; margin-top: 10px; font-size: 12px; font-weight: 700; }
        .err-label { color: #b91c1c; }
        .err-val { color: #b91c1c; }
        .push-chart-wrap { padding: 8px 0; }

        /* Confirm modal */
        .push-confirm-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; z-index: 2000; }
        .push-confirm-window { background: #fff; width: 90%; max-width: 520px; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
        .push-confirm-header { padding: 20px 24px 12px; border-bottom: 1px solid #e2e8f0; }
        .push-confirm-header h3 { font-size: 17px; font-weight: 800; margin: 0 0 4px; color: #0f172a; }
        .push-confirm-header p { font-size: 12px; color: #64748b; margin: 0; }
        .push-confirm-body { padding: 16px 24px; display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow-y: auto; }
        .push-confirm-row { display: grid; grid-template-columns: 110px 1fr; gap: 12px; align-items: start; }
        .push-confirm-label { font-size: 11px; font-weight: 700; color: #64748b; padding-top: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
        .push-confirm-val { font-size: 13px; color: #0f172a; word-break: break-word; }
        .push-confirm-val.multiline { white-space: pre-wrap; }
        .push-confirm-val.emphasis { font-weight: 800; font-size: 14px; }
        .push-confirm-val.warn { color: #b45309; }
        .push-confirm-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
        .push-modal-cancel { background: #fff; color: #475569; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 12px; }
        .push-modal-submit { background: #0f172a; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 12px; }
        .push-modal-submit:disabled, .push-modal-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </>
  );
}
