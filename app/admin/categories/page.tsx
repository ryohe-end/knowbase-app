"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ManualCategory, SeriesLink } from "@/types/manualCategory";

const genId = () => `S-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type Manual = {
  manualId: string;
  title: string;
  type?: "video" | "doc";
  categoryId?: string | null;
  seriesOrder?: number | null;
  biz?: string;
  brand?: string;
};

type Dept = { deptId: string; name: string };

export default function SeriesAdminPage() {
  const [series, setSeries] = useState<ManualCategory[]>([]);
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 編集中のシリーズ
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [seriesName, setSeriesName] = useState("");
  const [seriesSortOrder, setSeriesSortOrder] = useState<string>("0");
  const [seriesDescription, setSeriesDescription] = useState<string>("");
  const [seriesBizId, setSeriesBizId] = useState<string>("");
  const [seriesPublishedAt, setSeriesPublishedAt] = useState<string>("");
  const [seriesThumbnailUrl, setSeriesThumbnailUrl] = useState<string>("");
  const [seriesLinks, setSeriesLinks] = useState<SeriesLink[]>([]);

  // マニュアル割当の作業中状態
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [unassignedSearch, setUnassignedSearch] = useState("");

  // 変更検知用 (一括保存ボタン制御)
  const [initialAssigned, setInitialAssigned] = useState<string>("[]");
  const [initialMeta, setInitialMeta] = useState<string>("");

  const currentMetaSerialized = `${seriesName.trim()}|${seriesSortOrder}|${seriesDescription}|${seriesBizId}|${seriesPublishedAt}|${seriesThumbnailUrl}|${JSON.stringify(seriesLinks)}`;
  const dirty = useMemo(() => {
    if (selectedSeriesId === null) return false;
    if (JSON.stringify(assignedIds) !== initialAssigned) return true;
    if (currentMetaSerialized !== initialMeta) return true;
    return false;
  }, [selectedSeriesId, assignedIds, initialAssigned, currentMetaSerialized, initialMeta]);

  /* ========== データ取得 ========== */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, mRes, dRes] = await Promise.all([
        fetch("/api/manual-categories", { cache: "no-store" }),
        fetch("/api/manuals", { cache: "no-store" }),
        fetch("/api/depts", { cache: "no-store" }),
      ]);
      const sJson = await sRes.json().catch(() => ({}));
      const mJson = await mRes.json().catch(() => ({}));
      const dJson = await dRes.json().catch(() => ({}));
      if (!sRes.ok || !sJson.ok) throw new Error(sJson?.error || "シリーズ取得に失敗しました");
      if (!mRes.ok) throw new Error(mJson?.error || "マニュアル取得に失敗しました");
      setSeries(sJson.categories || []);
      setManuals(mJson.manuals || []);
      setDepts(dJson?.depts || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* ========== 選択中シリーズの初期化 ========== */
  const selectSeries = useCallback((s: ManualCategory) => {
    if (dirty) {
      if (!confirm("未保存の変更があります。破棄して別のシリーズを開きますか？")) return;
    }
    setSelectedSeriesId(s.categoryId);
    setSeriesName(s.name);
    setSeriesSortOrder(String(s.sortOrder ?? 0));
    const desc = s.description ?? "";
    const bid = s.bizId ?? "";
    const pub = s.publishedAt ?? "";
    const thumb = s.thumbnailUrl ?? "";
    const lks = Array.isArray(s.links) ? s.links.map((l) => ({ label: l.label ?? "", url: l.url ?? "" })) : [];
    setSeriesDescription(desc);
    setSeriesBizId(bid);
    setSeriesPublishedAt(pub);
    setSeriesThumbnailUrl(thumb);
    setSeriesLinks(lks);

    const assigned = manuals
      .filter((m) => m.categoryId === s.categoryId)
      .sort((a, b) => (a.seriesOrder ?? 9999) - (b.seriesOrder ?? 9999))
      .map((m) => m.manualId);

    setAssignedIds(assigned);
    setInitialAssigned(JSON.stringify(assigned));
    setInitialMeta(`${s.name.trim()}|${String(s.sortOrder ?? 0)}|${desc}|${bid}|${pub}|${thumb}|${JSON.stringify(lks)}`);
    setUnassignedSearch("");
  }, [dirty, manuals]);

  /* ========== 新規シリーズ ========== */
  const createSeries = async () => {
    const name = prompt("新規シリーズ名を入力してください");
    if (!name || !name.trim()) return;
    setSaving(true);
    try {
      const categoryId = genId();
      // 末尾に追加 (sortOrder = 既存最大 + 1)
      const maxOrder = series.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1);
      const res = await fetch("/api/manual-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          name: name.trim(),
          parentId: null,
          sortOrder: maxOrder + 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data?.error || "作成に失敗しました");
      await loadAll();
      // 作成したやつを開く
      setSelectedSeriesId(categoryId);
      setSeriesName(name.trim());
      setSeriesSortOrder(String(maxOrder + 1));
      setSeriesDescription("");
      setSeriesBizId("");
      setSeriesPublishedAt("");
      setSeriesThumbnailUrl("");
      setSeriesLinks([]);
      setAssignedIds([]);
      setInitialAssigned("[]");
      setInitialMeta(`${name.trim()}|${maxOrder + 1}|||||[]`);
    } catch (e: any) {
      alert(`作成エラー: ${e?.message || ""}`);
    } finally {
      setSaving(false);
    }
  };

  /* ========== シリーズ削除 ========== */
  const deleteSeries = async () => {
    if (!selectedSeriesId) return;
    const target = series.find((s) => s.categoryId === selectedSeriesId);
    if (!target) return;
    if (assignedIds.length > 0) {
      alert(`このシリーズには ${assignedIds.length} 本のマニュアルが紐づいています。先に全て解除してください。`);
      return;
    }
    if (!confirm(`シリーズ「${target.name}」を削除します。よろしいですか？`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/manual-categories?categoryId=${encodeURIComponent(selectedSeriesId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data?.error || "削除に失敗しました");
      setSelectedSeriesId(null);
      await loadAll();
    } catch (e: any) {
      alert(`削除エラー: ${e?.message || ""}`);
    } finally {
      setSaving(false);
    }
  };

  /* ========== 一括保存 (シリーズ名/順 + マニュアル割当) ========== */
  const handleSave = async () => {
    if (!selectedSeriesId) return;
    if (!seriesName.trim()) {
      alert("シリーズ名は必須です");
      return;
    }
    setSaving(true);
    try {
      // 部署名キャッシュ
      const bizName = depts.find((d) => d.deptId === seriesBizId)?.name || null;

      // 1. シリーズメタ情報を更新
      const metaRes = await fetch("/api/manual-categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: selectedSeriesId,
          name: seriesName.trim(),
          parentId: null,
          sortOrder: Number(seriesSortOrder) || 0,
          description: seriesDescription.trim() || null,
          bizId: seriesBizId || null,
          biz: bizName,
          publishedAt: seriesPublishedAt || null,
          thumbnailUrl: seriesThumbnailUrl.trim() || null,
          links: seriesLinks
            .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
            .filter((l) => l.url),
        }),
      });
      const metaData = await metaRes.json().catch(() => ({}));
      if (!metaRes.ok || !metaData.ok) throw new Error(metaData?.error || "シリーズ情報の保存に失敗");

      // 2. 割当マニュアルを一括更新
      const assignRes = await fetch(
        `/api/manual-categories/${encodeURIComponent(selectedSeriesId)}/manuals`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manualIds: assignedIds }),
        }
      );
      const assignData = await assignRes.json().catch(() => ({}));
      if (!assignRes.ok || !assignData.ok) {
        const detail = assignData?.errors ? `\n${JSON.stringify(assignData.errors, null, 2)}` : "";
        throw new Error((assignData?.error || "マニュアル割当の保存に失敗") + detail);
      }

      await loadAll();
      // 保存後に現状を initial に
      setInitialAssigned(JSON.stringify(assignedIds));
      setInitialMeta(currentMetaSerialized);
      alert("保存しました");
    } catch (e: any) {
      alert(`保存エラー: ${e?.message || ""}`);
    } finally {
      setSaving(false);
    }
  };

  /* ========== マニュアル割当操作 ========== */
  const addToAssigned = (manualId: string) => {
    if (assignedIds.includes(manualId)) return;
    setAssignedIds((prev) => [...prev, manualId]);
  };
  const removeFromAssigned = (manualId: string) => {
    setAssignedIds((prev) => prev.filter((id) => id !== manualId));
  };

  /* ========== dnd-kit ========== */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setAssignedIds((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  /* ========== 派生データ ========== */
  const sortedSeries = useMemo(
    () => [...series].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [series]
  );
  const manualMap = useMemo(() => {
    const m: Record<string, Manual> = {};
    for (const x of manuals) m[x.manualId] = x;
    return m;
  }, [manuals]);
  const seriesNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of series) m[s.categoryId] = s.name;
    return m;
  }, [series]);

  const assignedManuals = useMemo(
    () => assignedIds.map((id) => manualMap[id]).filter(Boolean),
    [assignedIds, manualMap]
  );
  const unassignedManuals = useMemo(() => {
    const assignedSet = new Set(assignedIds);
    const kw = unassignedSearch.trim().toLowerCase();
    return manuals
      .filter((m) => !assignedSet.has(m.manualId))
      .filter((m) => {
        if (!kw) return true;
        const hay = `${m.title} ${m.biz ?? ""} ${m.brand ?? ""} ${m.categoryId ? seriesNameById[m.categoryId] ?? "" : ""}`.toLowerCase();
        return hay.includes(kw);
      })
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }, [manuals, assignedIds, unassignedSearch, seriesNameById]);

  /* ========== JSX ========== */
  return (
    <div className="ser-root">
      <header className="ser-topbar">
        <Link href="/admin" className="ser-back-link">← 管理メニューへ戻る</Link>
        <h1 className="ser-title">マニュアルシリーズ管理</h1>
        <div />
      </header>

      <main className="ser-main">
        {error && <div className="ser-error">{error}</div>}

        <div className="ser-layout">
          {/* 左: シリーズ一覧 */}
          <aside className="ser-side">
            <div className="ser-side-head">
              <span>シリーズ一覧 ({series.length})</span>
              <button className="ser-btn-primary sm" onClick={createSeries} disabled={saving || loading}>
                ＋ 新規
              </button>
            </div>
            {loading ? (
              <div className="ser-loading">読み込み中...</div>
            ) : sortedSeries.length === 0 ? (
              <div className="ser-empty">シリーズがありません</div>
            ) : (
              <ul className="ser-list">
                {sortedSeries.map((s) => {
                  const count = manuals.filter((m) => m.categoryId === s.categoryId).length;
                  const active = selectedSeriesId === s.categoryId;
                  return (
                    <li key={s.categoryId}>
                      <button
                        type="button"
                        className={"ser-list-item" + (active ? " active" : "")}
                        onClick={() => selectSeries(s)}
                      >
                        <span className="ser-list-name">{s.name}</span>
                        <span className="ser-list-count">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* 右: 編集パネル */}
          <section className="ser-panel">
            {selectedSeriesId === null ? (
              <div className="ser-placeholder">
                左のシリーズ一覧から編集対象を選択するか、「＋ 新規」で作成してください。
              </div>
            ) : (
              <>
                <div className="ser-panel-head">
                  <div style={{ display: "flex", flex: 1, gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <label className="ser-label">シリーズ名 <span className="ser-req">必須</span></label>
                      <input
                        type="text"
                        className="ser-input"
                        value={seriesName}
                        onChange={(e) => setSeriesName(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                    <div style={{ width: 100 }}>
                      <label className="ser-label">並び順</label>
                      <input
                        type="number"
                        className="ser-input"
                        value={seriesSortOrder}
                        onChange={(e) => setSeriesSortOrder(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  </div>
                  <div className="ser-panel-actions">
                    <button className="ser-btn-ghost" onClick={deleteSeries} disabled={saving || assignedIds.length > 0} title={assignedIds.length > 0 ? "マニュアル割当を全て解除してから削除可能" : ""}>
                      削除
                    </button>
                    <button className="ser-btn-primary" onClick={handleSave} disabled={saving || !dirty}>
                      {saving ? "保存中..." : dirty ? "保存" : "変更なし"}
                    </button>
                  </div>
                </div>

                {/* シリーズメタ情報 */}
                <div className="ser-meta-grid">
                  <div className="ser-field">
                    <label className="ser-label">概要 / コメント</label>
                    <textarea
                      className="ser-input"
                      rows={3}
                      value={seriesDescription}
                      onChange={(e) => setSeriesDescription(e.target.value)}
                      disabled={saving}
                      placeholder="このシリーズの概要を入力 (ユーザー画面のシリーズタイトル下に表示されます)"
                    />
                  </div>

                  <div className="ser-meta-grid-row">
                    <div className="ser-field">
                      <label className="ser-label">配信部署</label>
                      <select
                        className="ser-input"
                        value={seriesBizId}
                        onChange={(e) => setSeriesBizId(e.target.value)}
                        disabled={saving}
                      >
                        <option value="">- 未設定 -</option>
                        {depts.map((d) => (
                          <option key={d.deptId} value={d.deptId}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="ser-field">
                      <label className="ser-label">配信日</label>
                      <input
                        type="date"
                        className="ser-input"
                        value={seriesPublishedAt}
                        onChange={(e) => setSeriesPublishedAt(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  </div>

                  <div className="ser-field">
                    <label className="ser-label">サムネイル URL <span style={{ fontWeight: 600, color: "#94a3b8" }}>（省略可）</span></label>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <input
                        type="url"
                        className="ser-input"
                        value={seriesThumbnailUrl}
                        onChange={(e) => setSeriesThumbnailUrl(e.target.value)}
                        disabled={saving}
                        placeholder="未入力なら 1 本目のマニュアルから自動取得"
                        style={{ flex: 1 }}
                      />
                      {seriesThumbnailUrl && (
                        <div className="ser-thumb-preview">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={seriesThumbnailUrl}
                            alt="サムネイルプレビュー"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <p className="ser-hint">
                      省略時はこのシリーズに割当てた 1 本目のマニュアル (Google Slides/Drive/YouTube) から自動取得されます。
                      明示指定したい場合のみ画像 URL を貼り付けてください (S3 / 公開 CDN 推奨)。
                    </p>
                  </div>

                  <div className="ser-field">
                    <label className="ser-label">外部リンク <span style={{ fontWeight: 600, color: "#94a3b8" }}>（省略可・複数登録可）</span></label>
                    {seriesLinks.map((lk, i) => (
                      <div key={i} className="ser-link-row">
                        <input
                          type="text"
                          className="ser-input"
                          value={lk.label}
                          onChange={(e) => setSeriesLinks((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                          disabled={saving}
                          placeholder="表示名（例: 公式サイト）"
                          style={{ flex: "0 0 200px" }}
                        />
                        <input
                          type="url"
                          className="ser-input"
                          value={lk.url}
                          onChange={(e) => setSeriesLinks((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                          disabled={saving}
                          placeholder="https://..."
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="ser-link-del"
                          onClick={() => setSeriesLinks((prev) => prev.filter((_, j) => j !== i))}
                          disabled={saving}
                          aria-label="削除"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="ser-link-add"
                      onClick={() => setSeriesLinks((prev) => [...prev, { label: "", url: "" }])}
                      disabled={saving}
                    >
                      ＋ リンクを追加
                    </button>
                    <p className="ser-hint">このシリーズに紐づく外部リンク（公式サイト・関連ページ等）を登録できます。URL は https:// で始まる必要があります。</p>
                  </div>
                </div>

                <div className="ser-panel-body">
                  {/* このシリーズのマニュアル */}
                  <div className="ser-col">
                    <div className="ser-col-head">
                      <h3>このシリーズに含まれる ({assignedManuals.length})</h3>
                      <span className="ser-hint">ドラッグで並び替え</span>
                    </div>
                    {assignedManuals.length === 0 ? (
                      <div className="ser-empty-inner">右のリストからマニュアルを追加してください</div>
                    ) : (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={assignedIds} strategy={verticalListSortingStrategy}>
                          <ul className="ser-assigned-list">
                            {assignedManuals.map((m, idx) => (
                              <SortableManualRow
                                key={m.manualId}
                                manual={m}
                                index={idx}
                                onRemove={() => removeFromAssigned(m.manualId)}
                              />
                            ))}
                          </ul>
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>

                  {/* 他のマニュアル (未割当 + 他シリーズ) */}
                  <div className="ser-col">
                    <div className="ser-col-head">
                      <h3>追加できるマニュアル ({unassignedManuals.length})</h3>
                      <input
                        type="text"
                        className="ser-input sm"
                        placeholder="検索..."
                        value={unassignedSearch}
                        onChange={(e) => setUnassignedSearch(e.target.value)}
                      />
                    </div>
                    {unassignedManuals.length === 0 ? (
                      <div className="ser-empty-inner">該当するマニュアルがありません</div>
                    ) : (
                      <ul className="ser-unassigned-list">
                        {unassignedManuals.map((m) => {
                          const inOtherSeries = m.categoryId && m.categoryId !== selectedSeriesId;
                          return (
                            <li key={m.manualId} className="ser-unassigned-row">
                              <span className="ser-unassigned-icon">{m.type === "video" ? "🎬" : "📄"}</span>
                              <div className="ser-unassigned-main">
                                <div className="ser-unassigned-title">{m.title}</div>
                                <div className="ser-unassigned-meta">
                                  {m.biz && <span>{m.biz}</span>}
                                  {inOtherSeries && (
                                    <span className="ser-tag-other">📚 {seriesNameById[m.categoryId!] || "?"}</span>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="ser-add-btn"
                                onClick={() => addToAssigned(m.manualId)}
                                title="このシリーズに追加"
                              >
                                ＋
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      <style jsx global>{`
        .ser-root { min-height: 100vh; background: #fcfdfe; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif; }
        .ser-topbar { height: 64px; background: #fff; border-bottom: 1px solid #e2e8f0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 24px; position: sticky; top: 0; z-index: 100; }
        .ser-back-link { color: #64748b; font-size: 13px; font-weight: 600; text-decoration: none; padding: 6px 12px; border-radius: 8px; }
        .ser-back-link:hover { background: #f1f5f9; color: #334155; }
        .ser-title { margin: 0; font-size: 17px; font-weight: 800; text-align: center; }
        .ser-main { max-width: 1400px; margin: 0 auto; padding: 24px 24px 80px; }
        .ser-error { background: #fef2f2; color: #b91c1c; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; margin-bottom: 14px; border: 1px solid #fecaca; }

        .ser-layout { display: grid; grid-template-columns: 280px 1fr; gap: 20px; }
        @media (max-width: 900px) { .ser-layout { grid-template-columns: 1fr; } }

        .ser-side { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; height: fit-content; position: sticky; top: 80px; }
        .ser-side-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .ser-side-head > span { font-size: 13px; font-weight: 800; color: #1e293b; }
        .ser-loading, .ser-empty { padding: 20px 8px; text-align: center; color: #94a3b8; font-size: 12px; }
        .ser-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; max-height: 70vh; overflow-y: auto; }
        .ser-list-item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 12px; border: 1px solid transparent; border-radius: 8px; background: transparent; font-size: 13px; font-weight: 700; color: #475569; cursor: pointer; text-align: left; transition: 0.15s; }
        .ser-list-item:hover { background: #f8fafc; }
        .ser-list-item.active { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
        .ser-list-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ser-list-count { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: #f1f5f9; color: #64748b; }
        .ser-list-item.active .ser-list-count { background: #dbeafe; color: #1d4ed8; }

        .ser-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; min-height: 400px; }
        .ser-placeholder { text-align: center; padding: 80px 24px; color: #94a3b8; font-size: 14px; font-weight: 600; }

        .ser-panel-head { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; padding-bottom: 16px; border-bottom: 1px solid #f1f5f9; margin-bottom: 16px; }
        .ser-panel-actions { display: flex; gap: 8px; }
        .ser-label { display: block; font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 4px; }
        .ser-input { width: 100%; padding: 9px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: #fff; box-sizing: border-box; }
        .ser-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
        .ser-input.sm { padding: 6px 10px; font-size: 12px; }

        .ser-btn-primary { background: linear-gradient(135deg,#3b82f6,#2563eb); color: #fff; border: none; padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(59,130,246,0.25); transition: 0.15s; }
        .ser-btn-primary:hover:not(:disabled) { transform: translateY(-1px); }
        .ser-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
        .ser-btn-primary.sm { padding: 5px 10px; font-size: 11px; border-radius: 8px; }
        .ser-btn-ghost { background: #fff; color: #ef4444; border: 1px solid #fecaca; padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; }
        .ser-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
        .ser-btn-ghost:hover:not(:disabled) { background: #fef2f2; }

        .ser-meta-grid { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #f1f5f9; }
        .ser-meta-grid-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 700px) { .ser-meta-grid-row { grid-template-columns: 1fr; } }
        .ser-field label { display: block; }
        .ser-req { font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 4px; color: #fff; background: #ef4444; margin-left: 4px; vertical-align: middle; }
        .ser-thumb-preview { width: 64px; height: 64px; border: 1.5px solid #e2e8f0; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: #f8fafc; display: flex; align-items: center; justify-content: center; }
        .ser-thumb-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }

        .ser-panel-body { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        @media (max-width: 1000px) { .ser-panel-body { grid-template-columns: 1fr; } }

        .ser-col { background: #fcfdfe; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; min-height: 300px; }
        .ser-col-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 10px; }
        .ser-col-head h3 { margin: 0; font-size: 13px; font-weight: 800; color: #1e293b; }
        .ser-hint { font-size: 11px; color: #94a3b8; font-weight: 600; }
        .ser-link-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .ser-link-del { flex: 0 0 auto; width: 32px; height: 32px; border: 1.5px solid #fecaca; background: #fef2f2; color: #dc2626; border-radius: 8px; font-size: 16px; font-weight: 800; cursor: pointer; line-height: 1; }
        .ser-link-del:hover:not(:disabled) { background: #fee2e2; }
        .ser-link-add { margin: 2px 0 6px; padding: 8px 14px; border: 1.5px dashed #c7d2fe; background: #eef2ff; color: #4338ca; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .ser-link-add:hover:not(:disabled) { background: #e0e7ff; }
        .ser-link-add:disabled, .ser-link-del:disabled { opacity: 0.5; cursor: default; }
        .ser-empty-inner { padding: 30px 12px; text-align: center; color: #cbd5e1; font-size: 12px; font-weight: 600; border: 2px dashed #e2e8f0; border-radius: 10px; }

        .ser-assigned-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
        .ser-assigned-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 13px; cursor: grab; transition: 0.1s; }
        .ser-assigned-row:hover { border-color: #bfdbfe; box-shadow: 0 2px 8px rgba(59,130,246,0.08); }
        .ser-assigned-row.dragging { opacity: 0.5; }
        .ser-grip { color: #cbd5e1; font-size: 16px; cursor: grab; }
        .ser-assigned-row.dragging .ser-grip { cursor: grabbing; }
        .ser-order-num { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 999px; flex-shrink: 0; }
        .ser-assigned-icon { font-size: 14px; flex-shrink: 0; }
        .ser-assigned-title { flex: 1; font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ser-remove-btn { background: transparent; border: none; color: #cbd5e1; cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 6px; flex-shrink: 0; }
        .ser-remove-btn:hover { color: #ef4444; background: #fef2f2; }

        .ser-unassigned-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; max-height: 60vh; overflow-y: auto; }
        .ser-unassigned-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; }
        .ser-unassigned-icon { font-size: 14px; flex-shrink: 0; }
        .ser-unassigned-main { flex: 1; min-width: 0; }
        .ser-unassigned-title { font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
        .ser-unassigned-meta { display: flex; gap: 8px; font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .ser-tag-other { background: #fef3c7; color: #92400e; padding: 1px 8px; border-radius: 99px; font-weight: 700; font-size: 10px; border: 1px solid #fcd34d; }
        .ser-add-btn { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; cursor: pointer; padding: 4px 10px; border-radius: 8px; font-weight: 800; font-size: 14px; flex-shrink: 0; }
        .ser-add-btn:hover { background: #dbeafe; }
      `}</style>
    </div>
  );
}

/* ========== Sortable Manual Row ========== */
function SortableManualRow({ manual, index, onRemove }: { manual: Manual; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: manual.manualId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={"ser-assigned-row" + (isDragging ? " dragging" : "")}
    >
      <span className="ser-grip" {...attributes} {...listeners} aria-hidden>⠿</span>
      <span className="ser-order-num">#{index + 1}</span>
      <span className="ser-assigned-icon">{manual.type === "video" ? "🎬" : "📄"}</span>
      <span className="ser-assigned-title">{manual.title}</span>
      <button type="button" className="ser-remove-btn" onClick={onRemove} title="このシリーズから外す">×</button>
    </li>
  );
}
