// app/admin/page.tsx
"use client";

import { useState } from "react"; // useState を追加

/* ========= 型 (app/page.tsx からコピー) ========= */

type Manual = {
  manualId: string;
  title: string;
  brandId?: string;
  brand?: string;
  bizId?: string;
  biz?: string;
  desc?: string | null;
  updatedAt?: string;
  tags?: string[];
  embedUrl?: string;
  isNew?: boolean;
  noDownload?: boolean;
  readCount?: number;
  startDate?: string;
  endDate?: string;
};

type Brand = {
  brandId: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
};

type Dept = {
  deptId: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
};

// マニュアルモーダルで使用するマップは空オブジェクトで仮定義
const brandMap: Record<string, Brand> = {};
const deptMap: Record<string, Dept> = {};

// Google Drive / Slides 埋め込み用 URL 整形（app/page.tsx からコピー）
const getEmbedSrc = (url?: string) => {
  if (!url) return "";

  let embedSrc = url;

  // Google スライドは /embed の URL そのまま
  if (embedSrc.includes("docs.google.com/presentation")) {
    return embedSrc;
  }

  // Google Drive ファイル（/file/d/.../view） → /preview に変換
  if (embedSrc.includes("drive.google.com/file")) {
    const m = embedSrc.match(
      /https:\/\/drive\.google\.com\/file\/d\/([^/]+)/
    );
    if (m) {
      const id = m[1];
      return `https://drive.google.com/file/d/${id}/preview`;
    }
  }

  // その他はそのまま
  return embedSrc;
};


