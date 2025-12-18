"use client";

import { useEffect, useMemo, useState } from "react";

type ManualType = "doc" | "video";

type Manual = {
  manualId: string;
  title: string;
  brandId?: string;
  brand?: string;
  bizId?: string;
  biz?: string;
  desc?: string | null;
  updatedAt?: string; // "YYYY-MM-DD"
  startDate?: string; // 公開開始 "YYYY-MM-DD"
  endDate?: string; // 公開終了 "YYYY-MM-DD"
  type?: ManualType; // "doc" | "video"
  tags?: string[];
  embedUrl?: string;
  isNew?: boolean;
  noDownload?: boolean;
};

type Brand = {
  brandId: string;
  name: string;
};

type Dept = {
  deptId: string;
  name: string;
};

type SortKey = "updatedDesc" | "titleAsc" | "startDesc";

type ManualListProps = {
  manuals: Manual[];

  // ✅ ここを optional に（親が渡さなくても落ちない）
  brandMap?: Record<string, Brand>;
  deptMap?: Record<string, Dept>;

  onPreview: (m: Manual) => void;
  pageSize?: number;
};

/* --- ヘルパー関数 --- */

function parseYmd(ymd?: string): number | null {
  if (!ymd) return null;
  const t = Date.parse(ymd.slice(0, 10) + "T00:00:00");
  return Number.isFinite(t) ? t : null;
}

