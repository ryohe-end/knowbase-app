"use client";

import { useEffect, useMemo, useState } from "react";
import type { Manual } from "@/types/manual"; // ←あなたの型がある場所に合わせて

type Props = { manuals: Manual[] };

function safeOpen(url: string) {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) window.location.href = url;
}

function toEmbeddableUrl(url: string) {
  const u = (url ?? "").trim();
  if (!u) return "";

  const m1 = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m1?.[1]) return `https://drive.google.com/file/d/${m1[1]}/preview`;

  const m2 = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m2?.[1]) return `https://drive.google.com/file/d/${m2[1]}/preview`;

  const docs = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (docs?.[1] && docs?.[2]) return `https://docs.google.com/${docs[1]}/d/${docs[2]}/preview`;

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

  // --- Modal state ---
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

  // ✅ updatedAt を並び替えに使う（無ければ末尾扱い）
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
        <select className="kbm-select" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="new">更新日順（新しい）</option>
          <option value="old">更新日順（古い）</option>
        </select>
      </div>

      <div className="kbm-list">
        {sorted.map((m) => {
          // ※ type は型に無いので embedUrlの種類で雑に推定（必要なら型に type を追加推奨）
          const type: "video" | "doc" =
            (m.embedUrl ?? "").includes("youtube") || (m.embedUrl ?? "").includes("youtu.be") ? "video" : "doc";

          const previewRaw = (m.embedUrl ?? "").trim();
          const hasPreview = !!previewRaw;
          const embeddable = hasPreview ? toEmbeddableUrl(previewRaw) : "";

          const dlDisabled = !!m.noDownload || !m.embedUrl; // downloadUrlが型に無いので一旦 embedUrl と同じ扱いにしない
          // ↑ ここは本当は downloadUrl を型に追加して使うのが正解（今後直そう）
          const dlReason = dlDisabled ? "このマニュアルはダウンロード不可です（閲覧のみ）" : "";

          // ✅ NEW/更新（30日表示）
          const now = Date.now();
          const updated = parseTime(m.updatedAt);
          const showNew = !!m.isNew; // isNew を採用（サーバ側で30日制御するのがベスト）

          // 「更新」: updatedAt が30日以内 && NEWじゃない
          const showUpdated = !showNew && !!(updated && now - updated <= WINDOW);

          return (
            <article className="kbm-card" key={m.manualId}>
              <div className="kbm-card-grid">
                <div className="kbm-left" data-kind={type}>
                  <div className="kbm-badges">
                    <span
                      className={`kbm-pill ${type === "video" ? "kbm-pill-video" : "kbm-pill-doc"}`}
                      title={type === "video" ? "動画マニュアル" : "資料マニュアル"}
                    >
                      <span className="kbm-pill-ico" aria-hidden="true">
                        {type === "video" ? "🎬" : "📄"}
                      </span>
                      {type === "video" ? "動画" : "資料"}
                    </span>

                    {showNew && <span className="kbm-pill kbm-pill-new">NEW</span>}
                    {showUpdated && <span className="kbm-pill kbm-pill-updated">更新</span>}
                  </div>

                  <div className="kbm-title">{m.title}</div>
                  {m.desc ? <div className="kbm-desc">{m.desc}</div> : null}

                  {m.tags?.length ? (
                    <div className="kbm-tags">
                      {m.tags.map((t) => (
                        <span key={t} className="kbm-tag">
                          #{t}
                        </span>
                      ))}
                    </div>
                  ) : null}
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
                      setIframeError(false);
                      setIsModalOpen(true);
                    }}
                    disabled={!hasPreview}
                    title={!hasPreview ? "プレビューURLがありません（embedUrl を確認）" : "プレビュー"}
                  >
                    プレビュー
                  </button>

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
                <button className="kbm-modal-link" type="button" onClick={() => safeOpen(rawUrl || modalUrl)}>
                  新しいタブで開く
                </button>
                <button className="kbm-modal-close" type="button" onClick={closeModal} aria-label="閉じる">
                  ✕
                </button>
              </div>
            </div>

            <div className="kbm-modal-body">
              {iframeError ? (
                <div className="kbm-modal-fallback">
                  <div className="kbm-modal-fallback-title">このURLは埋め込み表示がブロックされています。</div>
                  <div className="kbm-modal-fallback-desc">「新しいタブで開く」から閲覧してください。</div>
                  <button className="kbm-btn kbm-btn-primary" type="button" onClick={() => safeOpen(rawUrl || modalUrl)}>
                    新しいタブで開く
                  </button>
                </div>
              ) : (
                <iframe
                  className="kbm-modal-iframe"
                  src={modalUrl}
                  title={modalTitle}
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  referrerPolicy="no-referrer"
                  onError={() => setIframeError(true)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
