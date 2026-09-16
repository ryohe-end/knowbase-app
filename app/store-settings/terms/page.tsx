"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { StoreTerm, TermVersion } from "@/types/storeTerms";
import { DEFAULT_VARIANT_KEY } from "@/types/storeTerms";
import { SEED_TERMS, BRAND_CONFIG, BRANDS } from "@/lib/storeTerms/seed";
import { getBaseTitle, getTitleVariant, makeTermId } from "@/lib/storeTerms/title";
import { contentToHtml, contentToFullHtml, newId } from "@/lib/storeTerms/blocks";

// --- Icons ---
const ChevronLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 20, height: 20 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);
const ChevronRightSmallIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" style={{ width: 16, height: 16 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);
const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 18, height: 18 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);
const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" style={{ width: 14, height: 14 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

// --- 一覧用マージ型 ---
type MergedTerm = {
  termId: string;
  brand: string;
  baseTitle: string;
  variants: string[];           // タイトル末尾の variant 集合 (重複排除)
  categories: string[];         // 同名タイトルが現れたカテゴリ一覧
  storedTerm: StoreTerm | null; // DB に保存済みなら入る
};

// SEED と DB を merge してブランド > 基本タイトルでまとめる
function buildMergedList(seedItems: typeof SEED_TERMS, stored: StoreTerm[]): MergedTerm[] {
  const map = new Map<string, MergedTerm>();
  for (const s of seedItems) {
    const baseTitle = getBaseTitle(s.title);
    const variant = getTitleVariant(s.title);
    const termId = makeTermId(s.brand, baseTitle);
    const cur = map.get(termId);
    if (cur) {
      if (variant && !cur.variants.includes(variant)) cur.variants.push(variant);
      if (!cur.categories.includes(s.category)) cur.categories.push(s.category);
    } else {
      map.set(termId, {
        termId,
        brand: s.brand,
        baseTitle,
        variants: variant ? [variant] : [],
        categories: [s.category],
        storedTerm: null,
      });
    }
  }
  // DB 内データを被せる (seed に無い brand+baseTitle もここで追加される)
  for (const t of stored) {
    const existing = map.get(t.termId);
    if (existing) {
      existing.storedTerm = t;
      // variants/categories は DB 側を正とする
      if (Array.isArray(t.variants) && t.variants.length > 0) existing.variants = t.variants;
      if (Array.isArray(t.categories) && t.categories.length > 0) existing.categories = t.categories;
    } else {
      map.set(t.termId, {
        termId: t.termId,
        brand: t.brand,
        baseTitle: t.baseTitle,
        variants: t.variants ?? [],
        categories: t.categories ?? [],
        storedTerm: t,
      });
    }
  }
  return Array.from(map.values());
}

