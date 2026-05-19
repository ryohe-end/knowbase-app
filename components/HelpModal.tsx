"use client";

import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Google Slides の埋め込み URL (例: https://docs.google.com/presentation/d/XXX/preview) */
  slidesUrl: string;
  title?: string;
};

export default function HelpModal({ open, onClose, slidesUrl, title = "Know Base 使い方ガイド" }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="kb-help-backdrop" onClick={onClose}>
      <div className={"kb-help-modal" + (maximized ? " max" : "")} onClick={(e) => e.stopPropagation()}>
        <div className="kb-help-head">
          <h3>{title}</h3>
          <div className="kb-help-actions">
            <button className="kb-help-btn" onClick={() => setMaximized((v) => !v)} title={maximized ? "元に戻す" : "拡大"}>
              {maximized ? "⤡" : "⤢"}
            </button>
            <button className="kb-help-btn round" onClick={onClose} title="閉じる">✕</button>
          </div>
        </div>
        <div className="kb-help-body">
          {slidesUrl ? (
            <iframe
              src={slidesUrl}
              title={title}
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="kb-help-empty">
              <p>使い方ガイドの URL がまだ設定されていません。</p>
              <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 12 }}>
                管理者の方は、Google Slides で資料を作成し、その埋め込み URL (末尾 `/preview`) を <code>HELP_SLIDES_URL</code> 環境変数 or コードに設定してください。
              </p>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .kb-help-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9998;
          padding: 16px;
        }
        .kb-help-modal {
          background: #fff;
          width: min(1000px, 96vw);
          max-height: 90vh;
          border-radius: 18px;
          overflow: hidden;
          display: grid;
          grid-template-rows: auto 1fr;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
        }
        .kb-help-modal.max {
          width: 96vw;
          height: 96vh;
          max-height: 96vh;
        }
        .kb-help-head {
          padding: 14px 18px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .kb-help-head h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 800;
          color: #0f172a;
        }
        .kb-help-actions {
          display: flex;
          gap: 6px;
        }
        .kb-help-btn {
          background: #f1f5f9;
          border: none;
          width: 32px;
          height: 32px;
          border-radius: 999px;
          cursor: pointer;
          color: #475569;
          font-size: 14px;
          font-weight: 700;
        }
        .kb-help-btn:hover { background: #e2e8f0; color: #0f172a; }
        .kb-help-btn.round { font-size: 13px; }
        .kb-help-body {
          background: #f8fafc;
          min-height: 400px;
          position: relative;
        }
        .kb-help-body iframe {
          width: 100%;
          height: 600px;
          border: none;
          display: block;
        }
        .kb-help-modal.max .kb-help-body iframe {
          height: calc(96vh - 60px);
        }
        .kb-help-empty {
          padding: 60px 32px;
          text-align: center;
          color: #475569;
          font-size: 14px;
          line-height: 1.6;
        }
        .kb-help-empty code {
          background: #fff;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #e2e8f0;
          font-family: "SF Mono", Consolas, monospace;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
