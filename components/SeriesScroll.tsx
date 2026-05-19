"use client";

import { useEffect, useState } from "react";
import type { Manual } from "@/types/manual";
import { getManualThumbnail, pickSeriesThumbnail } from "@/lib/manualThumbnail";
import { highlightTokens } from "@/lib/highlight";

/* ========= URL ヘルパ (ManualList と同じロジック) ========= */
function safeOpen(url: string) {
  const u = (url || "").trim();
  if (!u) return;
  window.open(u, "_blank", "noopener,noreferrer");
}

function toEmbeddableUrl(url: string, _isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (u.includes("canva.com/design/")) {
    const m = u.match(/design\/([A-Za-z0-9_-]+)/);
    if (m?.[1]) return `https://www.canva.com/design/${m[1]}/watch?embed`;
  }
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt?.[1]) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&enablejsapi=1`;
  const drive = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (drive?.[1]) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  const docs = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (docs?.[1] && docs?.[2]) {
    if (docs[1] === "presentation") return `https://docs.google.com/presentation/d/${docs[2]}/embed`;
    return `https://docs.google.com/${docs[1]}/d/${docs[2]}/preview`;
  }
  return u;
}

function toDownloadUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u || isVideo) return u;
  const slide = u.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
  if (slide?.[1]) return `https://docs.google.com/presentation/d/${slide[1]}/export/pdf`;
  const drive = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (drive?.[1]) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  return u;
}

const incrementReadCount = (manualId: string, userId: string) => {
  fetch("/api/manuals/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manualId, userId }),
    cache: "no-store",
  }).catch(() => {});
};

type Props = {
  seriesName: string;
  manuals: (Manual & { externalUrl?: string })[];
  userId: string;
  defaultExpanded?: boolean;
  description?: string | null;
  biz?: string | null;
  publishedAt?: string | null;
  thumbnailUrl?: string | null;
  /** 検索キーワード — ハイライト用 */
  searchTokens?: string[];
};

function shortDateLabel(s?: string | null) {
  const v = (s || "").trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return v.length > 16 ? v.slice(0, 16) : v;
}

export default function SeriesScroll({ seriesName, manuals, userId, defaultExpanded = false, description, biz, publishedAt, thumbnailUrl, searchTokens }: Props) {
  const tokens = searchTokens ?? [];
  const hi = (s: string) => (tokens.length > 0 ? highlightTokens(s, tokens) : s);
  // 自動サムネイル: 明示指定が無ければ 1 本目のマニュアルから取得
  const headerThumb = thumbnailUrl || pickSeriesThumbnail(manuals);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalUrl, setModalUrl] = useState("");
  const [rawUrl, setRawUrl] = useState("");

  const closeModal = () => {
    setModalOpen(false);
    setModalTitle("");
    setModalUrl("");
    setRawUrl("");
  };

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const openManual = (m: Manual) => {
    const previewRaw = (m.embedUrl ?? "").trim();
    if (!previewRaw) return;
    const isVideo =
      (m as any).type === "video" || previewRaw.includes("youtube") || previewRaw.includes("youtu.be");
    incrementReadCount(m.manualId, userId);
    setModalTitle(m.title);
    setRawUrl(previewRaw);
    setModalUrl(toEmbeddableUrl(previewRaw, isVideo));
    setModalOpen(true);
  };

  const hasMeta = !!(description || biz || publishedAt);

  return (
    <article className="kb-ss-card">
      <button
        type="button"
        className={"kb-ss-head" + (expanded ? " open" : "") + (headerThumb ? " with-thumb" : "")}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {headerThumb && (
          <span className="kb-ss-thumb" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={headerThumb}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </span>
        )}
        <span className="kb-ss-chev" aria-hidden>
          {expanded ? "▼" : "▶"}
        </span>
        <span className="kb-ss-head-text">
          <span className="kb-ss-head-row">
            <span className="kb-ss-badge">📚 シリーズ</span>
            <span className="kb-ss-name">{hi(seriesName)}</span>
            <span className="kb-ss-count">{manuals.length} 本</span>
          </span>
          {hasMeta && (
            <span className="kb-ss-meta-row">
              {biz && <span className="kb-ss-meta-biz">🏢 {hi(biz)}</span>}
              {publishedAt && <span className="kb-ss-meta-date">配信: {shortDateLabel(publishedAt)}</span>}
              {description && <span className="kb-ss-meta-desc">{hi(description)}</span>}
            </span>
          )}
        </span>
        {!expanded && <span className="kb-ss-hint">クリックで展開</span>}
      </button>

      {expanded && (
        <div className="kb-ss-scroll-wrap">
          <div className="kb-ss-scroll" role="list">
            {manuals.map((m, idx) => {
              const type: "video" | "doc" =
                (m as any).type ||
                ((m.embedUrl ?? "").includes("youtube") || (m.embedUrl ?? "").includes("youtu.be")
                  ? "video"
                  : "doc");
              const isVideo = type === "video";
              const previewRaw = (m.embedUrl ?? "").trim();
              const hasPreview = !!previewRaw;
              const dlDisabled = !!m.noDownload || !m.embedUrl;
              const downloadUrl = dlDisabled ? undefined : toDownloadUrl(previewRaw, isVideo);
              const tileThumb = getManualThumbnail(previewRaw);

              return (
                <div className="kb-ss-tile" key={m.manualId} role="listitem">
                  <div className="kb-ss-tile-thumb" data-kind={type}>
                    {tileThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tileThumb}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          const el = e.currentTarget as HTMLImageElement;
                          el.style.display = "none";
                          const fallback = el.nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = "flex";
                        }}
                      />
                    ) : null}
                    <span
                      className="kb-ss-tile-thumb-fallback"
                      style={{ display: tileThumb ? "none" : "flex" }}
                    >
                      {isVideo ? "🎬" : "📄"}
                    </span>
                    <span className="kb-ss-tile-order-badge">#{idx + 1}</span>
                  </div>
                  <div className="kb-ss-tile-top">
                    <span className={`kb-ss-pill ${isVideo ? "video" : "doc"}`}>
                      {isVideo ? "🎬" : "📄"} {isVideo ? "動画" : "資料"}
                    </span>
                  </div>
                  <div className="kb-ss-tile-title" title={m.title}>
                    {hi(m.title)}
                  </div>
                  <div className="kb-ss-tile-actions">
                    <button
                      type="button"
                      className="kb-ss-btn primary"
                      disabled={!hasPreview}
                      onClick={(e) => {
                        e.stopPropagation();
                        openManual(m);
                      }}
                    >
                      プレビュー
                    </button>
                    <a
                      href={downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`kb-ss-btn ${dlDisabled ? "is-disabled" : ""}`}
                      onClick={(e) => {
                        if (dlDisabled) e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      DL
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          className="kb-ss-modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div className="kb-ss-modal">
            <div className="kb-ss-modal-head">
              <div style={{ fontWeight: 800 }}>{modalTitle}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="kb-ss-modal-btn" onClick={() => safeOpen(rawUrl || modalUrl)}>
                  新しいタブで開く
                </button>
                <button className="kb-ss-modal-btn round" onClick={closeModal}>
                  ✕
                </button>
              </div>
            </div>
            <div className="kb-ss-modal-body">
              <iframe
                src={modalUrl}
                title={modalTitle}
                referrerPolicy="no-referrer-when-downgrade"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
