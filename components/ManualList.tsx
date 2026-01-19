"use client";

import { useEffect, useMemo, useState } from "react";
import type { Manual } from "@/types/manual";

type Props = { manuals: (Manual & { externalUrl?: string })[] };

function safeOpen(url: string) {
  if (!url) return;
  // ✅ 外部リンクを常に別タブで開く
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * 埋め込み用URL変換 (YouTube, Canva, Google Drive 対策)
 */
function toEmbeddableUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u) return "";

  // ✅ Canva 対策: /view 形式を /watch?embed 形式に変換
  // 対象URL: https://www.canva.com/design/DAG-jewUDGg/.../view?utm_content...
  if (u.includes("canva.com/design/")) {
    const canvaMatch = u.match(/design\/([A-Za-z0-9_-]+)/);
    if (canvaMatch?.[1]) {
      return `https://www.canva.com/design/${canvaMatch[1]}/watch?embed`;
    }
  }

  // YouTube 対策
  const ytMatch = u.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (ytMatch?.[1]) {
    return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?rel=0&enablejsapi=1`;
  }

  // Google Drive 対策
  const driveMatch = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch?.[1]) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;

  // Google Docs/Sheets/Slides 対策
  const docsMatch = u.match(
    /docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/
  );
  if (docsMatch?.[1] && docsMatch?.[2]) {
    const suffix = isVideo ? "embed" : "preview";
    return `https://docs.google.com/${docsMatch[1]}/d/${docsMatch[2]}/${suffix}`;
  }

  return u;
}

function toDownloadUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u || isVideo) return u;

  const slideMatch = u.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
  if (slideMatch?.[1]) {
    return `https://docs.google.com/presentation/d/${slideMatch[1]}/export/pdf`;
  }

  const driveMatch = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }

  return u;
}

function parseTime(s?: string | null) {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
}

const DAY = 24 * 60 * 60 * 1000;
const WINDOW = 30 * DAY;

