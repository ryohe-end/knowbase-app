"use client";

// 仕様書・標準図 — 閲覧画面(全ログインユーザー・読み取り専用)。
// 管理画面(/design/specs、設計担当のみ)とは明確に別URL。
// データは /api/design/specs(viewScopeで絞り込み)。
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SpecDocument } from "@/types/specDocument";
import { SPEC_DOC_TYPES, SPEC_BRANDS } from "@/types/specDocument";

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";
const isPdf = (ct?: string, name?: string) =>
  String(ct || "").includes("pdf") || /\.pdf$/i.test(String(name || ""));
const dlBase = (specId: string, key: string) =>
  `/api/design/specs/download?specId=${encodeURIComponent(specId)}&key=${encodeURIComponent(key)}&redirect=1`;

export default function SpecsViewerPage() {
  const [list, setList] = useState<SpecDocument[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState("");
  const [brand, setBrand] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<SpecDocument | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/design/specs", { cache: "no-store" });
      const d = await res.json();
      if (res.ok && d.ok) { setList(d.specs || []); setCanEdit(!!d.canEdit); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return list.filter((s) => {
      if (docType && s.docType !== docType) return false;
      if (brand && s.brandId !== brand && s.brandId !== "ALL") return false;
      if (kw) {
        const hay = [s.title, s.desc, s.version, (s.tags || []).join(" "), s.categoryId].join(" ").toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [list, docType, brand, q]);

  return (
    <div className="kb-design-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/" className="kb-back-link">← ホームへ戻る</Link>
          <div style={{ fontWeight: 700 }}>仕様書・標準図</div>
          {canEdit
            ? <Link href="/design/specs" className="sp-manage-btn">管理画面 →</Link>
            : <span style={{ width: 92 }} />}
        </div>
      </div>

      <main className="kb-main-container">
        <header className="kb-page-header">
          <div className="kb-badge">閲覧</div>
          <h1>仕様書・標準図</h1>
          <p>仕様書・標準図(PDF/CAD)を種別・ブランドで探せます。PDFはブラウザで閲覧、CADはダウンロードできます。</p>
        </header>

        <div className="sp-filters">
          <input className="sp-search" placeholder="タイトル・タグ・版で検索" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">種別: すべて</option>
            {SPEC_DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">ブランド: すべて</option>
            {SPEC_BRANDS.filter((b) => b !== "ALL").map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <span className="sp-count">{filtered.length}件</span>
        </div>

        {loading ? (
          <div className="sp-empty">読み込み中…</div>
        ) : filtered.length === 0 ? (
          <div className="sp-empty">該当する資料がありません。</div>
        ) : (
          <div className="sp-grid">
            {filtered.map((s) => (
              <button key={s.specId} className="sp-card" onClick={() => setSel(s)}>
                <div className="sp-card-top">
                  <span className={`sp-tag sp-tag-${s.docType === "標準図" ? "cad" : "doc"}`}>{s.docType}</span>
                  {s.brandId !== "ALL" && <span className="sp-tag sp-tag-brand">{s.brandId}</span>}
                  {s.version && <span className="sp-ver">{s.version}</span>}
                </div>
                <div className="sp-card-title">{s.title}</div>
                {s.desc && <div className="sp-card-desc">{s.desc}</div>}
                <div className="sp-card-foot">
                  <span>📎 {(s.files || []).length}</span>
                  <span>更新 {fmt(s.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {sel && (
        <div className="sp-modal-bg" onClick={() => setSel(null)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sp-modal-head">
              <div>
                <span className={`sp-tag sp-tag-${sel.docType === "標準図" ? "cad" : "doc"}`}>{sel.docType}</span>
                {sel.brandId !== "ALL" && <span className="sp-tag sp-tag-brand">{sel.brandId}</span>}
                {sel.version && <span className="sp-ver">{sel.version}</span>}
              </div>
              <button className="sp-x" onClick={() => setSel(null)}>×</button>
            </div>
            <h2 className="sp-modal-title">{sel.title}</h2>
            {sel.desc && <p className="sp-modal-desc">{sel.desc}</p>}
            {(sel.tags || []).length > 0 && (
              <div className="sp-tags">{(sel.tags || []).map((t) => <span key={t} className="sp-chip">#{t}</span>)}</div>
            )}
            <div className="sp-files">
              {(sel.files || []).length === 0 && <div className="sp-empty">ファイルがありません。</div>}
              {(sel.files || []).map((f) => (
                <div key={f.key} className="sp-file">
                  <div className="sp-file-name">📄 {f.name}</div>
                  <div className="sp-file-actions">
                    {isPdf(f.contentType, f.name) && (
                      <a className="sp-btn sp-btn-ghost" href={`${dlBase(sel.specId, f.key)}&inline=1`} target="_blank" rel="noreferrer">閲覧</a>
                    )}
                    <a className="sp-btn" href={dlBase(sel.specId, f.key)}>ダウンロード</a>
                  </div>
                </div>
              ))}
            </div>
            <div className="sp-modal-meta">登録: {sel.createdBy || "—"} / 更新 {fmt(sel.updatedAt)}</div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .kb-design-root { background:#f8fafc; min-height:100vh; font-family:sans-serif; color:#0f172a; }
        .kb-topbar { height:60px; background:#fff; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; position:sticky; top:0; z-index:100; }
        .kb-topbar-inner { width:100%; max-width:1200px; margin:0 auto; padding:0 24px; display:flex; justify-content:space-between; align-items:center; }
        .kb-back-link { text-decoration:none; font-size:13px; font-weight:600; color:#64748b; }
        .kb-main-container { max-width:1140px; margin:0 auto; padding:32px 24px; }
        .kb-page-header { margin-bottom:24px; }
        .kb-badge { display:inline-block; font-size:10px; font-weight:800; letter-spacing:0.1em; color:#0f172a; background:#e2e8f0; padding:4px 10px; border-radius:4px; margin-bottom:12px; }
        .kb-page-header h1 { font-size:26px; font-weight:800; margin:0 0 8px; }
        .kb-page-header p { font-size:13.5px; color:#64748b; margin:0; line-height:1.7; }
      `}</style>
      <style jsx>{`
        .sp-manage-btn { text-decoration:none; font-size:12.5px; font-weight:700; color:#fff; background:#334155; padding:8px 14px; border-radius:8px; }
        .sp-filters { display:flex; gap:10px; align-items:center; margin-bottom:18px; flex-wrap:wrap; }
        .sp-search { flex:1; min-width:200px; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; }
        .sp-filters select { padding:9px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; background:#fff; }
        .sp-count { font-size:12px; color:#64748b; font-weight:600; }
        .sp-empty { padding:48px; text-align:center; color:#94a3b8; font-size:14px; }
        .sp-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px; }
        .sp-card { text-align:left; background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:16px; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:transform .15s, box-shadow .15s; }
        .sp-card:hover { transform:translateY(-3px); box-shadow:0 10px 18px -8px rgba(0,0,0,0.12); border-color:#bfdbfe; }
        .sp-card-top { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
        .sp-card-title { font-size:15px; font-weight:800; line-height:1.4; }
        .sp-card-desc { font-size:12px; color:#64748b; line-height:1.55; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .sp-card-foot { display:flex; justify-content:space-between; font-size:11.5px; color:#94a3b8; margin-top:auto; padding-top:6px; }
        .sp-tag { font-size:10.5px; font-weight:800; padding:3px 8px; border-radius:6px; }
        .sp-tag-doc { background:#dbeafe; color:#1d4ed8; }
        .sp-tag-cad { background:#dcfce7; color:#15803d; }
        .sp-tag-brand { background:#f1f5f9; color:#475569; }
        .sp-ver { font-size:11px; color:#64748b; font-weight:600; }
        .sp-modal-bg { position:fixed; inset:0; background:rgba(15,23,42,0.45); display:flex; align-items:center; justify-content:center; z-index:200; padding:20px; }
        .sp-modal { background:#fff; border-radius:16px; width:100%; max-width:560px; max-height:85vh; overflow:auto; padding:22px; }
        .sp-modal-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
        .sp-x { border:none; background:none; font-size:24px; color:#94a3b8; cursor:pointer; line-height:1; }
        .sp-modal-title { font-size:20px; font-weight:800; margin:12px 0 8px; }
        .sp-modal-desc { font-size:13px; color:#475569; line-height:1.7; white-space:pre-wrap; margin:0 0 12px; }
        .sp-tags { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
        .sp-chip { font-size:11px; color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:20px; }
        .sp-files { display:flex; flex-direction:column; gap:8px; }
        .sp-file { display:flex; justify-content:space-between; align-items:center; gap:10px; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; }
        .sp-file-name { font-size:13px; font-weight:600; word-break:break-all; }
        .sp-file-actions { display:flex; gap:6px; flex-shrink:0; }
        .sp-btn { text-decoration:none; font-size:12px; font-weight:700; color:#fff; background:#2563eb; padding:7px 12px; border-radius:7px; }
        .sp-btn-ghost { background:#eff6ff; color:#1d4ed8; }
        .sp-modal-meta { margin-top:16px; font-size:11.5px; color:#94a3b8; }
      `}</style>
    </div>
  );
}