function withinDays(dateYmd?: string, days = 30): boolean {
  const t = parseYmd(dateYmd);
  if (t == null) return false;
  const now = Date.now();
  const diff = now - t;
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function isExpired(endDate?: string): boolean {
  const t = parseYmd(endDate);
  if (t == null) return false;
  return Date.now() > t + 24 * 60 * 60 * 1000 - 1;
}

/**
 * 修正版：ファイル形式を維持したダウンロードURL生成
 */
function getDownloadUrl(url?: string) {
  if (!url) return "#";

  // Google Slides の場合のみPDFエクスポート
  if (url.includes("docs.google.com/presentation/d/")) {
    return url.replace(/\/edit.*|\/embed.*|\/pub.*/, "/export/pdf");
  }

  // Google Drive の汎用ファイル（動画含む）の場合
  const driveMatch = url.match(/\/file\/d\/([\w-]+)/);
  if (driveMatch) {
    // uc?export=download を使うことで、元のファイル形式のままDLされる
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }

  return url;
}

function typeLabel(type?: ManualType) {
  if (type === "video") return { icon: "🎬", text: "動画" };
  return { icon: "📄", text: "資料" };
}

export default function ManualList({
  manuals,
  brandMap,
  deptMap,
  onPreview,
  pageSize = 5,
}: ManualListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedDesc");
  const [page, setPage] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // 並び替え変更時は1ページ目へ
  useEffect(() => {
    setPage(1);
  }, [sortKey]);

  const sortedManuals = useMemo(() => {
    const list = [...(manuals || [])];
    const getUpdated = (m: Manual) => parseYmd(m.updatedAt) ?? -1;
    const getStart = (m: Manual) => parseYmd(m.startDate) ?? -1;

    list.sort((a, b) => {
      if (sortKey === "titleAsc") return (a.title || "").localeCompare(b.title || "", "ja");
      if (sortKey === "startDesc") {
        const diff = getStart(b) - getStart(a);
        return diff !== 0 ? diff : getUpdated(b) - getUpdated(a);
      }
      const diff = getUpdated(b) - getUpdated(a);
      if (diff !== 0) return diff;
      const startDiff = getStart(b) - getStart(a);
      return startDiff !== 0 ? startDiff : (a.title || "").localeCompare(b.title || "", "ja");
    });
    return list;
  }, [manuals, sortKey]);

  const { currentManuals, totalPages, safePage } = useMemo(() => {
    const total = Math.max(1, Math.ceil((sortedManuals.length || 0) / pageSize));
    const sp = Math.min(Math.max(1, page), total);
    const start = (sp - 1) * pageSize;
    const slice = sortedManuals.slice(start, start + pageSize);
    return { currentManuals: slice, totalPages: total, safePage: sp };
  }, [sortedManuals, page, pageSize]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [safePage, page]);

  const handlePrev = () => setPage((p) => Math.max(1, p - 1));
  const handleNext = () => setPage((p) => Math.min(totalPages, p + 1));

  const handleDownloadClick = (m: Manual, e: React.MouseEvent) => {
    if (m.noDownload) {
      e.preventDefault();
      alert("この資料はダウンロード禁止に設定されています。プレビュー画面からご確認ください。");
      return;
    }
    if (!m.embedUrl || m.embedUrl === "#") {
      e.preventDefault();
      alert("ダウンロード可能なURLが設定されていません。");
      return;
    }

    setDownloadingId(m.manualId);
    setTimeout(() => {
      setDownloadingId(null);
    }, 3000);
  };

  return (
    <div>
      {/* 並び替えセレクトボックス */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span className="kb-subnote" style={{ fontSize: "12px", color: "#6b7280" }}>
          並び替え
        </span>
        <select
          className="kb-admin-select"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          style={{
            maxWidth: 220,
            padding: "4px 8px",
            borderRadius: "6px",
            border: "1px solid #d1d5db",
            fontSize: "13px",
          }}
        >
          <option value="updatedDesc">更新日順（新しい）</option>
          <option value="titleAsc">タイトル順（A→Z）</option>
          <option value="startDesc">公開日順（新しい）</option>
        </select>
      </div>

      {/* マニュアルリスト */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {currentManuals.map((m) => {
          // ✅ ここが修正ポイント：brandMap/deptMap が undefined でも落ちない
          const brandLabel =
            (m.brandId &&
              (brandMap?.[m.brandId]?.name ||
                (m.brandId === "ALL" ? "全社" : ""))) ||
            m.brand ||
            "ブランド未設定";

          const deptLabel =
            (m.bizId && (deptMap?.[m.bizId]?.name || "")) ||
            m.biz ||
            "部署未設定";

          const isNewByStart = withinDays(m.startDate, 30);
          const isUpdatedByUpdatedAt = withinDays(m.updatedAt, 30);
          const t = typeLabel(m.type);
          const expired = isExpired(m.endDate);
          const dlDisabled = !m.embedUrl || m.noDownload;
          const isProcessing = downloadingId === m.manualId;

          return (
            <div
              key={m.manualId}
              className="kb-manual-item"
              style={{
                opacity: expired ? 0.55 : 1,
                filter: expired ? "grayscale(0.2)" : "none",
                display: "flex",
                justifyContent: "space-between",
                padding: "16px",
                background: "#fff",
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div className="kb-manual-main" style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span className="kb-badge-type">
                    {t.icon} {t.text}
                  </span>
                  {isNewByStart ? (
                    <span className="kb-badge-new">NEW</span>
                  ) : isUpdatedByUpdatedAt ? (
                    <span className="kb-badge-updated">更新</span>
                  ) : null}
                </div>

                <div
                  className="kb-manual-title"
                  style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px", color: "#1f2937" }}
                >
                  {m.title}
                </div>

                {m.desc && (
                  <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
                    {m.desc}
                  </div>
                )}

                <div className="kb-manual-meta" style={{ fontSize: "12px", color: "#9ca3af" }}>
                  {brandLabel} / {deptLabel}
                  {m.startDate && ` / 公開: ${m.startDate}`}
                  {m.updatedAt && ` / 更新: ${m.updatedAt}`}
                </div>

                {m.tags && m.tags.length > 0 && (
                  <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                    {m.tags.map((tag, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: "11px",
                          background: "#f3f4f6",
                          color: "#4b5563",
                          padding: "2px 8px",
                          borderRadius: "4px",
                        }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* アクションボタン（幅100px固定） */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  marginLeft: "16px",
                  justifyContent: "center",
                }}
              >
                <button
                  onClick={() => onPreview(m)}
                  style={{
                    width: "100px",
                    padding: "8px 0",
                    borderRadius: "999px",
                    background: "#0ea5e9",
                    color: "#fff",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  プレビュー
                </button>

                <a
                  href={dlDisabled || isProcessing ? "#" : getDownloadUrl(m.embedUrl)}
                  download={m.type === "video" ? `${m.title}.mp4` : `${m.title}.pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={dlDisabled ? "kb-dl-btn-disabled" : ""}
                  style={{
                    width: "100px",
                    padding: "8px 0",
                    borderRadius: "999px",
                    background: isProcessing ? "#f3f4f6" : "#fff",
                    color: isProcessing ? "#9ca3af" : "#374151",
                    border: "1px solid #d1d5db",
                    fontSize: "13px",
                    fontWeight: 600,
                    textAlign: "center",
                    textDecoration: "none",
                    display: "block",
                    transition: "all 0.2s ease",
                  }}
                  onClick={(e) => handleDownloadClick(m, e)}
                >
                  {isProcessing ? "DL中..." : "DL"}
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* ページネーション */}
      {totalPages > 1 && (
        <div
          className="kb-pager"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "16px",
            marginTop: "24px",
          }}
        >
          <button
            type="button"
            onClick={handlePrev}
            disabled={safePage === 1}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              background: safePage === 1 ? "#f9fafb" : "#fff",
              cursor: safePage === 1 ? "not-allowed" : "pointer",
              fontSize: "13px",
            }}
          >
            ← 前へ
          </button>
          <span style={{ fontSize: "14px", color: "#4b5563", fontWeight: 500 }}>
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={safePage === totalPages}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              background: safePage === totalPages ? "#f9fafb" : "#fff",
              cursor: safePage === totalPages ? "not-allowed" : "pointer",
              fontSize: "13px",
            }}
          >
            次へ →
          </button>
        </div>
      )}

      <style jsx>{`
        .kb-badge-type,
        .kb-badge-new,
        .kb-badge-updated {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 700;
          border: 1px solid rgba(17, 24, 39, 0.08);
        }
        .kb-badge-type {
          background: rgba(14, 165, 233, 0.08);
          color: #0f172a;
        }
        .kb-badge-new {
          background: #e0f2fe;
          color: #0369a1;
          border-color: #bae6fd;
        }
        .kb-badge-updated {
          background: #fef3c7;
          color: #92400e;
          border-color: #fde68a;
        }
        .kb-dl-btn-disabled {
          opacity: 0.45;
          pointer-events: none;
          background: #f3f4f6 !important;
          color: #9ca3af !important;
          border-color: #e5e7eb !important;
        }
      `}</style>
    </div>
  );
}
