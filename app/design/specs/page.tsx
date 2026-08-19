"use client";

// 仕様書・標準図 — 管理画面(設計担当のみ / 登録・編集・削除・版管理)。
// 閲覧画面(/specs、全ログインユーザー)とは明確に別URL。
// 版(バージョン)を追加/現行切替(revert)/削除できる。最新を追加すると自動的に現行になる。
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SpecDocument, SpecFile } from "@/types/specDocument";
import { SPEC_DOC_TYPES, SPEC_BRANDS, SPEC_VIEW_SCOPES, versionsNewestFirst } from "@/types/specDocument";

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";

type VForm = { versionId?: string; label: string; note: string; files: SpecFile[]; isCurrent: boolean; createdAt?: string };
type FormState = {
  specId?: string;
  title: string; desc: string; docType: string; brandId: string;
  viewScope: string; categoryId: string; tags: string;
  versions: VForm[];
};
const newVersion = (isCurrent: boolean): VForm => ({ label: "", note: "", files: [], isCurrent });
const EMPTY: FormState = {
  title: "", desc: "", docType: "仕様書", brandId: "ALL",
  viewScope: "ALL", categoryId: "", tags: "", versions: [newVersion(true)],
};

export default function SpecsManagePage() {
  const [list, setList] = useState<SpecDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<{ k: "ok" | "err"; m: string } | null>(null);
  const [denied, setDenied] = useState(false);

  const notify = (k: "ok" | "err", m: string) => { setToast({ k, m }); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/design/specs", { cache: "no-store" });
      const d = await res.json();
      if (res.status === 401) { setDenied(true); return; }
      if (res.ok && d.ok) { setList(d.specs || []); if (!d.canEdit) setDenied(true); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const startNew = () => { setForm({ ...EMPTY, versions: [newVersion(true)] }); setEditing(true); };
  const startEdit = (s: SpecDocument) => {
    const versions = versionsNewestFirst(s).map((v) => ({
      versionId: v.versionId, label: v.label || "", note: v.note || "",
      files: v.files || [], isCurrent: v.isCurrent, createdAt: v.createdAt,
    }));
    setForm({
      specId: s.specId, title: s.title, desc: s.desc || "", docType: s.docType,
      brandId: s.brandId, viewScope: s.viewScope, categoryId: s.categoryId || "",
      tags: (s.tags || []).join(", "), versions: versions.length ? versions : [newVersion(true)],
    });
    setEditing(true);
  };
  const cancel = () => { setForm(EMPTY); setEditing(false); };

  // 版操作
  const addVersion = () => setForm((f) => ({ ...f, versions: [newVersion(true), ...f.versions.map((v) => ({ ...v, isCurrent: false }))] }));
  const setCurrent = (idx: number) => setForm((f) => ({ ...f, versions: f.versions.map((v, i) => ({ ...v, isCurrent: i === idx })) }));
  const removeVersion = (idx: number) => setForm((f) => {
    if (f.versions.length <= 1) return f;
    const versions = f.versions.filter((_, i) => i !== idx);
    if (!versions.some((v) => v.isCurrent)) versions[0].isCurrent = true; // 現行を消したら先頭を現行に
    return { ...f, versions };
  });
  const patchVersion = (idx: number, patch: Partial<VForm>) =>
    setForm((f) => ({ ...f, versions: f.versions.map((v, i) => (i === idx ? { ...v, ...patch } : v)) }));

  // S3 署名付きPUTでファイルをアップロードし、指定版の files[] に追加
  const onPickFiles = async (idx: number, fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploadingIdx(idx);
    try {
      const added: SpecFile[] = [];
      for (const file of Array.from(fileList)) {
        const ct = file.type || "application/octet-stream";
        const pres = await fetch("/api/design/specs/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType: ct, size: file.size }),
        });
        const pd = await pres.json();
        if (!pres.ok || !pd.ok) { notify("err", `${file.name}: ${pd?.error || "アップロード準備失敗"}`); continue; }
        const put = await fetch(pd.url, { method: "PUT", headers: { "Content-Type": ct }, body: file });
        if (!put.ok) { notify("err", `${file.name}: 送信失敗(${put.status})`); continue; }
        added.push({ name: file.name, key: pd.key, size: file.size, contentType: ct, uploadedAt: new Date().toISOString() });
      }
      if (added.length) setForm((f) => ({ ...f, versions: f.versions.map((v, i) => (i === idx ? { ...v, files: [...v.files, ...added] } : v)) }));
    } finally { setUploadingIdx(null); }
  };
  const removeFile = (idx: number, key: string) =>
    setForm((f) => ({ ...f, versions: f.versions.map((v, i) => (i === idx ? { ...v, files: v.files.filter((x) => x.key !== key) } : v)) }));

  const save = async () => {
    if (!form.title.trim()) { notify("err", "タイトルは必須です"); return; }
    if (form.versions.every((v) => v.files.length === 0)) { notify("err", "少なくとも1つの版にファイルが必要です"); return; }
    setBusy(true);
    try {
      const payload = {
        specId: form.specId,
        title: form.title.trim(), desc: form.desc, docType: form.docType, brandId: form.brandId,
        viewScope: form.viewScope, categoryId: form.categoryId,
        tags: form.tags.split(/[,、]/).map((s) => s.trim()).filter(Boolean),
        versions: form.versions.map((v) => ({
          versionId: v.versionId, label: v.label, note: v.note, files: v.files,
          isCurrent: v.isCurrent, createdAt: v.createdAt,
        })),
      };
      const res = await fetch("/api/design/specs", {
        method: form.specId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "保存失敗");
      notify("ok", form.specId ? "更新しました" : "登録しました");
      cancel(); load();
    } catch (e: any) { notify("err", e?.message || "保存失敗"); }
    finally { setBusy(false); }
  };

  const del = async (s: SpecDocument) => {
    if (!confirm(`「${s.title}」を全版削除しますか？ファイルも削除されます。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/design/specs?specId=${encodeURIComponent(s.specId)}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "削除失敗");
      notify("ok", "削除しました");
      if (form.specId === s.specId) cancel();
      load();
    } catch (e: any) { notify("err", e?.message || "削除失敗"); }
    finally { setBusy(false); }
  };

  if (denied) {
    return (
      <div className="kb-design-root">
        <div className="kb-topbar"><div className="kb-topbar-inner"><Link href="/design" className="kb-back-link">← 設計業務トップ</Link><div style={{ fontWeight: 700 }}>仕様書・標準図 管理</div><span /></div></div>
        <main className="kb-main-container"><div className="mg-denied">この管理画面は設計担当のみ利用できます。<br /><Link href="/specs" className="mg-view-link">閲覧画面へ →</Link></div></main>
        <StyleBlock />
      </div>
    );
  }

  return (
    <div className="kb-design-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/design" className="kb-back-link">← 設計業務トップ</Link>
          <div style={{ fontWeight: 700 }}>仕様書・標準図 管理</div>
          <div className="mg-topright">
            <Link href="/specs" className="mg-view-link">閲覧画面 →</Link>
            <button className="mg-new" onClick={startNew}>＋ 新規登録</button>
          </div>
        </div>
      </div>

      <main className="mg-main">
        {/* 左: 一覧 */}
        <div className="mg-list">
          <div className="mg-list-head">登録済み <span>{list.length}</span></div>
          {loading ? <div className="mg-empty">読み込み中…</div>
            : list.length === 0 ? <div className="mg-empty">まだありません</div>
            : list.map((s) => (
              <div key={s.specId} className={`mg-item ${form.specId === s.specId ? "on" : ""}`}>
                <button className="mg-item-main" onClick={() => startEdit(s)}>
                  <div className="mg-item-title">{s.title}</div>
                  <div className="mg-item-sub">{s.docType} · {s.brandId} · {(s.versions || []).length}版 · {fmt(s.updatedAt)}</div>
                </button>
                <button className="mg-del" onClick={() => del(s)} disabled={busy}>削除</button>
              </div>
            ))}
        </div>

        {/* 右: フォーム */}
        <div className="mg-form">
          {!editing ? (
            <div className="mg-empty-form">左の一覧から選ぶか、「＋ 新規登録」で追加してください。</div>
          ) : (
            <>
              <h2 className="mg-form-title">{form.specId ? "編集" : "新規登録"}</h2>
              <label className="mg-f"><span>タイトル *</span>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例: FIT365 内装仕様書" />
              </label>
              <div className="mg-row">
                <label className="mg-f"><span>種別</span>
                  <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>{SPEC_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                </label>
                <label className="mg-f"><span>ブランド</span>
                  <select value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>{SPEC_BRANDS.map((b) => <option key={b} value={b}>{b === "ALL" ? "共通(ALL)" : b}</option>)}</select>
                </label>
                <label className="mg-f"><span>公開範囲</span>
                  <select value={form.viewScope} onChange={(e) => setForm({ ...form, viewScope: e.target.value })}>{SPEC_VIEW_SCOPES.map((v) => <option key={v} value={v}>{v === "ALL" ? "全員" : v === "DIRECT" ? "直営+本部" : "FC+本部"}</option>)}</select>
                </label>
              </div>
              <div className="mg-row2">
                <label className="mg-f"><span>分類/シリーズ(任意)</span>
                  <input value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} placeholder="内装 / 電気 / 給排水 等" />
                </label>
                <label className="mg-f"><span>タグ(カンマ区切り)</span>
                  <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="内装, 標準, 24時間" />
                </label>
              </div>
              <label className="mg-f"><span>説明(任意)</span>
                <textarea rows={2} value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
              </label>

              {/* 版(バージョン)管理 */}
              <div className="mg-vhead">
                <span>版(バージョン)</span>
                <button className="mg-addver" onClick={addVersion}>＋ 新しい版を追加</button>
              </div>
              <div className="mg-vlist">
                {form.versions.map((v, idx) => (
                  <div key={idx} className={`mg-ver ${v.isCurrent ? "cur" : ""}`}>
                    <div className="mg-ver-top">
                      <input className="mg-ver-label" value={v.label} onChange={(e) => patchVersion(idx, { label: e.target.value })} placeholder="版名 (例: Rev.3 / 2026-08版)" />
                      {v.isCurrent
                        ? <span className="mg-ver-cur">現行</span>
                        : <button className="mg-ver-setcur" onClick={() => setCurrent(idx)}>現行にする</button>}
                      <button className="mg-ver-del" onClick={() => removeVersion(idx)} disabled={form.versions.length <= 1}>版を削除</button>
                    </div>
                    <textarea className="mg-ver-note" rows={2} value={v.note} onChange={(e) => patchVersion(idx, { note: e.target.value })} placeholder="変更点・メモ(任意)" />
                    <div className="mg-files">
                      <div className="mg-files-head">
                        <span>ファイル(PDF / CAD: dwg, dxf 等)</span>
                        <label className={`mg-upload ${uploadingIdx === idx ? "dis" : ""}`}>
                          {uploadingIdx === idx ? "アップロード中…" : "＋ ファイル追加"}
                          <input type="file" multiple hidden disabled={uploadingIdx !== null}
                            accept=".pdf,.dwg,.dxf,.dwf,.jww,.png,.jpg,.jpeg,.zip,.xlsx,.docx"
                            onChange={(e) => { onPickFiles(idx, e.target.files); e.currentTarget.value = ""; }} />
                        </label>
                      </div>
                      {v.files.length === 0 ? <div className="mg-empty">ファイル未登録</div>
                        : v.files.map((f) => (
                          <div key={f.key} className="mg-file">
                            <span className="mg-file-name">📄 {f.name} <em>{(f.size / 1024 / 1024).toFixed(2)}MB</em></span>
                            <button className="mg-file-x" onClick={() => removeFile(idx, f.key)}>削除</button>
                          </div>
                        ))}
                    </div>
                    {v.createdAt && <div className="mg-ver-date">作成 {fmt(v.createdAt)}</div>}
                  </div>
                ))}
              </div>

              <div className="mg-actions">
                <button className="mg-save" onClick={save} disabled={busy || uploadingIdx !== null}>{busy ? "保存中…" : form.specId ? "更新" : "登録"}</button>
                <button className="mg-cancel" onClick={cancel} disabled={busy}>キャンセル</button>
              </div>
            </>
          )}
        </div>
      </main>

      {toast && <div className={`mg-toast ${toast.k}`}>{toast.m}</div>}
      <StyleBlock />
    </div>
  );
}

function StyleBlock() {
  return (
    <>
      <style jsx global>{`
        .kb-design-root { background:#f8fafc; min-height:100vh; font-family:sans-serif; color:#0f172a; }
        .kb-topbar { height:60px; background:#fff; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; position:sticky; top:0; z-index:100; }
        .kb-topbar-inner { width:100%; max-width:1200px; margin:0 auto; padding:0 24px; display:flex; justify-content:space-between; align-items:center; }
        .kb-back-link { text-decoration:none; font-size:13px; font-weight:600; color:#64748b; }
        .kb-main-container { max-width:1140px; margin:0 auto; padding:32px 24px; }
      `}</style>
      <style jsx>{`
        .mg-topright { display:flex; align-items:center; gap:12px; }
        .mg-view-link { text-decoration:none; font-size:12.5px; font-weight:700; color:#2563eb; }
        .mg-new { border:none; font-size:12.5px; font-weight:700; color:#fff; background:#2563eb; padding:8px 14px; border-radius:8px; cursor:pointer; }
        .mg-denied { padding:60px; text-align:center; color:#94a3b8; line-height:2; }
        .mg-denied .mg-view-link { font-size:14px; }
        .mg-main { max-width:1140px; margin:0 auto; padding:24px; display:grid; grid-template-columns:320px 1fr; gap:20px; align-items:start; }
        .mg-list { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
        .mg-list-head { padding:12px 14px; font-size:12px; font-weight:800; color:#475569; border-bottom:1px solid #f1f5f9; }
        .mg-list-head span { color:#94a3b8; }
        .mg-empty, .mg-empty-form { padding:20px; text-align:center; color:#94a3b8; font-size:13px; }
        .mg-item { display:flex; align-items:stretch; border-bottom:1px solid #f1f5f9; }
        .mg-item.on { background:#eff6ff; }
        .mg-item-main { flex:1; text-align:left; border:none; background:none; padding:11px 14px; cursor:pointer; }
        .mg-item-title { font-size:13.5px; font-weight:700; }
        .mg-item-sub { font-size:11px; color:#94a3b8; margin-top:3px; }
        .mg-del { border:none; background:none; color:#dc2626; font-size:11px; font-weight:700; padding:0 12px; cursor:pointer; }
        .mg-form { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:22px; min-height:300px; }
        .mg-form-title { font-size:17px; font-weight:800; margin:0 0 16px; }
        .mg-f { display:flex; flex-direction:column; gap:5px; margin-bottom:14px; }
        .mg-f > span { font-size:12px; font-weight:700; color:#475569; }
        .mg-f input, .mg-f select, .mg-f textarea { padding:9px 11px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; font-family:inherit; }
        .mg-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
        .mg-row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .mg-row .mg-f, .mg-row2 .mg-f { margin-bottom:14px; }
        .mg-vhead { display:flex; justify-content:space-between; align-items:center; margin:8px 0 10px; padding-top:8px; border-top:1px solid #f1f5f9; }
        .mg-vhead > span { font-size:13px; font-weight:800; color:#334155; }
        .mg-addver { border:1px solid #2563eb; background:#eff6ff; color:#1d4ed8; font-size:12px; font-weight:700; padding:6px 12px; border-radius:7px; cursor:pointer; }
        .mg-vlist { display:flex; flex-direction:column; gap:14px; margin-bottom:18px; }
        .mg-ver { border:1px solid #e2e8f0; border-radius:10px; padding:12px; }
        .mg-ver.cur { border-color:#bfdbfe; background:#f8fbff; }
        .mg-ver-top { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
        .mg-ver-label { flex:1; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; font-weight:700; }
        .mg-ver-cur { font-size:10.5px; font-weight:800; color:#1d4ed8; background:#dbeafe; padding:4px 9px; border-radius:6px; }
        .mg-ver-setcur { border:1px solid #cbd5e1; background:#fff; color:#475569; font-size:11px; font-weight:700; padding:4px 10px; border-radius:6px; cursor:pointer; }
        .mg-ver-del { border:none; background:none; color:#dc2626; font-size:11px; font-weight:700; cursor:pointer; }
        .mg-ver-del:disabled { color:#cbd5e1; cursor:default; }
        .mg-ver-note { width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:12.5px; font-family:inherit; margin-bottom:8px; box-sizing:border-box; }
        .mg-ver-date { font-size:11px; color:#94a3b8; margin-top:6px; text-align:right; }
        .mg-files { border:1px dashed #cbd5e1; border-radius:10px; padding:12px; }
        .mg-files-head { display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:700; color:#475569; margin-bottom:10px; }
        .mg-upload { font-size:12px; font-weight:700; color:#2563eb; background:#eff6ff; padding:6px 12px; border-radius:7px; cursor:pointer; }
        .mg-upload.dis { opacity:.6; cursor:default; }
        .mg-file { display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:6px; background:#fff; }
        .mg-file-name { font-size:12.5px; word-break:break-all; }
        .mg-file-name em { color:#94a3b8; font-style:normal; font-size:11px; margin-left:6px; }
        .mg-file-x { border:none; background:none; color:#dc2626; font-size:11px; font-weight:700; cursor:pointer; }
        .mg-actions { display:flex; gap:10px; }
        .mg-save { border:none; font-size:13px; font-weight:700; color:#fff; background:#2563eb; padding:10px 22px; border-radius:8px; cursor:pointer; }
        .mg-save:disabled { opacity:.6; }
        .mg-cancel { border:1px solid #cbd5e1; font-size:13px; font-weight:700; color:#475569; background:#fff; padding:10px 18px; border-radius:8px; cursor:pointer; }
        .mg-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); padding:11px 20px; border-radius:10px; font-size:13px; font-weight:700; color:#fff; z-index:300; }
        .mg-toast.ok { background:#059669; }
        .mg-toast.err { background:#dc2626; }
        @media (max-width:820px){ .mg-main{ grid-template-columns:1fr; } .mg-row{ grid-template-columns:1fr; } .mg-row2{ grid-template-columns:1fr; } }
      `}</style>
    </>
  );
}