export default function ManualList({ manuals }: Props) {
  // ✅ ソート状態の統合管理
  const [sortKey, setSortKey] = useState<"date" | "name">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalUrl, setModalUrl] = useState("");
  const [rawUrl, setRawUrl] = useState("");

  const [now, setNow] = useState<number>(0);
  useEffect(() => {
    setNow(Date.now());
  }, []);

  const closeModal = () => {
    setIsModalOpen(false);
    setModalTitle("");
    setModalUrl("");
    setRawUrl("");
  };

  useEffect(() => {
    if (!isModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isModalOpen]);

  // ✅ ソートボタンが押された時のハンドラ
  const handleSort = (key: "date" | "name") => {
    if (sortKey === key) {
      // 同じ項目なら向きを反転
      setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    } else {
      // 違う項目なら、その項目でデフォルトの並び（日付なら降順、名前なら昇順）にする
      setSortKey(key);
      setSortOrder(key === "date" ? "desc" : "asc");
    }
  };

  // ✅ 並び替えロジック
  const sorted = useMemo(() => {
    const list = [...manuals];
    list.sort((a, b) => {
      let comparison = 0;
      if (sortKey === "date") {
        const da = parseTime(a.updatedAt) ?? 0;
        const db = parseTime(b.updatedAt) ?? 0;
        comparison = da - db;
      } else {
        comparison = (a.title || "").localeCompare(b.title || "", "ja");
      }
      // 降順(desc)の場合は結果を反転させる
      return sortOrder === "desc" ? -comparison : comparison;
    });
    return list;
  }, [manuals, sortKey, sortOrder]);

  return (
    <div className="kbm">
      <div className="kbm-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span className="kbm-toolbar-label" style={{ fontSize: '13px', fontWeight: 700, color: '#64748b' }}>並び替え</span>
        <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '8px', gap: '4px' }}>
          <button
            type="button"
            onClick={() => handleSort("date")}
            style={{
              padding: '6px 12px', borderRadius: '6px', border: 'none', fontSize: '12px', cursor: 'pointer',
              background: sortKey === 'date' ? '#fff' : 'transparent',
              fontWeight: sortKey === 'date' ? 700 : 400,
              boxShadow: sortKey === 'date' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s'
            }}
          >
            日付順 {sortKey === "date" && (sortOrder === "desc" ? "↓" : "↑")}
          </button>
          <button
            type="button"
            onClick={() => handleSort("name")}
            style={{
              padding: '6px 12px', borderRadius: '6px', border: 'none', fontSize: '12px', cursor: 'pointer',
              background: sortKey === 'name' ? '#fff' : 'transparent',
              fontWeight: sortKey === 'name' ? 700 : 400,
              boxShadow: sortKey === 'name' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s'
            }}
          >
            名前順 {sortKey === "name" && (sortOrder === "desc" ? "↓" : "↑")}
          </button>
        </div>
      </div>

      <div className="kbm-list">
        {sorted.map((m) => {
          const type: "video" | "doc" =
            m.type ||
            ((m.embedUrl ?? "").includes("youtube") || (m.embedUrl ?? "").includes("youtu.be")
              ? "video"
              : "doc");

          const isVideo = type === "video";
          const previewRaw = (m.embedUrl ?? "").trim();
          const hasPreview = !!previewRaw;
          const embeddable = hasPreview ? toEmbeddableUrl(previewRaw, isVideo) : "";

          const dlDisabled = !!m.noDownload || !m.embedUrl;
          const downloadUrl = dlDisabled ? undefined : toDownloadUrl(previewRaw, isVideo);

          const updated = parseTime(m.updatedAt);
          const showNew = !!(updated && now - updated <= WINDOW);

          return (
            <article className="kbm-card" key={m.manualId}>
              <div className="kbm-card-grid">
                <div className="kbm-left" data-kind={type}>
                  <div className="kbm-badges">
                    <span className={`kbm-pill ${isVideo ? "kbm-pill-video" : "kbm-pill-doc"}`}>
                      <span className="kbm-pill-ico" aria-hidden="true">
                        {isVideo ? "🎬" : "📄"}
                      </span>
                      {isVideo ? "動画" : "資料"}
                    </span>
                    {showNew && <span className="kbm-pill kbm-pill-new">NEW</span>}
                  </div>

                  <div className="kbm-title">{m.title}</div>

                  <div
                    className="kbm-meta"
                    style={{
                      display: "flex",
                      gap: "12px",
                      fontSize: "11px",
                      color: "#94a3b8",
                      marginTop: "4px",
                    }}
                  >
                    {m.startDate && <span>公開日: {m.startDate.slice(0, 10)}</span>}
                    {m.updatedAt && <span>最終更新: {m.updatedAt.slice(0, 10)}</span>}
                  </div>

                  {m.desc && <div className="kbm-desc">{m.desc}</div>}
                </div>

                <div className="kbm-right" style={{ zIndex: 10, display: 'flex', gap: '8px' }}>
                  <button
                    className="kbm-btn kbm-btn-primary"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!hasPreview) return;
                      setModalTitle(m.title);
                      setRawUrl(previewRaw);
                      setModalUrl(embeddable);
                      setIsModalOpen(true);
                    }}
                    disabled={!hasPreview}
                  >
                    プレビュー
                  </button>

                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`kbm-btn ${dlDisabled ? "is-disabled" : ""}`}
                    style={{ textDecoration: "none" }}
                    onClick={(e) => {
                      if (dlDisabled) e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    DL
                  </a>

                  {m.externalUrl && (
                    <button
                      className="kbm-btn"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        safeOpen(m.externalUrl!);
                      }}
                    >
                      外部リンク
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {isModalOpen && (
        <div
          className="kbm-modal-backdrop"
          style={{
            display: "flex",
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15,23,42,0.55)",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div
            className="kbm-modal"
            style={{
              background: "#fff",
              width: "min(1100px, 96vw)",
              height: "min(78vh, 760px)",
              borderRadius: "18px",
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: "auto 1fr",
            }}
          >
            <div
              className="kbm-modal-head"
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid #eef2f7",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 800 }}>{modalTitle}</div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  style={{
                    cursor: "pointer",
                    padding: "0 12px",
                    borderRadius: "999px",
                    border: "1px solid #e5e7eb",
                    height: "34px",
                  }}
                  onClick={() => safeOpen(rawUrl || modalUrl)}
                >
                  新しいタブで開く
                </button>
                <button
                  style={{
                    cursor: "pointer",
                    width: "34px",
                    height: "34px",
                    borderRadius: "999px",
                    border: "1px solid #e5e7eb",
                  }}
                  onClick={closeModal}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="kbm-modal-body" style={{ background: "#000" }}>
              <iframe
                src={modalUrl}
                title={modalTitle}
                style={{ width: "100%", height: "100%", border: "none" }}
                referrerPolicy="no-referrer-when-downgrade"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}