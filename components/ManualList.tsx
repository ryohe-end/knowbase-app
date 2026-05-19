"use client";

import { useEffect, useMemo, useState } from "react";
import type { Manual } from "@/types/manual";
import { getManualThumbnail } from "@/lib/manualThumbnail";
import { highlightTokens } from "@/lib/highlight";

type Props = {
  manuals: (Manual & { externalUrl?: string })[];
  userId: string;
  /** categoryId → シリーズ名 のルックアップ。あればカードにシリーズタグを表示 */
  seriesNameMap?: Record<string, string>;
  /** 検索キーワード (生入力 + tokenize 後トークン) — ハイライト表示用 */
  searchTokens?: string[];
};

function safeOpen(url: string) {
  const u = (url || "").trim();
  if (!u) return;
  window.open(u, "_blank", "noopener,noreferrer");
}

/**
 * 埋め込み用URL変換 (YouTube, Canva, Google Drive, Google Docs/Slides)
 */
function toEmbeddableUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u) return "";

  // Canva
  if (u.includes("canva.com/design/")) {
    const canvaMatch = u.match(/design\/([A-Za-z0-9_-]+)/);
    if (canvaMatch?.[1]) return `https://www.canva.com/design/${canvaMatch[1]}/watch?embed`;
  }

  // YouTube
  const ytMatch = u.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (ytMatch?.[1]) return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?rel=0&enablejsapi=1`;

  // Google Drive file
  const driveMatch = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch?.[1]) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;

  // Google Docs/Sheets/Slides
  const docsMatch = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (docsMatch?.[1] && docsMatch?.[2]) {
    // presentation は embed が安定、doc/sheets は preview が安定
    const kind = docsMatch[1];
    if (kind === "presentation") {
      return `https://docs.google.com/presentation/d/${docsMatch[2]}/embed`;
    }
    return `https://docs.google.com/${kind}/d/${docsMatch[2]}/preview`;
  }

  return u;
}

function toDownloadUrl(url: string, isVideo: boolean) {
  const u = (url ?? "").trim();
  if (!u || isVideo) return u;

  // Slides → PDF
  const slideMatch = u.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
  if (slideMatch?.[1]) return `https://docs.google.com/presentation/d/${slideMatch[1]}/export/pdf`;

  // Drive file → download
  const driveMatch = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch?.[1]) return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;

  return u;
}

function parseTime(s?: string | null) {
  // ISO っぽい文字列だけを Date.parse する（JST整形文字列が来ても壊れないように）
  const v = (s || "").trim();
  if (!v) return null;

  // 例: 2026-01-20 / 2026-01-20T12:34:56Z など
  const looksISO = /^\d{4}-\d{2}-\d{2}/.test(v);
  if (!looksISO) return null;

  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function shortDateLabel(s?: string | null) {
  const v = (s || "").trim();
  if (!v) return "";
  // ISOなら YYYY-MM-DD を表示
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  // それ以外（JST整形済み等）はそのまま（長ければ先頭だけ）
  return v.length > 16 ? v.slice(0, 16) : v;
}

const DAY = 24 * 60 * 60 * 1000;
const NEW_WINDOW = 3 * DAY; // NEWは3日

// ✅ 追加: 閲覧数カウント用関数 (Fire-and-Forget)
const incrementReadCount = (manualId: string, userId: string) => {
  fetch("/api/manuals/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manualId, userId }),
    cache: "no-store",
  }).catch((err) => console.error("Read count error:", err));
};

