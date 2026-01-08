"use client";

import { useEffect, useMemo, useState } from "react";
import type { Manual } from "@/types/manual";

type Props = { manuals: (Manual & { externalUrl?: string })[] };

function safeOpen(url: string) {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) window.location.href = url;
}

/**
 * URLを埋め込み可能な形式に変換する
 * カテゴリが「動画」の場合は再生用のURL(embed)を優先する
 */
function toEmbeddableUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u) return "";

  // Google Drive
  const m1 = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m1?.[1]) return `https://drive.google.com/file/d/${m1[1]}/preview`;

  // Google Slides / Docs / Sheets
  const docs = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (docs?.[1] && docs?.[2]) {
    // ✅ 動画タイプなら /embed (再生モード)、資料なら /preview (閲覧モード)
    const suffix = isVideo ? "embed" : "preview";
    return `https://docs.google.com/${docs[1]}/d/${docs[2]}/${suffix}`;
  }

  // YouTube
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
  if (yt?.[1]) return `https://www.youtube.com/embed/${yt[1]}`;

  return u;
}

function parseTime(s?: string | null) {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
}

const DAY = 24 * 60 * 60 * 1000;
const WINDOW = 30 * DAY;

export default function ManualList({ manuals }: Props) {
  const [sort, setSort] = useState<"new" | "old">("new");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalUrl, setModalUrl] = useState("");
  const [rawUrl, setRawUrl] = useState("");
  const [iframeError, setIframeError] = useState(false);

  const closeModal = () => {
    setIsModalOpen(false);
    setModalTitle("");
    setModalUrl("");
    setRawUrl("");
    setIframeError(false);
  };

  useEffect(() => {
    if (!isModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isModalOpen]);

  const sorted = useMemo(() => {
    const list = [...manuals];
    list.sort((a, b) => {
      const da = parseTime(a.updatedAt) ?? 0;
      const db = parseTime(b.updatedAt) ?? 0;
      return sort === "new" ? db - da : da - db;
    });
    return list;
  }, [manuals, sort]);

  return (
    <div className="kbm">
      <div className="kbm-toolbar">
        <span className="kbm-toolbar-label">並び替え</span>
        <select
          className="kbm-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as "new" | "old")}
        >
          <option value="new">更新日順（新しい）</option>
          <option value="old">更新日順（古い）</option>
        </select>
      </div>

      <div className="kbm-list">
        {sorted.map((m) => {
          // DBの値を優先。なければURLから判定
          const typeFromDb = m.type;
          const type: "video" | "doc" = typeFromDb || (
            (m.embedUrl ?? "").includes("youtube") ||
            (m.embedUrl ?? "").includes("youtu.be")
              ? "video"
              : "doc"
          );

          const isVideo = type === "video";
          const previewRaw = (m.embedUrl ?? "").trim();
          const hasPreview = !!previewRaw;
          
          // ✅ 動画タイプ情報を渡して、再生用URLを生成
          const embeddable = hasPreview ? toEmbeddableUrl(previewRaw, isVideo) : "";

          const dlDisabled = !!m.noDownload || !m.embedUrl;
          const dlReason = dlDisabled
            ? "このマニュアルはダウンロード不可です（閲覧のみ）"
            : "";

          const now = Date.now();
          const updated = parseTime(m.updatedAt);
          const showNew = !!(updated && now - updated <= WINDOW);

          return (
            <article className="kbm-card" key={m.manualId}>
              <div className="kbm-card-grid">
                {/* ✅ data-kind={type} によってCSS側で不要なアイコンが出ている可能性があるため、必要に応じてCSS側も確認してください */}
                <div className="kbm-left" data-kind={type}>
                  <div className="kbm-badges">
                    <span
                      className={`kbm-pill ${
                        isVideo ? "kbm-pill-video" : "kbm-pill-doc"
                      }`}
                      title={isVideo ? "動画マニュアル" : "資料マニュアル"}
                    >
                      {/* ✅ アイコン（🎬/📄）は残しました */}
                      <span className="kbm-pill-ico" aria-hidden="true">
                        {isVideo ? "🎬" : "📄"}
                      </span>
                      {isVideo ? "動画" : "資料"}
                    </span>

                    {showNew && (
                      <span className="kbm-pill kbm-pill-new">NEW</span>
                    )}
                  </div>

                  <div className="kbm-title">{m.title}</div>

                  <div className="kbm-meta" style={{ display: "flex", gap: "12px", fontSize: "11px", color: "#94a3b8", marginTop: "4px", marginBottom: "4px" }}>
                    {m.startDate && <span>公開日: {m.startDate}</span>}
                    {m.updatedAt && <span>最終更新: {m.updatedAt}</span>}
                  </div>

                  {m.desc && <div className="kbm-desc">{m.desc}</div>}

                  {m.tags?.length ? (
                    <div className="kbm-tags">
                      {m.tags.map((t) => (
                        <span key={t} className="kbm-tag">#{t}</span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="kbm-right" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button
                    className="kbm-btn kbm-btn-primary"
                    type="button"
                    onClick={() => {
                      if (!hasPreview) return;
                      setModalTitle(m.title);
                      setRawUrl(previewRaw);
                      setModalUrl(embeddable || previewRaw);
                      setIframeError(false);
                      setIsModalOpen(true);
                    }}
                    disabled={!hasPreview}
                  >
                    プレビュー
                  </button>

                  {m.externalUrl && (
                    <a
                      href={m.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="kbm-btn"
                      style={{ 
                        background: "#f8fafc", 
                        color: "#475569", 
                        border: "1px solid #cbd5e1",
                        textDecoration: "none",
                        textAlign: "center",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}
                    >
                      外部リンク 
                    </a>
                  )}

                  <button
                    className={`kbm-btn ${dlDisabled ? "is-disabled" : ""}`}
                    type="button"
                    aria-disabled={dlDisabled}
                    data-tooltip={dlDisabled ? dlReason : ""}
                    onClick={(e) => {
                      if (dlDisabled) {
                        e.preventDefault();
                        return;
                      }
                      safeOpen(previewRaw);
                    }}
                  >
                    DL
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {isModalOpen && (
        <div
          className="kbm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="kbm-modal">
            <div className="kbm-modal-head">
              <div className="kbm-modal-title">{modalTitle}</div>
              <div className="kbm-modal-actions">
                <button
                  className="kbm-modal-link"
                  type="button"
                  onClick={() => safeOpen(rawUrl || modalUrl)}
                >
                  新しいタブで開く
                </button>
                <button
                  className="kbm-modal-close"
                  type="button"
                  onClick={closeModal}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="kbm-modal-body">
              {iframeError ? (
                <div className="kbm-modal-fallback">
                  <div className="kbm-modal-fallback-title">
                    このURLは埋め込み表示がブロックされています。
                  </div>
                  <button
                    className="kbm-btn kbm-btn-primary"
                    type="button"
                    onClick={() => safeOpen(rawUrl || modalUrl)}
                  >
                    新しいタブで開く
                  </button>
                </div>
              ) : (
                <iframe
                  className="kbm-modal-iframe"
                  src={modalUrl}
                  title={modalTitle}
                  referrerPolicy="no-referrer"
                  allow="autoplay; encrypted-media; fullscreen"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}