export default function AdminHome() {
  // マニュアルプレビュー用状態
  const [previewManual, setPreviewManual] = useState<Manual | null>(null);
  
  // ポータルサイトの使い方マニュアルのデータ
  const portalManual: Manual = {
    manualId: "PORTAL_GUIDE",
    title: "ポータルサイト Know Base の使い方",
    desc: "Know Base の各機能（マニュアル検索、Knowbie、担当者検索）の利用方法を説明します。",
    embedUrl: "https://docs.google.com/presentation/d/1Bf2m1b04jD92w7g0Xo4t7s5U6yD3H3v5aF0r2hL6yR8/embed?start=false&loop=false&delayms=3000",
    updatedAt: new Date().toISOString().slice(0, 10),
    tags: ["ポータル", "利用方法", "ガイド"],
  };

  return (
    <div className="kb-root">
      {/* ===== Top bar (一般画面と共通化済み) ===== */}
      <div className="kb-topbar">
        <div
          className="kb-topbar-left"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
          }}
        >
          {/* 左：KBアイコン */}
          <img
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
            alt="KB Logo"
            style={{
              width: "48px",
              height: "48px",
              objectFit: "contain",
            }}
          />

          {/* 右：KnowBase文字ロゴ */}
          <img
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png"
            alt="KnowBase Text Logo"
            style={{
              height: "22px",
              objectFit: "contain",
            }}
          />
        </div>

        <div className="kb-topbar-center" />

        <div className="kb-topbar-right">
          <button
            className="kb-logout-btn"
            onClick={() => (window.location.href = "/")}
          >
            一般画面へ戻る
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "16px",
          background: "#ffffff",
          borderRadius: 16,
          border: "1px solid #e5e7eb",
        }}
      >
        <div className="kb-title-main" style={{ marginBottom: 12 }}>
          管理メニュー
        </div>

        {/* 管理メニューをカード形式のグリッドで表示 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
          }}
        >
          {/* マニュアル管理カード */}
          <a href="/admin/manuals" className="kb-admin-menu-card">
            <div className="kb-card-icon">📄</div>
            <div className="kb-card-title-main">マニュアル管理</div>
            <div className="kb-card-desc">
              マニュアルの登録・編集・削除を行います。
            </div>
          </a>

          {/* お知らせ管理カード */}
          <a href="/admin/news" className="kb-admin-menu-card">
            <div className="kb-card-icon">📰</div>
            <div className="kb-card-title-main">お知らせ管理</div>
            <div className="kb-card-desc">
              トップページに表示するお知らせを作成・管理します。
            </div>
          </a>

          {/* 担当者管理カード */}
          <a href="/admin/contacts" className="kb-admin-menu-card">
            <div className="kb-card-icon">👤</div>
            <div className="kb-card-title-main">担当者管理</div>
            <div className="kb-card-desc">
              各業務の担当者情報（連絡先）を管理します。
            </div>
          </a>

          {/* ユーザー管理カード */}
          <a href="/admin/users" className="kb-admin-menu-card">
            <div className="kb-card-icon">🧑‍💼</div>
            <div className="kb-card-title-main">ユーザー管理</div>
            <div className="kb-card-desc">
              ユーザーのアクセス権限、ブランド・部署の所属を設定します。
            </div>
          </a>
        </div>
        
        {/* マニュアルボタン */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px dashed #e5e7eb" }}>
          <button 
            className="kb-primary-btn"
            style={{ padding: "10px 16px", fontSize: 13, minWidth: 200 }}
            onClick={() => setPreviewManual(portalManual)}
          >
            📘 このポータルサイトの使い方
          </button>
        </div>
      </div>

      {/* ===== マニュアル プレビューモーダル (app/page.tsx からコピー) ===== */}
      {previewManual && (
        <div
          className="kb-modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "16px",
            zIndex: 9999,
            backdropFilter: "blur(4px)",
          }}
          onClick={() => setPreviewManual(null)}
        >
          <div
            className="kb-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "1040px",
              maxHeight: "90vh",
              background:
                "linear-gradient(135deg, #0f172a 0%, #020617 20%, #f9fafb 20%, #ffffff 100%)",
              borderRadius: 20,
              padding: 0,
              boxShadow: "0 24px 60px rgba(15,23,42,0.5)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* ヘッダー */}
            <div
              style={{
                padding: "16px 20px",
                background:
                  "radial-gradient(circle at top left, #0ea5e9, #020617)",
                color: "#e5f4ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "999px",
                    background: "rgba(15,23,42,0.6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                  }}
                >
                  📘
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      marginBottom: 2,
                      color: "#f9fafb",
                    }}
                  >
                    {previewManual.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.9,
                    }}
                  >
                    {previewManual.brandId &&
                      (brandMap[previewManual.brandId]?.name ||
                        previewManual.brand ||
                        "ブランド未設定")}
                    {previewManual.bizId &&
                      ` / ${
                        deptMap[previewManual.bizId]?.name ||
                        previewManual.biz ||
                        "部署未設定"
                      }`}
                    {previewManual.updatedAt &&
                      ` / 更新日: ${previewManual.updatedAt}`}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {previewManual.embedUrl && (
                  <button
                    className="kb-primary-btn"
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "none",
                      background: "#f9fafb",
                      color: "#0f172a",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      window.open(previewManual.embedUrl!, "_blank");
                    }}
                  >
                    新しいタブで開く
                  </button>
                )}
                <button
                  className="kb-secondary-btn"
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(248,250,252,0.6)",
                    background: "transparent",
                    color: "#e5f4ff",
                    cursor: "pointer",
                  }}
                  onClick={() => setPreviewManual(null)}
                >
                  閉じる
                </button>
              </div>
            </div>

            {/* ボディ */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: 16,
                gap: 12,
                background: "#f9fafb",
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* タグ & 説明 */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {(previewManual.tags || []).length > 0 && (
                  <div className="kb-tag-row">
                    {(previewManual.tags || []).map((t, i) => (
                      <span
                        className="kb-tag"
                        key={i}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "#e0f2fe",
                          color: "#0369a1",
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {previewManual.desc && (
                  <div
                    style={{
                      fontSize: 13,
                      color: "#374151",
                      whiteSpace: "pre-wrap",
                      borderRadius: 12,
                      background: "#ffffff",
                      padding: 10,
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    {previewManual.desc}
                  </div>
                )}
              </div>

              {/* プレビューエリア（16:9 固定） */}
              {(() => {
                const embedSrc = getEmbedSrc(previewManual.embedUrl);
                if (!embedSrc) {
                  return (
                    <div
                      className="kb-subnote"
                      style={{
                        fontSize: 13,
                        color: "#6b7280",
                        padding: 12,
                        borderRadius: 10,
                        background: "#e5e7eb",
                      }}
                    >
                      このマニュアルにはプレビュー用の URL が設定されていません。
                    </div>
                  );
                }

                return (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 960,
                        aspectRatio: "16 / 9",
                        borderRadius: 14,
                        overflow: "hidden",
                        border: "1px solid #d1d5db",
                        background: "#020617",
                        position: "relative",
                      }}
                    >
                      <iframe
                        src={embedSrc}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          border: "none",
                          background: "#020617",
                        }}
                        allowFullScreen
                        loading="lazy"
                      />

                      {/* 表示されない場合のメッセージバー */}
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: 0,
                          padding: "6px 10px",
                          fontSize: 11,
                          color: "#e5e7eb",
                          background:
                            "linear-gradient(90deg, rgba(15,23,42,0.95), rgba(15,23,42,0.7))",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span>
                          表示されない場合は「新しいタブで開く」ボタンから閲覧してください。
                        </span>
                        {previewManual.embedUrl && (
                          <button
                            style={{
                              fontSize: 11,
                              padding: "4px 8px",
                              borderRadius: 999,
                              border: "1px solid rgba(248,250,252,0.8)",
                              background: "transparent",
                              color: "#e5e7eb",
                              cursor: "pointer",
                            }}
                            onClick={() =>
                              window.open(previewManual.embedUrl!, "_blank")
                            }
                          >
                            タブで開く
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* カード形式のスタイルを追加 */}
      <style jsx>{`
        .kb-admin-menu-card {
          display: flex;
          flex-direction: column;
          padding: 20px;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          text-decoration: none;
          color: #0f172a;
          transition: all 0.2s ease;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.04);
        }
        .kb-admin-menu-card:hover {
          background: #eff6ff;
          border-color: #0ea5e9;
          transform: translateY(-2px);
          box-shadow: 0 8px 15px rgba(0, 0, 0, 0.08);
        }
        .kb-card-icon {
          font-size: 28px;
          margin-bottom: 10px;
        }
        .kb-card-title-main {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 4px;
        }
        .kb-card-desc {
          font-size: 12px;
          color: #6b7280;
        }
        .kb-primary-btn {
          /* 既存のkb-primary-btnスタイルがあれば、それを継承 */
          display: inline-block;
          border: none;
          background: #0ea5e9;
          color: #ffffff;
          border-radius: 999px;
          cursor: pointer;
          font-weight: 600;
          text-align: center;
        }
        .kb-secondary-btn {
          /* モーダルヘッダー用 */
          display: inline-block;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #0f172a;
          border-radius: 999px;
          cursor: pointer;
        }
        .kb-tag-row {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .kb-tag {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          background: #e0f2fe;
          color: #0369a1;
        }
      `}</style>
    </div>
  );
}