export default function ManualList({ manuals, userId, seriesNameMap, searchTokens }: Props) {
  const tokens = searchTokens ?? [];
  const hi = (s: string) => (tokens.length > 0 ? highlightTokens(s, tokens) : s);

  /** タグ・ブランドなど「カード本体に表示されないフィールド」での検索ヒットを検出 */
  const findHiddenHits = (m: Manual & { brand?: string | null }): { label: string; value: string }[] => {
    if (tokens.length === 0) return [];
    const hits: { label: string; value: string }[] = [];
    const lower = (s: any) => (s ? String(s).toLowerCase() : "");
    const tags = Array.isArray(m.tags) ? m.tags : [];
    for (const t of tags) {
      if (tokens.some((tk) => lower(t).includes(tk))) {
        hits.push({ label: "タグ", value: t });
      }
    }
    if (m.brand && tokens.some((tk) => lower(m.brand).includes(tk))) {
      hits.push({ label: "ブランド", value: String(m.brand) });
    }
    return hits;
  };
  // ✅ ManualList は「受け取った順のまま表示」(page.tsx 側でソート/ページング済み前提)

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalUrl, setModalUrl] = useState("");
  const [rawUrl, setRawUrl] = useState("");

  const [now, setNow] = useState<number>(0);
  useEffect(() => setNow(Date.now()), []);

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

  // 表示用（map内で毎回計算しすぎないため）
  const view = useMemo(() => {
    return manuals.map((m) => {
      const type: "video" | "doc" =
        (m as any).type ||
        ((m.embedUrl ?? "").includes("youtube") || (m.embedUrl ?? "").includes("youtu.be") ? "video" : "doc");

      const isVideo = type === "video";
      const previewRaw = (m.embedUrl ?? "").trim();
      const hasPreview = !!previewRaw;
      const embeddable = hasPreview ? toEmbeddableUrl(previewRaw, isVideo) : "";

      const dlDisabled = !!m.noDownload || !m.embedUrl;
      const downloadUrl = dlDisabled ? undefined : toDownloadUrl(previewRaw, isVideo);

      const thumbnailUrl = getManualThumbnail(previewRaw);

      // NEW/UPDATE 判定（ISOが来た時だけ有効にする）
      const createdTime = parseTime((m as any).createdAt);
      const updatedTime = parseTime(m.updatedAt);

      const isUpdated = !!(createdTime && updatedTime && updatedTime - createdTime > 1000 * 60 * 60);
      const isNew = !!(createdTime && now && now - createdTime <= NEW_WINDOW);

      return {
        m,
        type,
        isVideo,
        hasPreview,
        previewRaw,
        embeddable,
        dlDisabled,
        downloadUrl,
        thumbnailUrl,
        isUpdated,
        isNew,
      };
    });
  }, [manuals, now]);

  return (
    <div className="kbm">
      {/* ✅ 並び替えUIはここから削除（page.tsx 側にあるため二重管理すると壊れる） */}

      <div className="kbm-list">
        {view.map(({ m, type, isVideo, hasPreview, previewRaw, embeddable, dlDisabled, downloadUrl, thumbnailUrl, isUpdated, isNew }) => {
          return (
            <article className="kbm-card" key={m.manualId}>
              <div className="kbm-card-grid" style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
                {/* サムネイル */}
                <div className="kbm-thumb-wrap" aria-hidden>
                  {thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="kbm-thumb"
                      onError={(e) => {
                        // 画像ロード失敗時は代替アイコン領域に置き換え
                        const el = e.currentTarget as HTMLImageElement;
                        el.style.display = "none";
                        const fallback = el.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div
                    className="kbm-thumb-fallback"
                    style={{ display: thumbnailUrl ? "none" : "flex" }}
                    data-kind={type}
                  >
                    <span className="kbm-thumb-icon">{isVideo ? "🎬" : "📄"}</span>
                  </div>
                </div>

                <div className="kbm-left" data-kind={type} style={{ flex: 1, minWidth: 0 }}>
                  <div className="kbm-badges" style={{ display: "flex", gap: "6px" }}>
                    <span className={`kbm-pill ${isVideo ? "kbm-pill-video" : "kbm-pill-doc"}`}>
                      <span className="kbm-pill-ico" aria-hidden="true">
                        {isVideo ? "🎬" : "📄"}
                      </span>
                      {isVideo ? "動画" : "資料"}
                    </span>

                    {/* 優先順位: UPDATE > NEW */}
                    {isUpdated ? (
                      <span className="kbm-pill" style={{ background: "#f59e0b", color: "#fff", fontWeight: 800 }}>
                        UPDATE
                      </span>
                    ) : isNew ? (
                      <span className="kbm-pill kbm-pill-new">NEW</span>
                    ) : null}
                  </div>

                  <div className="kbm-title">{hi(m.title)}</div>

                  {/* ✅ シリーズタグ (categoryId が紐付いていて、ルックアップに名前がある場合のみ表示) */}
                  {seriesNameMap && m.categoryId && seriesNameMap[m.categoryId] && (
                    <div style={{ marginTop: 6 }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "2px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 800,
                          background: "linear-gradient(135deg,#eff6ff,#dbeafe)",
                          color: "#1d4ed8",
                          border: "1px solid #bfdbfe",
                          letterSpacing: "0.02em",
                        }}
                      >
                        <span aria-hidden>📚</span>
                        {seriesNameMap[m.categoryId]}
                        {typeof m.seriesOrder === "number" && (
                          <span style={{ color: "#3b82f6", fontWeight: 700 }}>#{m.seriesOrder}</span>
                        )}
                      </span>
                    </div>
                  )}

                  <div
                    className="kbm-meta"
                    style={{
                      display: "flex",
                      gap: "12px",
                      fontSize: "11px",
                      color: "#94a3b8",
                      marginTop: "4px",
                      flexWrap: "wrap",
                    }}
                  >
                    {/* ✅ 追加: 部署名の表示 */}
                    {m.biz && <span style={{ fontWeight: 600, color: "#64748b" }}>{hi(m.biz)}</span>}

                    {m.startDate && <span>公開日: {shortDateLabel(m.startDate)}</span>}
                    {m.updatedAt && <span>最終更新: {shortDateLabel(m.updatedAt)}</span>}
                  </div>

                  {m.desc && <div className="kbm-desc">{hi(m.desc)}</div>}

                  {/* 検索ヒット指標 (タグ・ブランドなどカード本体に出ないフィールドでヒットした場合) */}
                  {(() => {
                    const hidden = findHiddenHits(m);
                    if (hidden.length === 0) return null;
                    return (
                      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {hidden.map((h, i) => (
                          <span key={i} style={{ fontSize: 10, color: "#0284c7", background: "#f0f9ff", padding: "1px 8px", borderRadius: 4, border: "1px solid #e0f2fe" }}>
                            <span style={{ fontWeight: 800 }}>[{h.label}]</span> {hi(h.value)}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="kbm-right" style={{ zIndex: 10, display: "flex", gap: "8px" }}>
                  <button
                    className="kbm-btn kbm-btn-primary"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!hasPreview) return;
                      
                      // ✅ ここでカウントアップAPIを呼ぶ
                      incrementReadCount(m.manualId, userId);

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

                  {(m as any).externalUrl && (
                    <button
                      className="kbm-btn"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        safeOpen((m as any).externalUrl);
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