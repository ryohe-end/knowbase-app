"use client";

import { useEffect, useMemo, useState } from "react";

type Manual = {
  manualId: string;
  title: string;
  desc?: string;
  type?: "video" | "doc";

  // ✅ 日付（運用ルール）
  // - startDate: 公開日（入力）
  // - createdAt: 追加日時（サーバで初回のみ）
  // - updatedAt: 更新日時（サーバで更新のたびに now 上書き）
  startDate?: string; // 公開日
  createdAt?: string; // 追加日時
  updatedAt?: string; // 更新日時

  // 既存の互換（残してOK）
  publishedAt?: string; // もし古いデータがまだあるなら fallback に使う
  isNew?: boolean; // 使わない（自動判定に統一）

  brand?: string;
  biz?: string;
  tags?: string[];

  // URL
  previewUrl?: string; // 新
  embedUrl?: string; // 旧
  downloadUrl?: string;
  noDownload?: boolean; // 旧
};

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

const DAY = 24 * 60 * 60 * 1000;
const WINDOW = 30 * DAY;

function parseTime(s?: string) {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
}

function fmtYMD(ms?: number | null) {
  if (!ms) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function ManualList({ manuals }: Props) {
  const [sort, setSort] = useState<"new" | "old">("new");

  // --- Modal state ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalUrl, setModalUrl] = useState(""); // embeddable url
  const [rawUrl, setRawUrl] = useState(""); // original url (open in new tab)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen]);

  // ✅ 並び替えは「更新日優先 → 追加日 → 公開日」の順で安全に
  const sorted = useMemo(() => {
    const list = [...manuals];
    list.sort((a, b) => {
      const aUpdated = parseTime(a.updatedAt);
      const bUpdated = parseTime(b.updatedAt);

      const aCreated = parseTime(a.createdAt);
      const bCreated = parseTime(b.createdAt);

      const aPub = parseTime(a.startDate ?? a.publishedAt);
      const bPub = parseTime(b.startDate ?? b.publishedAt);

      const aKey = aUpdated ?? aCreated ?? aPub ?? 0;
      const bKey = bUpdated ?? bCreated ?? bPub ?? 0;

      return sort === "new" ? bKey - aKey : aKey - bKey;
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
          const type = m.type ?? "doc";

          const previewRaw = (m.previewUrl ?? m.embedUrl ?? "").trim();
          const hasPreview = !!previewRaw;
          const embeddable = hasPreview ? toEmbeddableUrl(previewRaw) : "";

          const dlDisabled = !!m.noDownload || !m.downloadUrl;
          const dlReason = dlDisabled ? "このマニュアルはダウンロード不可です（閲覧のみ）" : "";

          // ✅ NEW/更新（30日表示）
          const now = Date.now();
          const created = parseTime(m.createdAt);
          const updated = parseTime(m.updatedAt);

          // 公開日（表示用）: startDate優先、なければ publishedAt を救済
          const published = parseTime(m.startDate ?? m.publishedAt);

          // NEW: 追加から30日（createdAt基準）
          const showNew = !!(created && now - created <= WINDOW);

          // 更新: 更新から30日（updatedAt基準）
          // ただし作成直後（1分以内）の updatedAt は「更新」とみなさない
          const updatedEnough = !!(updated && created && updated - created > 60 * 1000);
          const showUpdated = !showNew && !!(updated && now - updated <= WINDOW && updatedEnough);

          const publishedLabel = fmtYMD(published);
          const updatedLabel = fmtYMD(updated);

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

                    {/* ✅ NEW優先、次に更新 */}
                    {showNew && <span className="kbm-pill kbm-pill-new">NEW</span>}
                    {showUpdated && <span className="kbm-pill kbm-pill-updated">更新</span>}
                  </div>
                   



                  <div className="kbm-title">{m.title}</div>
                  {m.desc && <div className="kbm-desc">{m.desc}</div>}
{/* このブロックは削除 */}
<div className="kbm-meta">
  {(m.brand ?? "")}
  {m.biz ? ` / ${m.biz}` : ""}
  {publishedLabel ? ` / 公開: ${publishedLabel}` : ""}
  {showUpdated && updatedLabel ? ` / 更新: ${updatedLabel}` : ""}
</div>
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
                    title={!hasPreview ? "プレビューURLがありません（previewUrl / embedUrl を確認）" : "プレビュー"}
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
                      safeOpen(m.downloadUrl!);
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

      {/* ===== Modal ===== */}
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
