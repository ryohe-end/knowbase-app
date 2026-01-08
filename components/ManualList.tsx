"use client";

import { useEffect, useMemo, useState } from "react";
import type { Manual } from "@/types/manual";

type Props = { manuals: (Manual & { externalUrl?: string })[] };

/**
 * ダウンロード用のURL変換関数
 * 403エラー対策として、スライドなどはプレビューURLをベースにダウンロードを促します
 */
function toDownloadUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u || isVideo) return u; // 動画の場合は変換しない

  // GoogleスライドのURL
  const slideMatch = u.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
  if (slideMatch?.[1]) {
    // 403が出にくいexport用パラメータ
    return `https://docs.google.com/presentation/d/${slideMatch[1]}/export/pdf`;
  }

  // Googleドライブの直リンク
  const driveMatch = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }

  return u;
}

function safeOpen(url: string) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function toEmbeddableUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u) return "";
  const m1 = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m1?.[1]) return `https://drive.google.com/file/d/${m1[1]}/preview`;
  const docs = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (docs?.[1] && docs?.[2]) {
    const suffix = isVideo ? "embed" : "preview";
    return `https://docs.google.com/${docs[1]}/d/${docs[2]}/${suffix}`;
  }
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
      {/* ツールバー部分は省略せず維持してください */}
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
          const type: "video" | "doc" = m.type || (
            (m.embedUrl ?? "").includes("youtube") ||
            (m.embedUrl ?? "").includes("youtu.be")
              ? "video"
              : "doc"
          );

          const isVideo = type === "video";
          const previewRaw = (m.embedUrl ?? "").trim();
          const hasPreview = !!previewRaw;
          const embeddable = hasPreview ? toEmbeddableUrl(previewRaw, isVideo) : "";

          const dlDisabled = !!m.noDownload || !m.embedUrl;
          const dlReason = dlDisabled ? "このマニュアルはダウンロード不可です" : "";
          
          // ダウンロード用のURLを取得
          const downloadUrl = toDownloadUrl(previewRaw, isVideo);

          const now = Date.now();
          const updated = parseTime(m.updatedAt);
          const showNew = !!(updated && now - updated <= WINDOW);

          return (
            <article className="kbm-card" key={m.manualId}>
              <div className="kbm-card-grid">
                <div className="kbm-left" data-kind={type}>
                  <div className="kbm-badges">
                    <span className={`kbm-pill ${isVideo ? "kbm-pill-video" : "kbm-pill-doc"}`}>
                      <span className="kbm-pill-ico" aria-hidden="true">{isVideo ? "🎬" : "📄"}</span>
                      {isVideo ? "動画" : "資料"}
                    </span>
                    {showNew && <span className="kbm-pill kbm-pill-new">NEW</span>}
                  </div>
                  <div className="kbm-title">{m.title}</div>
                  <div className="kbm-meta" style={{ display: "flex", gap: "12px", fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
                    {m.startDate && <span>公開日: {m.startDate}</span>}
                    {m.updatedAt && <span>最終更新: {m.updatedAt}</span>}
                  </div>
                  {m.desc && <div className="kbm-desc">{m.desc}</div>}
                </div>

                <div className="kbm-right">
                  <button
                    className="kbm-btn kbm-btn-primary"
                    type="button"
                    onClick={() => {
                      if (!hasPreview) return;
                      setModalTitle(m.title);
                      setRawUrl(previewRaw);
                      setModalUrl(embeddable || previewRaw);
                      setIsModalOpen(true);
                    }}
                    disabled={!hasPreview}
                  >
                    プレビュー
                  </button>

                  <a
                    href={dlDisabled ? undefined : downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    // 資料の場合のみdownload属性を付与
                    download={!isVideo}
                    className={`kbm-btn ${dlDisabled ? "is-disabled" : ""}`}
                    style={{ textDecoration: 'none' }}
                    onClick={(e) => {
                      if (dlDisabled) e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    DL
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* モーダル表示は維持 */}
      {isModalOpen && (
        <div className="kbm-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="kbm-modal">
            <div className="kbm-modal-head">
              <div className="kbm-modal-title">{modalTitle}</div>
              <div className="kbm-modal-actions">
                <button className="kbm-modal-link" onClick={() => safeOpen(rawUrl || modalUrl)}>
                  新しいタブで開く
                </button>
                <button className="kbm-modal-close" onClick={closeModal}>✕</button>
              </div>
            </div>
            <div className="kbm-modal-body">
              <iframe
                className="kbm-modal-iframe"
                src={modalUrl}
                title={modalTitle}
                referrerPolicy="no-referrer"
                allow="autoplay; encrypted-media; fullscreen"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}