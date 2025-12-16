// components/ManualList.tsx
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
  endDate?: string;   // 公開終了 "YYYY-MM-DD"
  type?: ManualType;  // "doc" | "video"

  tags?: string[];
  embedUrl?: string;

  // 既存互換（あってもOK）
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
  brandMap: Record<string, Brand>;
  deptMap: Record<string, Dept>;
  onPreview: (m: Manual) => void;
  pageSize?: number;
};

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
  return Date.now() > t + 24 * 60 * 60 * 1000 - 1; // endDate の当日までは有効扱い
}

function typeLabel(type?: ManualType) {
  if (type === "video") return { icon: "🎬", text: "動画" };
  return { icon: "📄", text: "資料" }; // default
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

  // 並び替え変更時は1ページ目へ
  useEffect(() => {
    setPage(1);
  }, [sortKey]);

  const sortedManuals = useMemo(() => {
    const list = [...(manuals || [])];

    const getUpdated = (m: Manual) => parseYmd(m.updatedAt) ?? -1;
    const getStart = (m: Manual) => parseYmd(m.startDate) ?? -1;

    list.sort((a, b) => {
      if (sortKey === "titleAsc") {
        return (a.title || "").localeCompare(b.title || "", "ja");
      }
      if (sortKey === "startDesc") {
        // 公開日が無いものは下へ
        return getStart(b) - getStart(a);
      }
      // updatedDesc
      return getUpdated(b) - getUpdated(a);
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

  // データ増減で page が範囲外になったら補正
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage]);

  const handlePrev = () => setPage((p) => Math.max(1, p - 1));
  const handleNext = () => setPage((p) => Math.min(totalPages, p + 1));

  return (
    <div>
      {/* 並び替え */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span className="kb-subnote">並び替え</span>
        <select
          className="kb-admin-select"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          style={{ maxWidth: 220 }}
        >
          <option value="updatedDesc">更新日順（新しい）</option>
          <option value="titleAsc">タイトル順（A→Z）</option>
          <option value="startDesc">公開日順（新しい）</option>
        </select>
      </div>

      {/* リスト */}
      {currentManuals.map((m) => {
        const brandLabel =
          (m.brandId && brandMap[m.brandId]?.name) || m.brand || "ブランド未設定";
        const deptLabel =
          (m.bizId && deptMap[m.bizId]?.name) || m.biz || "部署未設定";

        // NEW/更新判定（1ヶ月=30日）
        const isNewByStart = withinDays(m.startDate, 30);
        const isUpdatedByUpdatedAt = withinDays(m.updatedAt, 30);

        const t = typeLabel(m.type);
        const expired = isExpired(m.endDate);

        const dlDisabled = !m.embedUrl || m.noDownload;

        return (
          <div
            className="kb-manual-item"
            key={m.manualId}
            style={{
              opacity: expired ? 0.55 : 1,
              filter: expired ? "grayscale(0.2)" : "none",
            }}
            title={expired ? "公開終了しています" : undefined}
          >
            <div className="kb-manual-main">
              {/* バッジ行（Knowbieテーマのバッジ風） */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 6,
                }}
              >
                <span className="kb-badge-type">
                  {t.icon} {t.text}
                </span>

                {isNewByStart && <span className="kb-badge-new">NEW</span>}

                {!isNewByStart && isUpdatedByUpdatedAt && (
                  <span className="kb-badge-updated">更新</span>
                )}
              </div>

              {/* タイトル */}
              <div className="kb-manual-title">{m.title}</div>

              {/* 説明文 */}
              {m.desc && <div className="kb-manual-desc">{m.desc}</div>}

              {/* メタ情報 */}
              <div className="kb-manual-meta">
                {brandLabel} / {deptLabel}
                {m.startDate ? ` / 公開: ${m.startDate}` : ""}
                {m.updatedAt ? ` / 更新: ${m.updatedAt}` : ""}
              </div>

              {/* タグ */}
              {m.tags && m.tags.length > 0 && (
                <div className="kb-tag-row">
                  {m.tags.map((tag, i) => (
                    <span className="kb-tag" key={`${m.manualId}-tag-${i}`}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 右側アクション：プレビュー / DL */}
            <div className="kb-manual-actions">
              <button className="kb-preview-btn" onClick={() => onPreview(m)}>
                プレビュー
              </button>

              <a
                href={m.embedUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={"kb-dl-btn" + (dlDisabled ? " kb-dl-btn-disabled" : "")}
                onClick={(e) => {
                  if (dlDisabled) e.preventDefault();
                }}
                aria-disabled={dlDisabled}
                title={m.noDownload ? "ダウンロード禁止" : undefined}
              >
                DL
              </a>
            </div>
          </div>
        );
      })}

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="kb-pager">
          <button
            type="button"
            className="kb-pager-btn"
            onClick={handlePrev}
            disabled={safePage === 1}
          >
            ← 前へ
          </button>
          <span className="kb-pager-info">
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            className="kb-pager-btn"
            onClick={handleNext}
            disabled={safePage === totalPages}
          >
            次へ →
          </button>
        </div>
      )}

      {/* バッジの最低限スタイル（CSS未定義なら追加して） */}
      <style jsx>{`
        .kb-badge-type,
        .kb-badge-new,
        .kb-badge-updated {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          border: 1px solid rgba(17, 24, 39, 0.08);
          background: rgba(14, 165, 233, 0.08); /* Knowbieっぽい薄青 */
          color: #0f172a;
        }
        .kb-badge-new {
          background: rgba(17, 175, 228, 0.16);
        }
        .kb-badge-updated {
          background: rgba(124, 58, 237, 0.12);
        }
        .kb-manual-desc {
          margin-top: 6px;
          font-size: 12.5px;
          color: #4b5563;
          line-height: 1.55;
        }

        .kb-dl-btn-disabled {
          opacity: 0.45;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
