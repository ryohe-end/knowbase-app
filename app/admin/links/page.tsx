"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* ========= 型定義 ========= */
type ExternalLink = {
  linkId: string;
  title: string;
  url: string;
  description?: string;
  sortOrder?: number;
  isActive: boolean;
  createdAt?: string;
};

/* ========= 左：並び替えカード（1リンク=1カード / URL非表示） ========= */
function SortableExternalLinkCard({
  link,
  selected,
  onSelect,
}: {
  link: ExternalLink;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: link.linkId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`ext-card ${selected ? "is-selected" : ""} ${
        isDragging ? "is-dragging" : ""
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div
        className="ext-handle"
        {...listeners}
        {...attributes}
        title="ドラッグして並び替え"
        onClick={(e) => e.stopPropagation()}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="5" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="9" cy="19" r="1" />
          <circle cx="15" cy="5" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="15" cy="19" r="1" />
        </svg>
      </div>

      <div className="ext-cardBody">
        <div className="ext-row">
          <div className="ext-title">{link.title}</div>

          <span className={`ext-pill ${link.isActive ? "on" : "off"}`}>
            <span className={`ext-dot ${link.isActive ? "on" : "off"}`} />
            {link.isActive ? "表示中" : "非表示"}
          </span>
        </div>

        {!!link.description?.trim() && <div className="ext-desc">{link.description}</div>}
      </div>
    </div>
  );
}

/* ========= メイン ========= */
export default function ExternalLinksAdminPage() {
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLink, setSelectedLink] = useState<Partial<ExternalLink> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortedLinks = useMemo(() => {
    const list = [...links];
    list.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
    return list;
  }, [links]);

  const fetchLinks = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/external-links");
      const data = await res.json();
      setLinks(data.links || []);
    } catch {
      alert("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedLinks.findIndex((i) => i.linkId === active.id);
    const newIndex = sortedLinks.findIndex((i) => i.linkId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const newArray = arrayMove(sortedLinks, oldIndex, newIndex).map((l, idx) => ({
      ...l,
      sortOrder: idx,
    }));

    // UI更新
    setLinks(newArray);

    // 選択維持
    if (selectedLink?.linkId) {
      const updated = newArray.find((x) => x.linkId === selectedLink.linkId);
      if (updated) setSelectedLink(updated);
    }

    // 並び順保存
    try {
      await Promise.all(
        newArray.map((link, index) =>
          fetch("/api/external-links", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...link, sortOrder: index }),
          })
        )
      );
    } catch (err) {
      console.error(err);
      alert("並び順の保存に失敗しました。再読み込みしてください。");
    }
  };

  const handleCreateNew = () => {
    setSelectedLink({
      title: "",
      url: "",
      description: "",
      sortOrder: sortedLinks.length,
      isActive: true,
    });
  };

  const handleSave = async () => {
    if (!selectedLink?.title || !selectedLink?.url) {
      alert("タイトルとURLは必須です");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/external-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedLink),
      });
      if (!res.ok) throw new Error("save failed");
      alert("保存しました");
      setSelectedLink(null);
      await fetchLinks();
    } catch (err) {
      console.error(err);
      alert("保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (linkId: string) => {
    if (!confirm("本当に削除しますか？")) return;
    try {
      const res = await fetch(`/api/external-links/${linkId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setSelectedLink(null);
      await fetchLinks();
    } catch (err) {
      console.error(err);
      alert("削除に失敗しました");
    }
  };

  return (
    <div className="ext-root">
      {/* Topbar */}
      <div className="ext-topbar">
        <Link
          href="/admin"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            textDecoration: "none",
          }}
        >
          <img
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
            alt="Logo"
            style={{ width: 44, height: 44 }}
          />
          <div className="ext-topTitle">外部リンク管理</div>
        </Link>

        <Link href="/admin">
          <button className="ext-backBtn">管理メニューへ戻る</button>
        </Link>
      </div>

      {/* Main */}
      <div className="ext-grid">
        {/* Left */}
        <div className="ext-panel">
          <div className="ext-headRow">
            <div className="ext-head">登録リスト ({sortedLinks.length})</div>
            <button className="ext-primary" onClick={handleCreateNew}>
              ＋ 新規登録
            </button>
          </div>

          <div className="ext-list">
            {loading ? (
              <div className="ext-muted">読み込み中...</div>
            ) : sortedLinks.length === 0 ? (
              <div className="ext-empty">
                <div className="ext-emptyTitle">まだ登録がありません</div>
                <div className="ext-emptySub">「＋ 新規登録」から追加してください。</div>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sortedLinks.map((l) => l.linkId)} strategy={verticalListSortingStrategy}>
                  {sortedLinks.map((link) => (
                    <SortableExternalLinkCard
                      key={link.linkId}
                      link={link}
                      selected={selectedLink?.linkId === link.linkId}
                      onSelect={() => setSelectedLink(link)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>

          <div className="ext-hint">※ドラッグして自由に並び替えできます</div>
        </div>

        {/* Right */}
        <div className="ext-panel">
          <div className="ext-head">
            {selectedLink ? (selectedLink.linkId ? "詳細・編集" : "新規登録") : "未選択"}
          </div>

          {selectedLink ? (
            <div className="ext-form">
              <div className="ext-field">
                <label className="ext-label">タイトル</label>
                <input
                  className="ext-input"
                  value={selectedLink.title || ""}
                  onChange={(e) => setSelectedLink({ ...selectedLink, title: e.target.value })}
                  placeholder="例: 勤怠管理システム"
                />
              </div>

              <div className="ext-field">
                <label className="ext-label">URL</label>
                <input
                  className="ext-input"
                  value={selectedLink.url || ""}
                  onChange={(e) => setSelectedLink({ ...selectedLink, url: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div className="ext-field">
                <label className="ext-label">説明（任意）</label>
                <textarea
                  className="ext-textarea"
                  value={selectedLink.description || ""}
                  onChange={(e) => setSelectedLink({ ...selectedLink, description: e.target.value })}
                  rows={4}
                  placeholder="補足説明を入力してください"
                />
              </div>

              <div className="ext-field">
                <label className="ext-label">表示設定</label>
                <select
                  className="ext-select"
                  value={selectedLink.isActive ? "true" : "false"}
                  onChange={(e) => setSelectedLink({ ...selectedLink, isActive: e.target.value === "true" })}
                >
                  <option value="true">表示中</option>
                  <option value="false">非表示（下書き）</option>
                </select>
              </div>

              <div className="ext-actions">
                {selectedLink.linkId && (
                  <button className="ext-dangerText" onClick={() => handleDelete(selectedLink.linkId!)}>
                    削除する
                  </button>
                )}

                <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
                  <button className="ext-secondary" onClick={() => setSelectedLink(null)} disabled={isSaving}>
                    中止
                  </button>
                  <button className="ext-primary" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? "保存中..." : "保存する"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="ext-placeholder">
              <p>
                左側のリストから項目を選ぶか、
                <br />
                新しく追加してください。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ✅ globalで当てて「後勝ち」にする（衝突も避けた） */}
      <style jsx global>{`
        .ext-root {
          background: #f8fafc;
          min-height: 100vh;
          font-family: "Inter", -apple-system, sans-serif;
          color: #0f172a;
        }

        .ext-topbar {
          background: #fff;
          padding: 12px 32px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #e2e8f0;
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .ext-topTitle {
          color: #1e293b;
          font-size: 18px;
          font-weight: 900;
        }

        .ext-backBtn {
          background: #f1f5f9;
          border: none;
          padding: 10px 20px;
          border-radius: 12px;
          font-weight: 900;
          color: #475569;
          cursor: pointer;
        }
        .ext-backBtn:hover {
          background: #e2e8f0;
        }

        .ext-grid {
          display: grid;
          grid-template-columns: 420px 1fr;
          gap: 24px;
          padding: 24px;
          max-width: 1400px;
          margin: 0 auto;
        }

        .ext-panel {
          background: #fff;
          border-radius: 20px;
          padding: 28px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
          border: 1px solid #e2e8f0;
          height: calc(100vh - 120px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .ext-headRow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          margin-bottom: 18px;
        }

        .ext-head {
          font-size: 1.15rem;
          font-weight: 900;
          color: #0f172a;
        }

        /* ✅ 左リスト：カードの集合 */
        .ext-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 6px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .ext-list::-webkit-scrollbar {
          width: 6px;
        }
        .ext-list::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }

        .ext-hint {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 14px;
          text-align: center;
          font-weight: 800;
        }

        /* ✅ 1リンク = 1カード（ここが本体） */
        .ext-card {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 16px 16px;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          box-shadow: 0 8px 16px rgba(15, 23, 42, 0.06);
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
        }
        .ext-card:hover {
          transform: translateY(-1px);
          border-color: #cbd5e1;
          box-shadow: 0 12px 22px rgba(15, 23, 42, 0.10);
        }
        .ext-card.is-selected {
          border-color: #3b82f6;
          background: #eff6ff;
          box-shadow: 0 14px 26px rgba(59, 130, 246, 0.18);
        }
        .ext-card.is-dragging {
          opacity: 0.6;
          border-color: #3b82f6;
          box-shadow: 0 18px 30px rgba(15, 23, 42, 0.22);
        }

        .ext-handle {
          padding-top: 2px;
          cursor: grab;
          flex-shrink: 0;
        }

        .ext-cardBody {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .ext-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }

        .ext-title {
          font-weight: 900;
          font-size: 15px;
          color: #0f172a;
          line-height: 1.25;
          word-break: break-word;
        }

        .ext-desc {
          font-size: 13px;
          color: #475569;
          line-height: 1.45;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .ext-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid #e2e8f0;
          user-select: none;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ext-pill.on {
          background: rgba(34, 197, 94, 0.10);
          color: #166534;
          border-color: rgba(34, 197, 94, 0.25);
        }
        .ext-pill.off {
          background: rgba(148, 163, 184, 0.18);
          color: #334155;
          border-color: rgba(148, 163, 184, 0.35);
        }

        .ext-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
        }
        .ext-dot.on {
          background: #22c55e;
        }
        .ext-dot.off {
          background: #94a3b8;
        }

        /* 右フォーム */
        .ext-form {
          flex: 1;
          overflow-y: auto;
          padding-right: 4px;
        }
        .ext-field {
          margin-bottom: 20px;
        }
        .ext-label {
          font-size: 13px;
          font-weight: 900;
          color: #475569;
          display: block;
          margin-bottom: 10px;
        }
        .ext-input,
        .ext-select,
        .ext-textarea {
          width: 100%;
          padding: 14px;
          border: 1px solid #cbd5e1;
          border-radius: 14px;
          font-size: 15px;
          background: #fdfdfd;
          transition: 0.2s;
        }
        .ext-input:focus,
        .ext-select:focus,
        .ext-textarea:focus {
          border-color: #3b82f6;
          outline: none;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.10);
        }

        .ext-actions {
          display: flex;
          align-items: center;
          margin-top: 26px;
          padding-top: 18px;
          border-top: 1px dashed #e2e8f0;
        }

        .ext-primary {
          background: #3b82f6;
          color: #fff;
          padding: 12px 22px;
          border-radius: 999px;
          border: none;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 12px 20px rgba(59, 130, 246, 0.18);
          transition: 0.15s;
        }
        .ext-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 16px 28px rgba(59, 130, 246, 0.22);
        }
        .ext-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .ext-secondary {
          background: #fff;
          border: 1px solid #cbd5e1;
          color: #475569;
          padding: 12px 22px;
          border-radius: 999px;
          font-weight: 900;
          cursor: pointer;
        }

        .ext-dangerText {
          background: none;
          border: none;
          color: #ef4444;
          font-weight: 900;
          cursor: pointer;
          font-size: 14px;
        }

        .ext-placeholder {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #94a3b8;
          text-align: center;
          font-weight: 800;
        }

        .ext-muted {
          color: #64748b;
          font-weight: 800;
          padding: 10px 6px;
        }

        .ext-empty {
          border: 1px dashed #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          background: #fafcff;
          color: #64748b;
        }
        .ext-emptyTitle {
          font-weight: 900;
          color: #334155;
          margin-bottom: 6px;
        }
        .ext-emptySub {
          font-size: 13px;
          font-weight: 700;
        }

        @media (max-width: 980px) {
          .ext-grid {
            grid-template-columns: 1fr;
          }
          .ext-panel {
            height: auto;
            min-height: 420px;
          }
        }
      `}</style>
    </div>
  );
}
