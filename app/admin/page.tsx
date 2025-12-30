"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
// loading.tsx と同じデザインをインポート（または共通化）
import Loading from "./loading";

/* ========= 型・ヘルパー関数 ========= */
type Manual = {
  manualId: string; title: string; brandId?: string; brand?: string; bizId?: string; biz?: string;
  desc?: string | null; updatedAt?: string; tags?: string[]; embedUrl?: string;
};

const getEmbedSrc = (url?: string) => {
  if (!url) return "";
  let embedSrc = url;
  if (embedSrc.includes("docs.google.com/presentation")) return embedSrc;
  if (embedSrc.includes("drive.google.com/file")) {
    const m = embedSrc.match(/https:\/\/drive\.google\.com\/file\/d\/([^/]+)/);
    if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  }
  return embedSrc;
};

export default function AdminHome() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [previewManual, setPreviewManual] = useState<Manual | null>(null);

  // 【追加】最低表示時間を設定
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitializing(false);
    }, 1200); // ここで表示時間を調整（1200ms = 1.2秒）
    return () => clearTimeout(timer);
  }, []);

  const portalManual: Manual = {
    manualId: "PORTAL_GUIDE",
    title: "Know Base 利用ガイド",
    desc: "ポータルサイトの操作方法を解説します。",
    embedUrl: "https://docs.google.com/presentation/d/1Bf2m1b04jD92w7g0Xo4t7s5U6yD3H3v5aF0r2hL6yR8/embed",
    updatedAt: new Date().toISOString().slice(0, 10),
    tags: ["ガイド"],
  };

  // 初期化中は loading.tsx と同じ画面を出す
  if (isInitializing) {
    return <Loading />;
  }

  return (
    <div className="kb-admin-root">
      {/* Top bar */}
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <div className="kb-topbar-left">
            <img 
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" 
              alt="Logo" 
              className="kb-header-logo-img" 
            />
            <img 
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png" 
              alt="Text Logo" 
              className="kb-header-text-img" 
            />
          </div>
          <div className="kb-topbar-right">
            <button 
              className="kb-logout-btn" 
              onClick={() => (window.location.href = "/")}
            >
              一般画面へ戻る
            </button>
          </div>
        </div>
      </div>

      <div className="kb-admin-wrapper">
        <header className="kb-admin-header">
          <h1>Knowbie管理者画面</h1>
          <p>管理権限：統合管理者マスタ</p>
        </header>

        <div className="kb-menu-grid">
          <Link href="/admin/manuals" className="kb-admin-card card-blue">
            <div className="kb-card-icon-bg">📄</div>
            <div className="kb-card-text-area">
              <h3 className="kb-card-title">マニュアル管理</h3>
              <p className="kb-card-desc">コンテンツの登録・編集・削除</p>
            </div>
            <div className="kb-card-arrow">→</div>
          </Link>

          <Link href="/admin/news" className="kb-admin-card card-navy">
            <div className="kb-card-icon-bg">📢</div>
            <div className="kb-card-text-area">
              <h3 className="kb-card-title">お知らせ管理</h3>
              <p className="kb-card-desc">配信予約と告知情報の管理</p>
            </div>
            <div className="kb-card-arrow">→</div>
          </Link>

          <Link href="/admin/contacts" className="kb-admin-card card-sky">
            <div className="kb-card-icon-bg">👤</div>
            <div className="kb-card-text-area">
              <h3 className="kb-card-title">担当者管理</h3>
              <p className="kb-card-desc">連絡先マスタ・窓口設定</p>
            </div>
            <div className="kb-card-arrow">→</div>
          </Link>

          <Link href="/admin/users" className="kb-admin-card card-dark">
            <div className="kb-card-icon-bg">⚙️</div>
            <div className="kb-card-text-area">
              <h3 className="kb-card-title">ユーザー管理</h3>
              <p className="kb-card-desc">権限・所属部署の個別設定</p>
            </div>
            <div className="kb-card-arrow">→</div>
          </Link>
        </div>

        <footer className="kb-admin-footer">
          <button className="kb-footer-guide-btn" onClick={() => setPreviewManual(portalManual)}>
            📘 このサイトの使い方を確認する
          </button>
        </footer>
      </div>

      <style jsx>{`
  /* 前回の修正スタイルをそのまま維持 + hover強化版 */
  .kb-admin-root {
    min-height: 100vh;
    background: #f8fafc;
    width: 100%;
    animation: fadeIn 0.5s ease-in;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .kb-topbar {
    width: 100%;
    height: 70px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
  }
  .kb-topbar-inner {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 40px;
  }
  .kb-topbar-left { display: flex; align-items: center; gap: 16px; }
  .kb-header-logo-img { width: 44px; height: 44px; object-fit: contain; }
  .kb-header-text-img { height: 20px; object-fit: contain; }

  .kb-logout-btn {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    padding: 8px 20px;
    border-radius: 99px;
    font-size: 13px;
    font-weight: 700;
    color: #475569;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
  }
  .kb-logout-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
    transform: translateY(-1px);
  }

  .kb-admin-wrapper { max-width: 1120px; margin: 0 auto; padding: 60px 40px; }
  .kb-admin-header { margin-bottom: 48px; }
  .kb-admin-header h1 { font-size: 32px; font-weight: 900; color: #0f172a; margin: 0 0 8px 0; }
  .kb-admin-header p { font-size: 15px; color: #64748b; margin: 0; }

  .kb-menu-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 24px;
  }

  /* =========================
     ✅ Card（Hoverが確実に分かる版）
     ========================= */
  .kb-admin-card {
    position: relative;
    display: flex;
    align-items: center;
    padding: 36px 28px;
    border-radius: 32px;
    text-decoration: none;

    border: 1px solid rgba(0,0,0,0.06);
    box-shadow: 0 6px 14px rgba(15, 23, 42, 0.06);

    cursor: pointer;
    pointer-events: auto; /* ← hover効かない対策 */
    will-change: transform, box-shadow, border-color;

    transition:
      transform 0.22s ease,
      box-shadow 0.22s ease,
      border-color 0.22s ease,
      filter 0.22s ease;
  }

  .kb-card-text-area { flex: 1; position: relative; z-index: 10; }
  .kb-card-title { font-size: 20px; font-weight: 800; margin: 0 0 6px 0; color: #0f172a !important; }
  .kb-card-desc { font-size: 13px; margin: 0; color: #475569 !important; line-height: 1.4; }

  .kb-card-icon-bg {
    font-size: 40px;
    margin-right: 20px;
    position: relative;
    z-index: 10;
    transition: transform 0.22s ease;
  }

  /* 矢印：通常は控えめ＆少し隠す → hoverで出す */
  .kb-card-arrow {
    font-size: 20px;
    color: #0f172a;
    opacity: 0;                 /* ✅ ここがポイント */
    transform: translateX(12px); /* ✅ ここがポイント */
    transition: opacity 0.22s ease, transform 0.22s ease;
  }

  /* ✅ hover：浮く + 影強め + 枠線 + リング（外側の光） */
  .kb-admin-card:hover {
    transform: translateY(-8px);
    box-shadow: 0 26px 60px rgba(15, 23, 42, 0.18);
    border-color: rgba(59, 130, 246, 0.45);
    filter: saturate(1.02);
  }

  /* hoverでアイコンが少し動く（分かりやすい） */
  .kb-admin-card:hover .kb-card-icon-bg {
    transform: translateY(-2px) scale(1.05);
  }

  /* hoverで矢印が出る */
  .kb-admin-card:hover .kb-card-arrow {
    opacity: 0.95;
    transform: translateX(0);
  }

  /* ✅ キーボード操作でも“選択中”が分かる */
  .kb-admin-card:focus-visible {
    outline: none;
    border-color: rgba(59, 130, 246, 0.7);
    box-shadow:
      0 0 0 4px rgba(59, 130, 246, 0.24),
      0 26px 60px rgba(15, 23, 42, 0.18);
  }

  /* 色テーマ（そのまま維持） */
  .card-blue { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 8px solid #3b82f6; }
  .card-navy { background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); border-left: 8px solid #1e293b; }
  .card-sky  { background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-left: 8px solid #0ea5e9; }
  .card-dark { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-left: 8px solid #64748b; }

  .kb-admin-footer {
    margin-top: 60px;
    padding-top: 40px;
    border-top: 1px dashed #cbd5e1;
    text-align: center;
  }
  .kb-footer-guide-btn {
    background: #fff;
    border: 1px solid #e2e8f0;
    padding: 16px 32px;
    border-radius: 99px;
    font-size: 15px;
    font-weight: 700;
    color: #1e293b;
    cursor: pointer;
    transition: transform 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
  }
  .kb-footer-guide-btn:hover {
    border-color: #3b82f6;
    color: #3b82f6;
    transform: translateY(-2px);
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.10);
  }
  .kb-admin-root {
  position: relative;
  z-index: 1;
}

.kb-admin-wrapper {
  position: relative;
  z-index: 2;
}

.kb-menu-grid {
  position: relative;
  z-index: 3;
}

.kb-admin-card {
  position: relative;
  z-index: 4;
  pointer-events: auto;
}
`}</style>

    </div>
  );
}