// 新規バージョン作成
function makeNewVersion(prev: TermVersion | null, variants: string[]): TermVersion {
  const today = new Date().toISOString().slice(0, 10);
  const nextLabel = prev
    ? (() => {
        const m = prev.label.match(/^v(\d+)$/);
        return m ? `v${Number(m[1]) + 1}` : `v${(prev.label || "")}.next`;
      })()
    : "v1";
  const variantKeys = variants.length > 0 ? variants : [DEFAULT_VARIANT_KEY];
  const contentByVariant: Record<string, string> = {};
  for (const k of variantKeys) {
    contentByVariant[k] = prev ? (prev.contentByVariant[k] ?? "") : "";
  }
  return {
    id: newId(),
    label: nextLabel,
    note: "",
    createdAt: today,
    isCurrent: false,
    contentByVariant,
  };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// 既存 StoreTerm が無いときの初期 StoreTerm を作る
function makeInitialTerm(merged: MergedTerm): StoreTerm {
  const variantKeys = merged.variants.length > 0 ? merged.variants : [DEFAULT_VARIANT_KEY];
  const contentByVariant: Record<string, string> = {};
  for (const k of variantKeys) contentByVariant[k] = "";
  const today = new Date().toISOString();
  return {
    termId: merged.termId,
    brand: merged.brand,
    baseTitle: merged.baseTitle,
    variants: merged.variants,
    categories: merged.categories,
    isRequired: false,
    versions: [
      {
        id: newId(),
        label: "v1",
        note: "",
        createdAt: today.slice(0, 10),
        isCurrent: true,
        contentByVariant,
      },
    ],
    createdAt: today,
    updatedAt: today,
  };
}

export default function TermsManagementPage() {
  const [storedTerms, setStoredTerms] = useState<StoreTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [filterBrand, setFilterBrand] = useState("ALL");
  const [search, setSearch] = useState("");
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>(
    Object.fromEntries(BRANDS.map((b) => [b, true]))
  );
  const isAdmin = me?.role === "admin" || me?.role === "sv";

  // 編集中の StoreTerm のローカルコピー (null = 一覧表示)
  const [editing, setEditing] = useState<StoreTerm | null>(null);
  const [editorMode, setEditorMode] = useState<"edit" | "view">("view");
  const [editingVersionId, setEditingVersionId] = useState<string>("");
  const [editingVariant, setEditingVariant] = useState<string>(DEFAULT_VARIANT_KEY);
  const [saving, setSaving] = useState(false);

  const canEdit = isAdmin && editorMode === "edit";

  // 新規規約作成モーダル
  const [showCreateModal, setShowCreateModal] = useState(false);

  // 出力 PDF URL
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 初回ロード (terms + 自ユーザー)
  useEffect(() => {
    (async () => {
      try {
        const [termsRes, meRes] = await Promise.all([
          fetch("/api/store-settings/terms"),
          fetch("/api/me", { cache: "no-store" }),
        ]);
        const termsData = await termsRes.json();
        if (termsData.ok && Array.isArray(termsData.terms)) {
          setStoredTerms(termsData.terms);
        }
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.ok && meData.user?.role) {
            setMe({ role: String(meData.user.role) });
          }
        }
      } catch (e) {
        console.error("Failed to fetch initial data", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const merged = useMemo(() => buildMergedList(SEED_TERMS, storedTerms), [storedTerms]);

  const filtered = useMemo(() => {
    const byBrand = filterBrand === "ALL" ? merged : merged.filter((m) => m.brand === filterBrand);
    if (!search) return byBrand;
    const q = search.toLowerCase();
    return byBrand.filter(
      (m) =>
        m.baseTitle.toLowerCase().includes(q) ||
        m.brand.toLowerCase().includes(q) ||
        m.categories.some((c) => c.toLowerCase().includes(q))
    );
  }, [merged, filterBrand, search]);

  const groupedByBrand = useMemo(() => {
    const g: Record<string, MergedTerm[]> = {};
    for (const m of filtered) {
      (g[m.brand] = g[m.brand] || []).push(m);
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => a.baseTitle.localeCompare(b.baseTitle, "ja"));
    }
    return g;
  }, [filtered]);

  // ----- 編集 / 閲覧を開く -----
  const openEditor = (m: MergedTerm, mode: "edit" | "view") => {
    const term = m.storedTerm ? clone(m.storedTerm) : makeInitialTerm(m);
    // バリアントキーを正規化 (旧データに無いキーは空文字で補完)
    const variantKeys = term.variants.length > 0 ? term.variants : [DEFAULT_VARIANT_KEY];
    for (const v of term.versions) {
      if (!v.contentByVariant) v.contentByVariant = {};
      for (const k of variantKeys) {
        if (typeof v.contentByVariant[k] !== "string") v.contentByVariant[k] = "";
      }
    }
    setEditing(term);
    setEditorMode(mode);
    const current = term.versions.find((v) => v.isCurrent) ?? term.versions[term.versions.length - 1];
    setEditingVersionId(current.id);
    setEditingVariant(variantKeys[0]);
    setPdfUrl("");
  };

  const closeEditor = () => {
    setEditing(null);
    setPdfUrl("");
  };

  const updateVersion = (mutator: (v: TermVersion) => TermVersion) => {
    setEditing((cur) => {
      if (!cur) return cur;
      const next = { ...cur, versions: cur.versions.map((v) => (v.id === editingVersionId ? mutator(v) : v)) };
      return next;
    });
  };

  const currentVersion = editing?.versions.find((v) => v.id === editingVersionId) ?? null;
  const currentContent: string = currentVersion?.contentByVariant[editingVariant] ?? "";

  // ----- 本文編集 -----
  const setCurrentContent = (next: string) => {
    updateVersion((v) => ({
      ...v,
      contentByVariant: { ...v.contentByVariant, [editingVariant]: next },
    }));
  };

  // ----- baseTitle 編集 (admin のみ) -----
  // termId は不変。baseTitle は表示用属性として更新する
  const setBaseTitle = (next: string) => {
    setEditing((cur) => (cur ? { ...cur, baseTitle: next } : cur));
  };

  // ----- バージョン操作 -----
  const addNewVersion = () => {
    setEditing((cur) => {
      if (!cur) return cur;
      const last = cur.versions[cur.versions.length - 1] ?? null;
      const newVer = makeNewVersion(last, cur.variants);
      const next: StoreTerm = { ...cur, versions: [...cur.versions, newVer] };
      setEditingVersionId(newVer.id);
      return next;
    });
  };
  const deleteVersion = (id: string) => {
    setEditing((cur) => {
      if (!cur) return cur;
      if (cur.versions.length <= 1) {
        showToast("最後のバージョンは削除できません", "error");
        return cur;
      }
      const filteredVers = cur.versions.filter((v) => v.id !== id);
      // 削除対象が現行なら別の最新を現行に
      if (cur.versions.find((v) => v.id === id)?.isCurrent && filteredVers.length > 0) {
        filteredVers[filteredVers.length - 1].isCurrent = true;
      }
      if (editingVersionId === id) {
        setEditingVersionId(filteredVers[filteredVers.length - 1].id);
      }
      return { ...cur, versions: filteredVers };
    });
  };
  const setAsCurrent = (id: string) => {
    setEditing((cur) => {
      if (!cur) return cur;
      return { ...cur, versions: cur.versions.map((v) => ({ ...v, isCurrent: v.id === id })) };
    });
  };

  // ----- 保存 -----
  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch("/api/store-settings/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "保存に失敗しました");
      // 一覧データを更新
      setStoredTerms((prev) => {
        const idx = prev.findIndex((t) => t.termId === editing.termId);
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = data.term;
          return copy;
        }
        return [...prev, data.term];
      });
      setEditing(data.term);
      showToast("保存しました");
    } catch (e: any) {
      showToast(e.message || "保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  };

  // ----- 出力 -----
  const exportHtml = () => {
    if (!editing || !currentVersion) return;
    const html = contentToFullHtml(editing.baseTitle, currentContent);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${editing.baseTitle}_${currentVersion.label}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("HTMLをダウンロードしました");
  };
  const callPdf = async (asUrl: boolean) => {
    if (!editing || !currentVersion) return;
    if (!currentContent.trim()) {
      showToast("本文がありません", "error");
      return;
    }
    setPdfGenerating(true);
    try {
      const html = contentToHtml(currentContent);
      const res = await fetch("/api/store-settings/terms/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, title: editing.baseTitle }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "PDF生成に失敗");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (asUrl) {
        setPdfUrl(url);
        showToast("PDF URLを生成しました");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${editing.baseTitle}_${currentVersion.label}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("PDFをダウンロードしました");
      }
    } catch (e: any) {
      showToast(e.message || "PDF生成エラー", "error");
    } finally {
      setPdfGenerating(false);
    }
  };

  // ----- 新規規約作成 (admin のみ) -----
  const createNewTerm = (brand: string, baseTitle: string, variantsCsv: string) => {
    const variants = variantsCsv
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const m: MergedTerm = {
      termId: makeTermId(brand, baseTitle),
      brand,
      baseTitle,
      variants,
      categories: [],
      storedTerm: null,
    };
    setShowCreateModal(false);
    openEditor(m, "edit");
  };

  // ====== EDITOR VIEW ======
  if (editing) {
    return (
      <EditorView
        term={editing}
        currentVersion={currentVersion}
        currentContent={currentContent}
        editingVariant={editingVariant}
        editingVersionId={editingVersionId}
        pdfUrl={pdfUrl}
        pdfGenerating={pdfGenerating}
        saving={saving}
        toast={toast}
        canEdit={canEdit}
        onSwitchToEdit={isAdmin && editorMode === "view" ? () => setEditorMode("edit") : undefined}
        onChangeVariant={setEditingVariant}
        onChangeVersion={setEditingVersionId}
        onAddVersion={addNewVersion}
        onDeleteVersion={deleteVersion}
        onSetAsCurrent={setAsCurrent}
        onUpdateVersionMeta={(patch) => updateVersion((v) => ({ ...v, ...patch }))}
        onChangeContent={setCurrentContent}
        onChangeBaseTitle={setBaseTitle}
        onToggleRequired={(next) => setEditing((cur) => (cur ? { ...cur, isRequired: next } : cur))}
        onSave={handleSave}
        onClose={closeEditor}
        onExportHtml={exportHtml}
        onExportPdf={() => callPdf(false)}
        onExportPdfUrl={() => callPdf(true)}
      />
    );
  }

  // ====== LIST VIEW ======
  return (
    <div className="kb-store-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/store-settings" className="kb-back-link">
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronLeftIcon /> 設定メニューへ戻る
            </span>
          </Link>
          <div style={{ fontWeight: 700 }}>規約・ポリシー管理</div>
          <div style={{ width: 100 }} />
        </div>
      </div>

      <main className="kb-main-container">
        <header className="kb-page-header">
          <div className="kb-page-header-row">
            <div>
              <h1>規約・ポリシー一覧</h1>
              <p>
                ブランドごとに同名規約をまとめて管理します。{loading ? "読込中..." : `全 ${merged.length} 件`}
                {!loading && !isAdmin && <span className="kb-role-badge">閲覧モード</span>}
              </p>
            </div>
            {isAdmin && (
              <button className="kb-btn-primary" onClick={() => setShowCreateModal(true)}>
                <PlusIcon /> 新規規約を追加
              </button>
            )}
          </div>
        </header>

        <div className="kb-tabs">
          {[{ key: "ALL", label: "すべて" }, ...BRANDS.map((b) => ({ key: b, label: b }))].map((tab) => (
            <button
              key={tab.key}
              className={`kb-tab-item ${filterBrand === tab.key ? "active" : ""}`}
              onClick={() => setFilterBrand(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="kb-search-bar">
          <SearchIcon />
          <input
            type="text"
            placeholder="規約名・カテゴリで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="kb-search-input"
          />
          {search && (
            <button className="kb-search-clear" onClick={() => setSearch("")}>✕</button>
          )}
        </div>

        <div className="kb-result-count">
          {search ? `検索結果: ${filtered.length} 件` : `${filtered.length} 件表示中`}
        </div>

        <div className="kb-terms-list">
          {Object.entries(groupedByBrand).map(([brand, items]) => {
            const brandConf = BRAND_CONFIG[brand] || { color: "#64748b", bg: "#f1f5f9" };
            const isOpen = expandedBrands[brand] !== false;
            return (
              <div key={brand} className="kb-brand-group">
                <button
                  className="kb-brand-header"
                  onClick={() => setExpandedBrands((p) => ({ ...p, [brand]: !isOpen }))}
                  style={{ borderLeftColor: brandConf.color }}
                >
                  <div className="kb-brand-header-left">
                    <span className={`kb-chevron ${isOpen ? "expanded" : ""}`}><ChevronRightSmallIcon /></span>
                    <span className="kb-brand-badge" style={{ backgroundColor: brandConf.bg, color: brandConf.color }}>{brand}</span>
                    <span className="kb-brand-meta">{items.length} 件</span>
                  </div>
                </button>

                {isOpen && (
                  <ul className="kb-term-items">
                    {items.map((m) => {
                      const stored = m.storedTerm;
                      const versionLabel = stored
                        ? (stored.versions.find((v) => v.isCurrent)?.label
                          ?? stored.versions[stored.versions.length - 1]?.label
                          ?? "")
                        : "";
                      return (
                        <li key={m.termId} className="kb-term-item">
                          <span className="kb-term-dot" style={{ backgroundColor: brandConf.color }} />
                          <div className="kb-term-main">
                            <div className="kb-term-title-row">
                              <span className="kb-term-title">{m.baseTitle}</span>
                              {versionLabel && <span className="kb-version-chip">{versionLabel}</span>}
                              {stored && <span className="kb-term-has-content">編集済</span>}
                            </div>
                            <div className="kb-term-meta-row">
                              {m.variants.length > 0 && (
                                <span className="kb-meta-label">
                                  バリアント: {m.variants.map((v) => (
                                    <span key={v} className="kb-variant-chip">{v}</span>
                                  ))}
                                </span>
                              )}
                              {m.categories.length > 0 && (
                                <span className="kb-meta-label">
                                  使用カテゴリ: {m.categories.slice(0, 4).map((c) => (
                                    <span key={c} className="kb-category-chip">{c}</span>
                                  ))}
                                  {m.categories.length > 4 && <span className="kb-category-more">+{m.categories.length - 4}</span>}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="kb-term-actions">
                            {isAdmin && (
                              <button className="kb-term-edit-btn primary" onClick={() => openEditor(m, "edit")}>
                                編集
                              </button>
                            )}
                            <button className="kb-term-edit-btn" onClick={() => openEditor(m, "view")}>
                              閲覧
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && !loading && (
            <div className="kb-empty-state">該当する規約がありません</div>
          )}
        </div>
      </main>

      {showCreateModal && (
        <CreateTermModal onClose={() => setShowCreateModal(false)} onCreate={createNewTerm} />
      )}

      {toast && (
        <div className={`kb-toast ${toast.type === "error" ? "kb-toast-error" : "kb-toast-success"}`}>
          {toast.message}
        </div>
      )}

      <style jsx global>{`${STYLES}`}</style>
    </div>
  );
}

// ============ EDITOR ============
type EditorProps = {
  term: StoreTerm;
  currentVersion: TermVersion | null;
  currentContent: string;
  editingVariant: string;
  editingVersionId: string;
  pdfUrl: string;
  pdfGenerating: boolean;
  saving: boolean;
  toast: { message: string; type: "success" | "error" } | null;
  canEdit: boolean;
  onSwitchToEdit?: () => void;
  onChangeVariant: (v: string) => void;
  onChangeVersion: (id: string) => void;
  onAddVersion: () => void;
  onDeleteVersion: (id: string) => void;
  onSetAsCurrent: (id: string) => void;
  onUpdateVersionMeta: (patch: Partial<TermVersion>) => void;
  onChangeContent: (next: string) => void;
  onChangeBaseTitle: (next: string) => void;
  onToggleRequired: (next: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onExportPdfUrl: () => void;
};

function EditorView(p: EditorProps) {
  const brandConf = BRAND_CONFIG[p.term.brand] || { color: "#64748b", bg: "#f1f5f9" };
  const variantKeys = p.term.variants.length > 0 ? p.term.variants : [DEFAULT_VARIANT_KEY];

  return (
    <div className="kb-store-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <button className="kb-back-link" onClick={p.onClose}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronLeftIcon /> 一覧へ戻る
            </span>
          </button>
          <div style={{ fontWeight: 700 }}>{p.canEdit ? "規約編集" : "規約閲覧"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!p.canEdit && p.onSwitchToEdit && (
              <button className="kb-btn-secondary" onClick={p.onSwitchToEdit}>
                編集モードへ
              </button>
            )}
            {p.canEdit ? (
              <button className="kb-btn-save" onClick={p.onSave} disabled={p.saving}>
                {p.saving ? "保存中..." : "保存"}
              </button>
            ) : (
              <span className="kb-role-badge">閲覧モード</span>
            )}
          </div>
        </div>
      </div>

      <main className="kb-main-container kb-editor-main">
        {/* Title > Version 表示 */}
        <div className="kb-editor-header">
          <div className="kb-editor-header-meta">
            <span className="kb-brand-badge" style={{ backgroundColor: brandConf.bg, color: brandConf.color }}>
              {p.term.brand}
            </span>
            {p.term.categories.length > 0 && (
              <span className="kb-editor-categories">
                {p.term.categories.slice(0, 3).map((c) => (
                  <span key={c} className="kb-category-chip">{c}</span>
                ))}
                {p.term.categories.length > 3 && <span className="kb-category-more">+{p.term.categories.length - 3}</span>}
              </span>
            )}
            {/* 同意必須/任意フラグ (公開APIの isRequired に反映) */}
            {p.canEdit ? (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={p.term.isRequired === true}
                  onChange={(e) => p.onToggleRequired(e.target.checked)}
                />
                同意必須
              </label>
            ) : (
              <span className="kb-category-chip">{p.term.isRequired ? "同意必須" : "任意"}</span>
            )}
          </div>
          {p.canEdit ? (
            <input
              type="text"
              className="kb-editor-title-input"
              value={p.term.baseTitle}
              onChange={(e) => p.onChangeBaseTitle(e.target.value)}
              placeholder="基本タイトル"
            />
          ) : (
            <h1 className="kb-editor-title">{p.term.baseTitle}</h1>
          )}
          {p.currentVersion && (
            <div className="kb-editor-version-sub">
              バージョン: <strong>{p.currentVersion.label}</strong>
              <span className="kb-version-date">({p.currentVersion.createdAt})</span>
              {p.currentVersion.isCurrent && <span className="kb-current-tag">現行</span>}
            </div>
          )}
        </div>

        {/* Versions bar */}
        <section className="kb-section">
          <div className="kb-section-header">
            <h3 className="kb-section-title">バージョン履歴</h3>
            {p.canEdit && (
              <button className="kb-btn-secondary" onClick={p.onAddVersion}>
                <PlusIcon /> 新規バージョンを作成
              </button>
            )}
          </div>
          <div className="kb-versions-row">
            {p.term.versions.map((v) => (
              <div
                key={v.id}
                className={`kb-version-card ${v.id === p.editingVersionId ? "active" : ""} ${v.isCurrent ? "current" : ""}`}
                onClick={() => p.onChangeVersion(v.id)}
              >
                <div className="kb-version-card-top">
                  <span className="kb-version-card-label">{v.label}</span>
                  {v.isCurrent && <span className="kb-current-tag">現行</span>}
                </div>
                <div className="kb-version-card-date">{v.createdAt}</div>
                {v.note && <div className="kb-version-card-note">{v.note}</div>}
                {p.canEdit && (
                  <div className="kb-version-card-actions">
                    {!v.isCurrent && (
                      <button
                        className="kb-mini-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onSetAsCurrent(v.id);
                        }}
                      >
                        現行にする
                      </button>
                    )}
                    <button
                      className="kb-mini-btn danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`バージョン ${v.label} を削除しますか?`)) p.onDeleteVersion(v.id);
                      }}
                    >
                      削除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Version meta (label / date / note) */}
        {p.currentVersion && (
          <section className="kb-section">
            <h3 className="kb-section-title">バージョン情報</h3>
            <div className="kb-version-meta-grid">
              <label className="kb-field">
                <span className="kb-field-label">ラベル</span>
                <input
                  type="text"
                  className="kb-input"
                  value={p.currentVersion.label}
                  onChange={(e) => p.onUpdateVersionMeta({ label: e.target.value })}
                  readOnly={!p.canEdit}
                />
              </label>
              <label className="kb-field">
                <span className="kb-field-label">作成日</span>
                <input
                  type="date"
                  className="kb-input"
                  value={p.currentVersion.createdAt}
                  onChange={(e) => p.onUpdateVersionMeta({ createdAt: e.target.value })}
                  readOnly={!p.canEdit}
                />
              </label>
              <label className="kb-field kb-field-wide">
                <span className="kb-field-label">改訂メモ</span>
                <input
                  type="text"
                  className="kb-input"
                  placeholder="改訂内容のメモ"
                  value={p.currentVersion.note}
                  onChange={(e) => p.onUpdateVersionMeta({ note: e.target.value })}
                  readOnly={!p.canEdit}
                />
              </label>
            </div>
          </section>
        )}

        {/* Variant tabs */}
        {variantKeys.length > 1 && (
          <section className="kb-section">
            <h3 className="kb-section-title">バリアント</h3>
            <div className="kb-variant-tabs">
              {variantKeys.map((v) => (
                <button
                  key={v}
                  className={`kb-variant-tab ${p.editingVariant === v ? "active" : ""}`}
                  onClick={() => p.onChangeVariant(v)}
                >
                  {v === DEFAULT_VARIANT_KEY ? "(共通)" : v}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Free text editor */}
        <FreeTextEditor
          content={p.currentContent}
          onChange={p.onChangeContent}
          readOnly={!p.canEdit}
        />

        {/* Export */}
        <section className="kb-section">
          <h3 className="kb-section-title">出力</h3>
          <div className="kb-export-grid">
            <div className="kb-export-card">
              <div className="kb-export-card-header">
                <div className="kb-export-icon kb-export-icon-html">HTML</div>
                <div>
                  <div className="kb-export-card-title">HTML</div>
                  <div className="kb-export-card-desc">スタイル付きHTMLとして保存</div>
                </div>
              </div>
              <button className="kb-btn-export" onClick={p.onExportHtml} disabled={!p.currentContent.trim()}>
                HTMLダウンロード
              </button>
            </div>

            <div className="kb-export-card">
              <div className="kb-export-card-header">
                <div className="kb-export-icon kb-export-icon-pdf">PDF</div>
                <div>
                  <div className="kb-export-card-title">PDF</div>
                  <div className="kb-export-card-desc">A4形式のPDFとして保存</div>
                </div>
              </div>
              <button className="kb-btn-export" onClick={p.onExportPdf} disabled={!p.currentContent.trim() || p.pdfGenerating}>
                {p.pdfGenerating ? "生成中..." : "PDFダウンロード"}
              </button>
            </div>

            <div className="kb-export-card">
              <div className="kb-export-card-header">
                <div className="kb-export-icon kb-export-icon-url">URL</div>
                <div>
                  <div className="kb-export-card-title">PDF URL</div>
                  <div className="kb-export-card-desc">PDFを生成してURLを発行</div>
                </div>
              </div>
              <button className="kb-btn-export" onClick={p.onExportPdfUrl} disabled={!p.currentContent.trim() || p.pdfGenerating}>
                {p.pdfGenerating ? "生成中..." : "URL生成"}
              </button>
              {p.pdfUrl && (
                <div className="kb-pdf-url-box">
                  <input type="text" readOnly value={p.pdfUrl} className="kb-pdf-url-input" />
                  <button
                    className="kb-btn-copy"
                    onClick={() => {
                      navigator.clipboard.writeText(p.pdfUrl);
                    }}
                  >コピー</button>
                  <a href={p.pdfUrl} target="_blank" rel="noopener noreferrer" className="kb-btn-open">開く</a>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {p.toast && (
        <div className={`kb-toast ${p.toast.type === "error" ? "kb-toast-error" : "kb-toast-success"}`}>
          {p.toast.message}
        </div>
      )}

      <style jsx global>{`${STYLES}`}</style>
    </div>
  );
}

// ============ FreeTextEditor ============
function FreeTextEditor({
  content,
  onChange,
  readOnly = false,
}: {
  content: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
}) {
  // 閲覧者にはプレビュー固定で開く
  const [tab, setTab] = useState<"edit" | "preview">(readOnly ? "preview" : "edit");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 選択範囲をタグで包む。未選択ならカーソル位置に挿入。
  const insert = (before: string, after = "", placeholder = "") => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.substring(start, end);
    const middle = selected || placeholder;
    const next = content.substring(0, start) + before + middle + after + content.substring(end);
    onChange(next);
    setTimeout(() => {
      ta.focus();
      const cursor = start + before.length + middle.length;
      ta.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const previewHtml = useMemo(() => contentToHtml(content), [content]);

  return (
    <section className="kb-section">
      <div className="kb-freetext-toolbar">
        <div className="kb-freetext-tabs">
          {!readOnly && (
            <button
              className={`kb-freetext-tab ${tab === "edit" ? "active" : ""}`}
              onClick={() => setTab("edit")}
            >編集</button>
          )}
          <button
            className={`kb-freetext-tab ${tab === "preview" ? "active" : ""}`}
            onClick={() => setTab("preview")}
          >プレビュー</button>
        </div>
        {!readOnly && tab === "edit" && (
          <div className="kb-freetext-helpers">
            <span className="kb-freetext-helper-label">挿入:</span>
            <button className="kb-tag-btn" onClick={() => insert("<h2>", "</h2>", "見出し")}>H2</button>
            <button className="kb-tag-btn" onClick={() => insert("<h3>", "</h3>", "見出し")}>H3</button>
            <button className="kb-tag-btn" onClick={() => insert("<strong>", "</strong>", "強調")}>B</button>
            <button className="kb-tag-btn" onClick={() => insert("<ul>\n  <li>", "</li>\n</ul>", "項目")}>UL</button>
            <button className="kb-tag-btn" onClick={() => insert("<ol>\n  <li>", "</li>\n</ol>", "項目")}>OL</button>
            <button className="kb-tag-btn" onClick={() => insert("<li>", "</li>", "項目")}>LI</button>
            <button className="kb-tag-btn" onClick={() => insert("\n<p>", "</p>\n", "段落")}>P</button>
            <button className="kb-tag-btn" onClick={() => insert("<br/>")}>BR</button>
          </div>
        )}
      </div>

      {!readOnly && tab === "edit" ? (
        <textarea
          ref={taRef}
          className="kb-freetext-area"
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder={"ここに規約本文を自由に入力してください。\n\n例:\n第1条（目的）\n本規約は、〇〇に関する事項を定めるものとします。\n\nHTML タグの利用も可能です。上の挿入ボタンから見出し・リスト等を追加できます。"}
        />
      ) : (
        <div className="kb-freetext-preview">
          {content.trim() ? (
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <p className="kb-preview-empty">本文がありません</p>
          )}
        </div>
      )}
    </section>
  );
}

// ============ Create Modal ============
function CreateTermModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (brand: string, baseTitle: string, variantsCsv: string) => void;
}) {
  const [brand, setBrand] = useState(BRANDS[0]);
  const [baseTitle, setBaseTitle] = useState("");
  const [variantsCsv, setVariantsCsv] = useState("");
  return (
    <div className="kb-modal-overlay" onClick={onClose}>
      <div className="kb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kb-modal-header">
          <h2>新規規約を追加</h2>
          <button className="kb-icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="kb-modal-body">
          <label className="kb-field">
            <span className="kb-field-label">ブランド</span>
            <select className="kb-input" value={brand} onChange={(e) => setBrand(e.target.value)}>
              {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="kb-field">
            <span className="kb-field-label">基本タイトル</span>
            <input
              className="kb-input"
              type="text"
              placeholder="例: 利用規約"
              value={baseTitle}
              onChange={(e) => setBaseTitle(e.target.value)}
            />
          </label>
          <label className="kb-field">
            <span className="kb-field-label">バリアント (任意)</span>
            <input
              className="kb-input"
              type="text"
              placeholder="例: 赤, 青, 緑 (カンマ区切り)"
              value={variantsCsv}
              onChange={(e) => setVariantsCsv(e.target.value)}
            />
            <span className="kb-field-help">複数色やコース別など、規約内で切替えたい単位</span>
          </label>
        </div>
        <div className="kb-modal-footer">
          <button className="kb-btn-secondary" onClick={onClose}>キャンセル</button>
          <button
            className="kb-btn-primary"
            disabled={!baseTitle.trim()}
            onClick={() => onCreate(brand, baseTitle.trim(), variantsCsv)}
          >作成して編集へ</button>
        </div>
      </div>
    </div>
  );
}

// ============ Styles ============
const STYLES = `
  .kb-store-root { background-color: #f8fafc; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #0f172a; }
  .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
  .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
  .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; display: flex; align-items: center; transition: color 0.2s; background: none; border: none; cursor: pointer; }
  .kb-back-link:hover { color: #3b82f6; }
  .kb-main-container { max-width: 1000px; margin: 0 auto; padding: 32px 24px 80px; }
  .kb-editor-main { max-width: 1100px; }

  .kb-page-header { margin-bottom: 24px; }
  .kb-page-header-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }
  .kb-page-header h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px 0; }
  .kb-page-header p { font-size: 13px; color: #64748b; margin: 0; }

  .kb-btn-primary { display: inline-flex; align-items: center; gap: 6px; background: #3b82f6; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
  .kb-btn-primary:hover:not(:disabled) { background: #2563eb; }
  .kb-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .kb-btn-secondary { display: inline-flex; align-items: center; gap: 6px; background: #fff; color: #475569; border: 1px solid #e2e8f0; padding: 8px 14px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
  .kb-btn-secondary:hover { background: #f1f5f9; }

  .kb-tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
  .kb-tab-item { background: transparent; border: none; padding: 10px 16px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; white-space: nowrap; }
  .kb-tab-item:hover { color: #3b82f6; }
  .kb-tab-item.active { color: #3b82f6; border-bottom-color: #3b82f6; }

  .kb-search-bar { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 16px; margin-bottom: 12px; }
  .kb-search-input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; }
  .kb-search-clear { background: none; border: none; font-size: 16px; color: #94a3b8; cursor: pointer; padding: 0 4px; }
  .kb-search-clear:hover { color: #64748b; }
  .kb-result-count { font-size: 12px; color: #64748b; margin-bottom: 12px; }

  .kb-terms-list { display: flex; flex-direction: column; gap: 12px; }
  .kb-brand-group { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .kb-brand-header { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #fff; border: none; border-left: 4px solid; cursor: pointer; }
  .kb-brand-header:hover { background: #f8fafc; }
  .kb-brand-header-left { display: flex; align-items: center; gap: 12px; }
  .kb-brand-badge { padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: 700; }
  .kb-brand-meta { font-size: 12px; color: #94a3b8; }

  .kb-chevron { display: flex; align-items: center; transition: transform 0.2s; color: #94a3b8; }
  .kb-chevron.expanded { transform: rotate(90deg); }

  .kb-term-items { list-style: none; margin: 0; padding: 0; border-top: 1px solid #f1f5f9; }
  .kb-term-item { display: flex; align-items: flex-start; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #f8fafc; }
  .kb-term-item:last-child { border-bottom: none; }
  .kb-term-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }
  .kb-term-main { flex: 1; min-width: 0; }
  .kb-term-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .kb-term-title { font-size: 14px; font-weight: 600; color: #0f172a; }
  .kb-version-chip { font-size: 11px; color: #2563eb; background: #eff6ff; padding: 2px 8px; border-radius: 4px; font-weight: 700; }
  .kb-term-has-content { font-size: 11px; color: #10b981; background: #ecfdf5; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
  .kb-term-meta-row { font-size: 11px; color: #64748b; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 14px; }
  .kb-meta-label { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .kb-variant-chip { font-size: 10px; color: #7c3aed; background: #ede9fe; padding: 2px 6px; border-radius: 4px; font-weight: 600; margin-left: 4px; }
  .kb-category-chip { font-size: 10px; color: #475569; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }
  .kb-category-more { font-size: 10px; color: #94a3b8; margin-left: 4px; }

  .kb-term-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .kb-term-edit-btn { background: none; border: 1px solid #e2e8f0; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer; white-space: nowrap; }
  .kb-term-edit-btn:hover { background: #eff6ff; border-color: #3b82f6; color: #3b82f6; }
  .kb-term-edit-btn.primary { background: #eff6ff; border-color: #93c5fd; color: #2563eb; }
  .kb-term-edit-btn.primary:hover { background: #dbeafe; border-color: #3b82f6; }

  .kb-empty-state { text-align: center; padding: 60px 20px; color: #94a3b8; font-size: 14px; }

  /* Editor */
  .kb-editor-header { margin-bottom: 28px; }
  .kb-editor-header-meta { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .kb-editor-categories { font-size: 11px; color: #64748b; }
  .kb-editor-title { font-size: 24px; font-weight: 800; margin: 4px 0 8px 0; }
  .kb-editor-title-input { font-size: 24px; font-weight: 800; width: 100%; margin: 4px 0 8px 0; padding: 6px 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #0f172a; box-sizing: border-box; outline: none; transition: all 0.15s; }
  .kb-editor-title-input:hover { border-color: #e2e8f0; }
  .kb-editor-title-input:focus { border-color: #3b82f6; background: #fff; }
  .kb-role-badge { display: inline-block; margin-left: 8px; padding: 2px 10px; border-radius: 4px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; vertical-align: middle; }
  .kb-editor-version-sub { font-size: 13px; color: #475569; display: flex; align-items: center; gap: 8px; }
  .kb-version-date { color: #94a3b8; }
  .kb-current-tag { font-size: 10px; font-weight: 700; color: #fff; background: #10b981; padding: 2px 8px; border-radius: 4px; }

  .kb-btn-save { background: #3b82f6; color: #fff; border: none; padding: 8px 20px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; }
  .kb-btn-save:hover:not(:disabled) { background: #2563eb; }
  .kb-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

  .kb-section { margin-bottom: 28px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
  .kb-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .kb-section-title { font-size: 14px; font-weight: 700; margin: 0 0 12px 0; color: #334155; }
  .kb-section-header .kb-section-title { margin: 0; }

  .kb-versions-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; }
  .kb-version-card { flex: 0 0 200px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; cursor: pointer; background: #fff; transition: all 0.15s; }
  .kb-version-card:hover { border-color: #93c5fd; }
  .kb-version-card.active { border-color: #3b82f6; background: #eff6ff; box-shadow: 0 0 0 1px #3b82f6 inset; }
  .kb-version-card.current { border-left: 3px solid #10b981; }
  .kb-version-card-top { display: flex; justify-content: space-between; align-items: center; }
  .kb-version-card-label { font-weight: 700; font-size: 13px; color: #0f172a; }
  .kb-version-card-date { font-size: 11px; color: #64748b; margin-top: 4px; }
  .kb-version-card-note { font-size: 11px; color: #475569; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kb-version-card-actions { display: flex; gap: 6px; margin-top: 8px; }
  .kb-mini-btn { font-size: 11px; padding: 3px 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; color: #475569; cursor: pointer; }
  .kb-mini-btn:hover { background: #f1f5f9; }
  .kb-mini-btn.danger { color: #dc2626; }
  .kb-mini-btn.danger:hover { background: #fef2f2; }

  .kb-version-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
  .kb-field { display: flex; flex-direction: column; gap: 4px; }
  .kb-field-wide { grid-column: 1 / -1; }
  .kb-field-label { font-size: 11px; font-weight: 600; color: #64748b; }
  .kb-field-help { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .kb-input { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; background: #fff; color: #0f172a; outline: none; transition: border-color 0.15s; }
  .kb-input:focus { border-color: #3b82f6; }
  .kb-input-sm { padding: 4px 8px; font-size: 12px; }
  .kb-textarea { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; background: #fff; color: #0f172a; outline: none; font-family: inherit; resize: vertical; width: 100%; box-sizing: border-box; }
  .kb-textarea:focus { border-color: #3b82f6; }
  .kb-textarea-sm { font-size: 12px; padding: 4px 8px; min-height: 28px; }

  .kb-variant-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
  .kb-variant-tab { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; }
  .kb-variant-tab:hover { background: #f1f5f9; }
  .kb-variant-tab.active { background: #eff6ff; border-color: #3b82f6; color: #2563eb; }

  .kb-icon-btn { background: none; border: 1px solid transparent; padding: 4px 6px; border-radius: 4px; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
  .kb-icon-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #e2e8f0; color: #334155; }

  /* Free text editor */
  .kb-freetext-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px 8px 0 0; flex-wrap: wrap; gap: 8px; }
  .kb-freetext-tabs { display: flex; gap: 4px; }
  .kb-freetext-tab { background: none; border: none; padding: 6px 14px; font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer; border-radius: 4px; }
  .kb-freetext-tab:hover { background: #f1f5f9; }
  .kb-freetext-tab.active { background: #eff6ff; color: #2563eb; }
  .kb-freetext-helpers { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .kb-freetext-helper-label { font-size: 11px; color: #94a3b8; font-weight: 600; margin-right: 4px; }
  .kb-tag-btn { background: #fff; border: 1px solid #e2e8f0; padding: 3px 9px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #475569; cursor: pointer; font-family: monospace; }
  .kb-tag-btn:hover { background: #eff6ff; border-color: #93c5fd; color: #2563eb; }
  .kb-freetext-area { width: 100%; min-height: 400px; padding: 16px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; outline: none; font-family: "SF Mono", "Fira Code", monospace; font-size: 13px; line-height: 1.7; resize: vertical; box-sizing: border-box; background: #fff; }
  .kb-freetext-area:focus { border-color: #3b82f6; }
  .kb-freetext-preview { padding: 20px 24px; background: #fff; min-height: 400px; font-size: 14px; line-height: 1.8; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }
  .kb-freetext-preview h1 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 8px; }
  .kb-freetext-preview h2 { font-size: 17px; margin-top: 20px; }
  .kb-freetext-preview h3 { font-size: 15px; margin-top: 16px; }
  .kb-freetext-preview p { margin: 8px 0; }
  .kb-freetext-preview ul, .kb-freetext-preview ol { padding-left: 24px; }
  .kb-freetext-preview table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  .kb-freetext-preview th, .kb-freetext-preview td { border: 1px solid #e2e8f0; padding: 8px; }
  .kb-freetext-preview th { background: #f8fafc; }
  .kb-preview-empty { color: #94a3b8; font-style: italic; }

  /* Export */
  .kb-export-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .kb-export-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; background: #fff; }
  .kb-export-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .kb-export-icon { width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: #fff; flex-shrink: 0; }
  .kb-export-icon-html { background: #f97316; }
  .kb-export-icon-pdf { background: #dc2626; }
  .kb-export-icon-url { background: #7c3aed; }
  .kb-export-card-title { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
  .kb-export-card-desc { font-size: 11px; color: #64748b; }
  .kb-btn-export { width: 100%; background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #334155; cursor: pointer; }
  .kb-btn-export:hover:not(:disabled) { background: #eff6ff; border-color: #93c5fd; color: #2563eb; }
  .kb-btn-export:disabled { opacity: 0.5; cursor: not-allowed; }
  .kb-pdf-url-box { margin-top: 10px; display: flex; gap: 6px; align-items: center; }
  .kb-pdf-url-input { flex: 1; padding: 6px 8px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 11px; background: #f8fafc; color: #475569; min-width: 0; }
  .kb-btn-copy, .kb-btn-open { background: none; border: 1px solid #e2e8f0; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #64748b; cursor: pointer; text-decoration: none; white-space: nowrap; }
  .kb-btn-copy:hover, .kb-btn-open:hover { background: #f1f5f9; }

  /* Modal */
  .kb-modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }
  .kb-modal { background: #fff; border-radius: 12px; max-width: 480px; width: 90%; box-shadow: 0 20px 50px rgba(0,0,0,0.2); }
  .kb-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
  .kb-modal-header h2 { font-size: 16px; font-weight: 700; margin: 0; }
  .kb-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .kb-modal-footer { padding: 12px 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 8px; }

  /* Toast */
  .kb-toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: slideUp 0.3s ease; }
  .kb-toast-success { background: #10b981; color: #fff; }
  .kb-toast-error { background: #ef4444; color: #fff; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
`;
