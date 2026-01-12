"use client";

import { useEffect, useMemo, useState } from "react";
import type { Manual } from "@/types/manual";

type Props = { manuals: (Manual & { externalUrl?: string })[] };

function safeOpen(url: string) {
  if (!url) return;
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) window.location.href = url;
}

/**
 * 埋め込み用URL変換 (YouTube 接続拒否・X-Frame-Options 対策)
 */
function toEmbeddableUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u) return "";

  // 1. YouTube 対策 (最優先)
  // watch?v=ID, youtu.be/ID, embed/ID, shorts/ID すべてからID(11文字)を正確に抽出
  const ytMatch = u.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );

  if (ytMatch?.[1]) {
    // ⚠️ 接続拒否を防ぐため www.youtube-nocookie.com (プライバシー強化モード) を使用
    return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?rel=0&enablejsapi=1`;
  }

  // 2. Google Drive
  const driveMatch = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch?.[1]) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;

  // 3. Google Slides / Docs / Sheets
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
  const [sort, setSort] = useState<"new" | "old">("new");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalUrl, setModalUrl] = useState("");
  const [rawUrl, setRawUrl] = useState("");

  // ✅ react-hooks/purity 対策：Date.now() を render(map) 中で呼ばない
  //   （マウント時に 1回だけ固定の now を確保）
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
          // DBの値を優先。なければURL判定
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
          const dlReason = dlDisabled ? "このマニュアルはダウンロード不可です" : "";
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
                    {m.startDate && <span>公開日: {m.startDate}</span>}
                    {m.updatedAt && <span>最終更新: {m.updatedAt}</span>}
                  </div>

                  {m.desc && <div className="kbm-desc">{m.desc}</div>}

                  {/* もし使うなら tooltip 等に dlReason を使える（今は保持だけ） */}
                  {dlDisabled && dlReason ? null : null}
                </div>

                <div className="kbm-right" style={{ zIndex: 10 }}>
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
