// app/admin/public-pdfs/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PublicPdf } from "@/types/publicPdf";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return iso; }
}

type Toast = { message: string; type: "success" | "error" } | null;

export default function PublicPdfsPage() {
  const [items, setItems] = useState<PublicPdf[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [titleInput, setTitleInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/public-pdfs", { cache: "no-store" });
      const data = await res.json();
      if (data.ok && Array.isArray(data.items)) {
        setItems(data.items);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.originalName.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      showToast("PDF ファイルを選択してください。", "error");
      return;
    }
    if (file.type !== "application/pdf") {
      showToast("PDF (application/pdf) のみアップロード可能です。", "error");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      // 1) 署名付き URL を取得
      const initRes = await fetch("/api/admin/public-pdfs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          title: titleInput.trim() || file.name,
          description: descInput.trim() || undefined,
        }),
      });
      const initData = await initRes.json();
      if (!initRes.ok || !initData.ok) throw new Error(initData?.error || "アップロード初期化失敗");

      // 2) S3 に PUT (進捗付き)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", initData.presignedUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.setRequestHeader("x-amz-acl", "public-read");
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`S3 PUT failed (${xhr.status}): ${xhr.responseText}`));
        };
        xhr.onerror = () => reject(new Error("S3 PUT ネットワークエラー"));
        xhr.send(file);
      });

      // 3) finalize
      const finRes = await fetch(`/api/admin/public-pdfs/${initData.pdfId}/finalize`, { method: "POST" });
      const finData = await finRes.json();
      if (!finRes.ok || !finData.ok) throw new Error(finData?.error || "finalize 失敗");

      showToast(`アップロード完了: ${file.name}`, "success");
      setTitleInput("");
      setDescInput("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e: any) {
      showToast(e?.message || "アップロード失敗", "error");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast("公開 URL をコピーしました。", "success");
    } catch {
      showToast("クリップボードへのコピーに失敗しました。", "error");
    }
  };

  const handleDelete = async (pdf: PublicPdf) => {
    if (!confirm(`「${pdf.title}」を削除しますか？公開 URL は無効になります。`)) return;
    try {
      const res = await fetch(`/api/admin/public-pdfs/${pdf.pdfId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "削除失敗");
      showToast("削除しました。", "success");
      await load();
    } catch (e: any) {
      showToast(e?.message || "削除に失敗しました。", "error");
    }
  };

  return (
    <div className="pp-root">
      <header className="pp-header">
        <div className="pp-header-inner">
          <Link href="/admin" className="pp-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <div className="pp-title-group">
            <h1>外部公開 PDF 管理</h1>
            <p>S3 (houjin-manual) にアップロードし、第三者がアクセス可能な URL を発行します。</p>
          </div>
        </div>
      </header>

      <main className="pp-main">
        <section className="pp-upload-card">
          <h2 className="pp-section-title">新規アップロード</h2>
          <div className="pp-form-grid">
            <div className="pp-field">
              <label>タイトル（任意・ファイル名がデフォルト）</label>
              <input
                type="text"
                className="pp-input"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder="例) FIT365 法人会員規約 2026年6月版"
                disabled={uploading}
              />
            </div>
            <div className="pp-field pp-field-wide">
              <label>説明（任意）</label>
              <textarea
                className="pp-input pp-textarea"
                rows={2}
                value={descInput}
                onChange={(e) => setDescInput(e.target.value)}
                placeholder="社内で共有するメモなど"
                disabled={uploading}
              />
            </div>
            <div className="pp-field">
              <label>PDF ファイル <span className="pp-req">*</span></label>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="pp-input pp-file"
                disabled={uploading}
              />
              <small className="pp-hint">最大 50MB / PDF のみ</small>
            </div>
          </div>
          {uploading && (
            <div className="pp-progress-wrap">
              <div className="pp-progress-bar" style={{ width: `${uploadProgress}%` }} />
              <span className="pp-progress-text">{uploadProgress}%</span>
            </div>
          )}
          <div className="pp-actions">
            <button className="pp-upload-btn" onClick={handleUpload} disabled={uploading}>
              {uploading ? "アップロード中..." : "アップロードして公開 URL を発行"}
            </button>
          </div>
        </section>

        <section className="pp-list-card">
          <div className="pp-list-header">
            <h2 className="pp-section-title">公開中の PDF</h2>
            <div className="pp-search-bar">
              <input
                type="text"
                placeholder="タイトル / ファイル名 / 説明で検索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pp-search-input"
              />
              <span className="pp-meta">{filtered.length} / {items.length} 件</span>
            </div>
          </div>

          {loading ? (
            <div className="pp-empty">読込中...</div>
          ) : filtered.length === 0 ? (
            <div className="pp-empty">{search ? "条件に一致する PDF はありません。" : "まだ公開中の PDF はありません。"}</div>
          ) : (
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>タイトル</th>
                    <th>ファイル名</th>
                    <th style={{ textAlign: "right" }}>サイズ</th>
                    <th>登録者</th>
                    <th>登録日時</th>
                    <th>公開 URL</th>
                    <th style={{ width: 80 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.pdfId}>
                      <td>
                        <div className="pp-title-cell">
                          <strong>{p.title}</strong>
                          {p.description && <small>{p.description}</small>}
                        </div>
                      </td>
                      <td className="mono pp-filename">{p.originalName}</td>
                      <td className="num">{formatBytes(p.sizeBytes)}</td>
                      <td>{p.uploadedByName}</td>
                      <td className="pp-date-cell">{formatDate(p.createdAt)}</td>
                      <td>
                        <div className="pp-url-cell">
                          <a className="pp-url-link" href={p.publicUrl} target="_blank" rel="noopener noreferrer">
                            開く
                          </a>
                          <button className="pp-copy-btn" onClick={() => handleCopyUrl(p.publicUrl)}>
                            URL コピー
                          </button>
                        </div>
                      </td>
                      <td>
                        <button className="pp-delete-btn" onClick={() => handleDelete(p)}>
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {toast && (
        <div className={`pp-toast ${toast.type === "error" ? "pp-toast-error" : "pp-toast-success"}`}>
          {toast.message}
        </div>
      )}

      <style jsx global>{`
        .pp-root { background: #f8fafc; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .pp-header { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 18px 24px; }
        .pp-header-inner { max-width: 1240px; margin: 0 auto; display: flex; align-items: center; gap: 16px; }
        .pp-back { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: #f1f5f9; color: #64748b; transition: 0.15s; flex-shrink: 0; }
        .pp-back:hover { background: #e2e8f0; color: #0f172a; }
        .pp-title-group h1 { font-size: 18px; font-weight: 800; margin: 0 0 2px; color: #0f172a; }
        .pp-title-group p { font-size: 12px; color: #64748b; margin: 0; }

        .pp-main { max-width: 1240px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
        .pp-section-title { font-size: 14px; font-weight: 800; margin: 0 0 14px; color: #0f172a; }

        .pp-upload-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
        .pp-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .pp-field { display: flex; flex-direction: column; gap: 6px; }
        .pp-field-wide { grid-column: span 2; }
        .pp-field label { font-size: 11px; font-weight: 700; color: #475569; }
        .pp-req { color: #ef4444; }
        .pp-input { padding: 9px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 13px; background: #fff; outline: none; font-family: inherit; }
        .pp-input:focus { border-color: #0ea5e9; }
        .pp-textarea { resize: vertical; }
        .pp-file { padding: 6px 8px; }
        .pp-hint { font-size: 10px; color: #94a3b8; }

        .pp-progress-wrap { margin-top: 14px; position: relative; background: #f1f5f9; border-radius: 6px; height: 24px; overflow: hidden; }
        .pp-progress-bar { background: linear-gradient(90deg, #0ea5e9, #2563eb); height: 100%; transition: width 0.2s; }
        .pp-progress-text { position: absolute; top: 0; left: 0; right: 0; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #0f172a; mix-blend-mode: difference; filter: invert(1); }

        .pp-actions { margin-top: 14px; display: flex; justify-content: flex-end; }
        .pp-upload-btn { padding: 11px 22px; background: linear-gradient(135deg, #0ea5e9, #2563eb); color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: 0.15s; box-shadow: 0 2px 6px rgba(14, 165, 233, 0.25); }
        .pp-upload-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(14, 165, 233, 0.3); }
        .pp-upload-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        .pp-list-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
        .pp-list-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
        .pp-search-bar { display: flex; align-items: center; gap: 10px; }
        .pp-search-input { padding: 7px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px; font-size: 12px; outline: none; min-width: 260px; }
        .pp-search-input:focus { border-color: #0ea5e9; }
        .pp-meta { font-size: 11px; color: #94a3b8; font-weight: 600; }

        .pp-empty { padding: 50px 20px; text-align: center; color: #94a3b8; font-size: 13px; background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 10px; }
        .pp-table-wrap { overflow-x: auto; }
        .pp-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .pp-table th { background: #f8fafc; padding: 11px 14px; font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #e2e8f0; text-align: left; white-space: nowrap; }
        .pp-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .pp-table tr:hover { background: #fafbfc; }
        .pp-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .pp-table .mono { font-family: "SF Mono", Menlo, monospace; font-size: 11.5px; color: #475569; }
        .pp-title-cell strong { display: block; font-size: 13px; color: #0f172a; }
        .pp-title-cell small { display: block; font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .pp-filename { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-date-cell { color: #475569; white-space: nowrap; }
        .pp-url-cell { display: flex; gap: 6px; align-items: center; }
        .pp-url-link { padding: 4px 10px; font-size: 11px; font-weight: 700; color: #0ea5e9; background: #eff6ff; border-radius: 6px; text-decoration: none; }
        .pp-url-link:hover { background: #dbeafe; }
        .pp-copy-btn { padding: 4px 10px; font-size: 11px; font-weight: 700; color: #475569; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer; }
        .pp-copy-btn:hover { background: #f1f5f9; border-color: #94a3b8; }
        .pp-delete-btn { padding: 4px 10px; font-size: 11px; font-weight: 700; color: #b91c1c; background: #fff; border: 1px solid #fecaca; border-radius: 6px; cursor: pointer; }
        .pp-delete-btn:hover { background: #fef2f2; }

        .pp-toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 22px; border-radius: 10px; font-size: 13px; font-weight: 700; z-index: 9999; box-shadow: 0 6px 16px rgba(0,0,0,0.15); animation: slideUp 0.3s ease; }
        .pp-toast-success { background: #10b981; color: #fff; }
        .pp-toast-error { background: #ef4444; color: #fff; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
