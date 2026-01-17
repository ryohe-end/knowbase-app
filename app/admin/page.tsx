"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Loading from "./loading";

type Manual = {
  manualId: string;
  title: string;
  desc?: string | null;
  embedUrl?: string;
};

export default function AdminHome() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [previewManual, setPreviewManual] = useState<Manual | null>(null);
  const [isModalMax, setIsModalMax] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsInitializing(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const portalManual: Manual = {
    manualId: "PORTAL_GUIDE",
    title: "Know Base 利用ガイド",
    desc: "ポータルサイトの操作方法を解説します。",
    // ✅ /edit ではなく /preview が安定（埋め込み向け）
    embedUrl:
      "https://docs.google.com/presentation/d/16EIKzRBEwdLBG1HZbKKkW0OH59SNZEL-mZJ0EeToUgI/preview",
  };

  const closeModal = () => {
    setPreviewManual(null);
    setIsModalMax(false);
  };

  if (isInitializing) return <Loading />;

  const menuItems = [
    {
      href: "/admin/manuals",
      label: "1. CONTENTS",
      title: "マニュアル管理",
      desc: "ナレッジの核となるコンテンツを最適化します",
      color: "#3b82f6",
    },
    {
      href: "/admin/news",
      label: "2. ANNOUNCEMENT",
      title: "お知らせ管理",
      desc: "重要な告知事項を社内全体へスムーズに届けます",
      color: "#1e293b",
    },
    {
      href: "/admin/contacts",
      label: "3. MASTER DATA",
      title: "担当者管理",
      desc: "窓口情報や連絡先マスタの正確性を維持します",
      color: "#0ea5e9",
    },
    {
      href: "/admin/users",
      label: "4. ACCOUNT",
      title: "ユーザー管理",
      desc: "利用権限と所属部署の構成をセキュアに管理します",
      color: "#64748b",
    },
    {
      href: "/admin/links",
      label: "5. EXTERNAL LINKS",
      title: "外部リンク管理",
      desc: "ポータル内に表示する便利な外部ツール等のリンクを管理します",
      color: "#10b981",
    },
  ];

  return (
    <div className="kb-admin-root">
      {/* Top bar */}
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <div className="kb-topbar-left">
            <img
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
              alt="Logo"
              className="kb-logo-icon"
            />
            <img
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png"
              alt="Know Base"
              className="kb-logo-text"
            />
          </div>
          <div className="kb-topbar-right">
            <button
              className="kb-exit-btn"
              onClick={() => (window.location.href = "/")}
            >
              一般画面へ戻る
            </button>
          </div>
        </div>
      </div>

      <main className="kb-main-container">
        <header className="kb-page-header">
          <div className="kb-badge">ADMINISTRATION</div>
          <h1>管理者ダッシュボード</h1>
          <p>システム全体の構成およびコンテンツの統括管理を行います</p>
        </header>

        <div className="kb-admin-grid">
          {menuItems.map((item) => {
            // --- ラベルを「数字」と「文字」に分解 ---
            const parts = item.label.split(".");
            const number = parts[0];
            const text = parts[1] ?? "";

            return (
              <Link
                href={item.href}
                key={item.href}
                className="kb-menu-link"
              >
                <div className="kb-modern-card">
                  <div
                    className="kb-accent-bar"
                    style={{ backgroundColor: item.color }}
                  />
                  <div className="kb-card-body">
                    <div
                      style={{
                        marginBottom: "8px",
                        display: "flex",
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "42px",
                          fontWeight: "900",
                          color: "#64748b",
                          lineHeight: "1",
                        }}
                      >
                        {number}
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: "700",
                          color: "#64748b",
                          marginLeft: "4px",
                        }}
                      >
                        .{text}
                      </span>
                    </div>

                    <h3 className="kb-card-heading">{item.title}</h3>
                    <p className="kb-card-subtext">{item.desc}</p>
                  </div>
                  <div className="kb-card-footer">
                    <span className="kb-action-label">管理画面を開く</span>
                    <span className="kb-action-icon">→</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <footer className="kb-admin-footer">
          <button
            className="kb-guide-link-btn"
            onClick={(e) => {
              e.preventDefault();
              setPreviewManual(portalManual);
              setIsModalMax(false);
            }}
          >
            📘 システム利用ガイドを閲覧する
          </button>
        </footer>
      </main>

      {/* Modal */}
      {previewManual && (
        <div className="kb-modal-overlay" onClick={closeModal}>
          <div
            className={`kb-modal-content ${isModalMax ? "is-max" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kb-modal-header">
              <h3>{previewManual.title}</h3>

              <div className="kb-modal-actions">
                {/* ✅ 最大化/戻す */}
                <button
                  className="kb-modal-btn"
                  onClick={() => setIsModalMax((v) => !v)}
                  aria-label={isModalMax ? "元に戻す" : "拡大する"}
                  title={isModalMax ? "元に戻す" : "拡大"}
                >
                  ⤢
                </button>

                <button className="kb-modal-close" onClick={closeModal}>
                  ✕
                </button>
              </div>
            </div>

            <div className="kb-modal-body">
              <iframe
                src={previewManual.embedUrl}
                className="kb-modal-iframe"
                frameBorder="0"
                allowFullScreen
              ></iframe>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .kb-admin-root {
          min-height: 100vh;
          background-color: #fcfdfe;
          color: #0f172a;
          font-family: "Inter", -apple-system, sans-serif;
          position: relative;
        }

        /* Topbar */
        .kb-topbar {
          height: 64px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid #e2e8f0;
          position: sticky;
          top: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
        }
        .kb-topbar-inner {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          padding: 0 32px;
        }
        .kb-logo-icon {
          width: 32px;
          height: 32px;
        }
        .kb-logo-text {
          height: 16px;
          margin-left: 12px;
        }

        .kb-exit-btn {
          background: #fff;
          border: 1px solid #e2e8f0;
          padding: 6px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          cursor: pointer;
          transition: 0.2s;
        }
        .kb-exit-btn:hover {
          background: #f8fafc;
          border-color: #3b82f6;
          color: #3b82f6;
        }

        /* Container */
        .kb-main-container {
          max-width: 1140px;
          margin: 0 auto;
          padding: 60px 32px;
        }

        .kb-page-header {
          margin-bottom: 50px;
        }
        .kb-badge {
          display: inline-block;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.15em;
          color: #3b82f6;
          background: #eff6ff;
          padding: 4px 10px;
          border-radius: 4px;
          margin-bottom: 12px;
        }
        .kb-page-header h1 {
          font-size: 32px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 8px 0;
        }
        .kb-page-header p {
          font-size: 15px;
          color: #64748b;
          margin: 0;
        }

        /* Grid & Card */
        .kb-admin-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 24px;
        }

        .kb-menu-link {
          text-decoration: none;
          color: inherit;
          display: block;
        }

        .kb-modern-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          position: relative;
          height: 100%;
          display: flex;
          flex-direction: column;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
        }

        .kb-accent-bar {
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          width: 0px;
          transition: width 0.3s ease;
        }

        .kb-card-body {
          padding: 32px;
          flex: 1;
        }
        .kb-card-no {
          display: block;
          font-size: 10px;
          font-weight: 700;
          color: #94a3b8;
          margin-bottom: 16px;
          letter-spacing: 0.1em;
        }
        .kb-card-heading {
          font-size: 20px;
          font-weight: 800;
          color: #1e293b;
          margin-bottom: 12px;
        }
        .kb-card-subtext {
          font-size: 14px;
          color: #64748b;
          line-height: 1.6;
        }

        .kb-card-footer {
          padding: 16px 32px;
          background: #fcfdfe;
          border-top: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .kb-action-label {
          font-size: 12px;
          font-weight: 700;
          color: #94a3b8;
          transition: 0.3s;
        }
        .kb-action-icon {
          font-size: 18px;
          color: #cbd5e1;
          transition: 0.3s;
        }

        /* Hover Effects */
        .kb-modern-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05);
          border-color: #dbeafe;
        }
        .kb-modern-card:hover .kb-accent-bar {
          width: 5px;
        }
        .kb-modern-card:hover .kb-action-label {
          color: #3b82f6;
        }
        .kb-modern-card:hover .kb-action-icon {
          color: #3b82f6;
          transform: translateX(5px);
        }

        /* Footer */
        .kb-admin-footer {
          margin-top: 60px;
          text-align: center;
        }
        .kb-guide-link-btn {
          background: #fff;
          border: 1px solid #e2e8f0;
          color: #475569;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          padding: 12px 28px;
          border-radius: 99px;
          transition: 0.2s;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
        }
        .kb-guide-link-btn:hover {
          border-color: #3b82f6;
          color: #3b82f6;
          transform: translateY(-2px);
          box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.1);
        }

        /* Modal */
        .kb-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(15, 23, 42, 0.5);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
        }

        .kb-modal-content {
          background: #fff;
          width: 100%;
          max-width: 1000px;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          display: flex;
          flex-direction: column;
          max-height: 90vh;
        }

        .kb-modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .kb-modal-header h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
        }

        .kb-modal-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .kb-modal-btn {
          background: #f1f5f9;
          border: none;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          cursor: pointer;
          color: #64748b;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
        }
        .kb-modal-btn:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .kb-modal-close {
          background: #f1f5f9;
          border: none;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          cursor: pointer;
          color: #64748b;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
        }
        .kb-modal-close:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        .kb-modal-body {
          flex: 1;
          position: relative;
          background: #f8fafc;
        }
        .kb-modal-iframe {
          width: 100%;
          height: 600px;
          display: block;
        }

        /* ✅ 最大化 */
        .kb-modal-content.is-max {
          max-width: 96vw;
          max-height: 96vh;
          width: 96vw;
          height: 96vh;
        }
        .kb-modal-content.is-max .kb-modal-iframe {
          height: calc(96vh - 62px); /* header分 */
        }
      `}</style>
    </div>
  );
}
