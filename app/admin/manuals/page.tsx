"use client";

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/* ========= 型定義 (外部URL, 公開期間, ダウンロード禁止) ========= */

type Manual = {
  manualId: string;
  title: string;
  brandId?: string;
  bizId?: string;
  desc?: string | null;
  updatedAt?: string;
  tags?: string[];
  embedUrl?: string;
  externalUrl?: string; 
  noDownload?: boolean;
  startDate?: string;
  endDate?: string;
  type?: "doc" | "video";
};

type Brand = { brandId: string; name: string };
type Dept = { deptId: string; name: string };

const DRAFT_KEY = "kb_manual_draft_v1";

/* ========= ヘルパー関数群 ========= */

const getTodayDate = () => {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const generateNewManualId = () => `M200-${Date.now().toString().slice(-6)}`;

const createEmptyManual = (initialData: Partial<Manual> = {}): Manual => ({
  manualId: generateNewManualId(),
  title: "",
  brandId: "",
  bizId: "",
  desc: "",
  updatedAt: getTodayDate(),
  tags: [],
  embedUrl: "",
  externalUrl: "", 
  noDownload: false,
  startDate: "",
  endDate: "",
  type: "doc",
  ...initialData,
});

const getEmbedSrc = (url?: string) => {
  if (!url || typeof url !== "string" || url.trim() === "") return "";
  const u = url.trim();
  const idMatch = u.match(/(?:id=|\/d\/)([\w-]+)(?:\/edit|\/view|\/preview|\/present|\/|$)/i);
  if (!idMatch) return u.length < 30 ? "" : u;
  const fileId = idMatch[1];
  if (u.includes("docs.google.com/presentation")) {
    return `https://docs.google.com/presentation/d/${fileId}/embed?start=false&loop=false&delayms=3000`;
  }
  return `https://drive.google.com/file/d/${fileId}/preview`;
};

function safeSetDraft(draft: any) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (e) {
    console.warn("Failed to set draft:", e);
  }
}

/* ========= メインコンポーネント ========= */

export default function AdminManuals() {
  const router = useRouter();
  const sp = useSearchParams();
  const selectId = sp.get("select");

  const [manuals, setManuals] = useState<Manual[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCopying, setIsCopying] = useState(false);
  const [selectedManual, setSelectedManual] = useState<Manual | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [filterText, setFilterText] = useState("");

  const [manualForm, setManualForm] = useState<Manual>(createEmptyManual());
  const [tagInput, setTagInput] = useState("");

  const loadAllData = useCallback(async () => {
    try {
      const [mRes, bRes, dRes] = await Promise.all([
        fetch("/api/manuals"),
        fetch("/api/brands"),
        fetch("/api/depts"),
      ]);
      const [mJson, bJson, dJson] = await Promise.all([
        mRes.json(),
        bRes.json(),
        dRes.json(),
      ]);
      setManuals(mJson.manuals || []);
      setBrands(bJson.brands || []);
      setDepts(dJson.depts || []);
    } catch (e) {
      console.error("Fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    if (loading) return;
    if (!selectId) return;
    const found = manuals.find((m) => m.manualId === selectId);
    if (found) {
      setSelectedManual(found);
      setManualForm({ ...found });
      setTagInput((found.tags || []).join(", "));
      setIsEditing(false);
    }
  }, [loading, selectId, manuals]);

  const brandMap = useMemo(() => 
    brands.reduce((acc, b) => ({ ...acc, [b.brandId]: b }), {} as Record<string, Brand>), [brands]);
  const deptMap = useMemo(() => 
    depts.reduce((acc, d) => ({ ...acc, [d.deptId]: d }), {} as Record<string, Dept>), [depts]);

  const handleNewManual = () => {
    setManualForm(createEmptyManual());
    setTagInput("");
    setSelectedManual(null);
    setIsEditing(true);
  };

  const handleCreateFromTemplate = async () => {
    if (!manualForm.title) {
      alert("先にタイトルを入力してください。");
      return;
    }
    setIsCopying(true);
    const finalTags = tagInput.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
    const draft = { ...manualForm, tags: finalTags };
    safeSetDraft(draft);

    try {
      const res = await fetch("/api/drive/copy-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: manualForm.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/admin/manuals/edit?fileId=${data.fileId}&editUrl=${encodeURIComponent(data.editUrl)}`);
    } catch (e: any) {
      alert(`コピー失敗: ${e.message}`);
    } finally {
      setIsCopying(false);
    }
  };

  const handleEditManual = (manual: Manual) => {
    setManualForm({ ...manual });
    setTagInput((manual.tags || []).join(", "));
    setSelectedManual(manual);
    setIsEditing(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (name === "tags") {
      setTagInput(value);
      return;
    }
    const val = type === "checkbox" ? (e.target as HTMLInputElement).checked : value;
    setManualForm(prev => ({ ...prev, [name]: val }));
  };

  const handleSave = async () => {
    if (!manualForm.title) {
      alert("タイトル必須");
      return;
    }
    const finalTags = tagInput.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
    const payload = { ...manualForm, tags: finalTags };
    try {
      const isNew = selectedManual === null;
      const res = await fetch("/api/manuals", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      await loadAllData();
      setIsEditing(false);
      alert("保存しました");
    } catch (e) {
      alert("保存エラー");
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    const original = selectedManual || createEmptyManual();
    setManualForm(original);
    setTagInput((original.tags || []).join(", "));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("本当にこのマニュアルを削除しますか？")) return;
    try {
      const res = await fetch(`/api/manuals?manualId=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await loadAllData();
      setSelectedManual(null);
      setIsEditing(false);
      alert("削除しました");
    } catch (e) {
      alert("削除に失敗しました");
    }
  };

  const filteredManuals = useMemo(() => {
    const kw = filterText.trim().toLowerCase();
    return manuals.filter(m => m.title.toLowerCase().includes(kw) || m.tags?.some(t => t.toLowerCase().includes(kw)));
  }, [manuals, filterText]);

  return (
    <div className="kb-root">
      {isCopying && (
        <div className="kb-loading-overlay">
          <div className="kb-spinner"></div>
          <p>テンプレートをコピーしています...<br/>しばらくお待ちください</p>
        </div>
      )}
      <div className="kb-topbar">
        <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: "none" }}>
          <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px", cursor: "pointer" }}>
            <img 
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" 
              alt="Logo" 
              style={{ width: 48, height: 48, objectFit: "contain" }} 
            />
            <img 
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png" 
              alt="LogoText" 
              style={{ height: 22, objectFit: "contain" }} 
            />
          </div>
        </Link>
        <div className="kb-topbar-center" style={{ fontSize: 18, fontWeight: 700 }}>マニュアル管理</div>
        <div className="kb-topbar-right">
          <Link href="/admin"><button className="kb-logout-btn">管理メニューへ戻る</button></Link>
        </div>
      </div>

      <div className="kb-admin-grid-2col">
        <div className="kb-admin-card-large">
          <div className="kb-panel-header-row">
            <div className="kb-admin-head">マニュアル一覧（{loading ? '...' : manuals.length}件）</div>
            <button className="kb-primary-btn" onClick={handleNewManual} style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999 }}>＋ 新規作成</button>
          </div>
          <input type="text" className="kb-admin-input" placeholder="タイトル、ID、タグで検索..." value={filterText} onChange={e => setFilterText(e.target.value)} style={{ marginBottom: 12 }} />
          <div className="kb-manual-list-admin">
            {!loading && filteredManuals.map(m => (
              <div key={m.manualId} className={`kb-manual-item-admin ${selectedManual?.manualId === m.manualId ? "selected" : ""}`} onClick={() => handleEditManual(m)}>
                <div className="kb-manual-title-admin">{m.type === "video" ? "🎬 " : "📄 "}{m.title}</div>
                <div className="kb-manual-meta-admin">{brandMap[m.brandId || ""]?.name || "全社"} / {deptMap[m.bizId || ""]?.name || "未設定"} / 更新日: {m.updatedAt || '未設定'}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="kb-admin-card-large">
          <div className="kb-admin-head">{isEditing ? (selectedManual === null ? "新規マニュアル作成" : "マニュアル編集") : selectedManual ? "マニュアル詳細" : "マニュアル未選択"}</div>
          {!selectedManual && !isEditing && !loading && <div style={{ color: '#6b7280', paddingTop: 30, textAlign: 'center' }}>編集したいマニュアルを選択するか、「＋ 新規作成」ボタンを押してください。</div>}
          {(isEditing || selectedManual) && (
            <div className="kb-manual-form">
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">マニュアルID</label>
                <input type="text" className="kb-admin-input full" value={manualForm.manualId} readOnly style={{ background: "#f3f4f8" }} />
              </div>
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タイトル（必須）</label>
                <input type="text" name="title" className="kb-admin-input full" value={manualForm.title || ""} onChange={handleInputChange} readOnly={!isEditing} />
              </div>
              
              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">タイプ</label>
                  <select name="type" className="kb-admin-select full" value={manualForm.type || "doc"} onChange={handleInputChange} disabled={!isEditing}>
                    <option value="doc">資料（📄）</option>
                    <option value="video">動画（🎬）</option>
                  </select>
                </div>
                <div>
                  <label className="kb-admin-label">ブランド</label>
                  <select name="brandId" className="kb-admin-select full" value={manualForm.brandId || ""} onChange={handleInputChange} disabled={!isEditing}>
                    <option value="">- 全社 -</option>
                    {brands.map(b => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">公開開始日</label>
                  <input type="date" name="startDate" className="kb-admin-input full" value={manualForm.startDate || ""} onChange={handleInputChange} readOnly={!isEditing} />
                </div>
                <div>
                  <label className="kb-admin-label">公開終了日</label>
                  <input type="date" name="endDate" className="kb-admin-input full" value={manualForm.endDate || ""} onChange={handleInputChange} readOnly={!isEditing} />
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">配信部署</label>
                <select name="bizId" className="kb-admin-select full" value={manualForm.bizId || ""} onChange={handleInputChange} disabled={!isEditing}>
                  <option value="">- 選択しない -</option>
                  {depts.map(d => <option key={d.deptId} value={d.deptId}>{d.name}</option>)}
                </select>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">説明</label>
                <textarea name="desc" className="kb-admin-textarea full" value={manualForm.desc || ""} onChange={handleInputChange} readOnly={!isEditing} rows={3} />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タグ（カンマ区切り）</label>
                <input type="text" name="tags" className="kb-admin-input full" value={tagInput} onChange={handleInputChange} readOnly={!isEditing} placeholder="例: 経理, 請求, PDF" />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">埋め込みURL（Google Drive/Slides）</label>
                <input type="url" name="embedUrl" className="kb-admin-input full" value={manualForm.embedUrl || ""} onChange={handleInputChange} readOnly={!isEditing} placeholder="https://drive.google.com/..." />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">外部URL（参考リンクなど）</label>
                <input type="url" name="externalUrl" className="kb-admin-input full" value={manualForm.externalUrl || ""} onChange={handleInputChange} readOnly={!isEditing} placeholder="https://example.com" />
                <div className="kb-subnote full" style={{ marginTop: 4 }}>※埋め込みではなく、別タブで開くリンクとして利用されます。</div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" name="noDownload" checked={!!manualForm.noDownload} onChange={handleInputChange} disabled={!isEditing} style={{ width: 18, height: 18 }} />
                  <span>ダウンロードを禁止する（閲覧のみ）</span>
                </label>
              </div>

              {getEmbedSrc(manualForm.embedUrl) && (
                <div className="kb-admin-form-row full" style={{ marginTop: 20 }}>
                  <label className="kb-admin-label full">ライブプレビュー</label>
                  <div style={{ width: "100%", paddingTop: "56.25%", position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", background: "#020617" }}>
                    <iframe src={getEmbedSrc(manualForm.embedUrl)} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} allowFullScreen loading="lazy" />
                  </div>
                </div>
              )}

              <div className="kb-form-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
                {/* ✅ 削除ボタン: 既存データを選択している時のみ表示 */}
                {selectedManual && (
                  <button 
                    className="kb-delete-btn" 
                    onClick={() => handleDelete(selectedManual.manualId)} 
                    type="button"
                    style={{ marginRight: 'auto' }}
                  >
                    削除
                  </button>
                )}

                {isEditing && selectedManual === null && (
                  <button className="kb-secondary-btn" onClick={handleCreateFromTemplate} disabled={isCopying} type="button">{isCopying ? "コピー中..." : "テンプレートから作成"}</button>
                )}

                {isEditing ? (
                  <>
                    <button className="kb-secondary-btn" onClick={handleCancel} type="button">中止</button>
                    <button className="kb-primary-btn" onClick={handleSave} disabled={!manualForm.title} type="button">{selectedManual === null ? "新規作成" : "保存"}</button>
                  </>
                ) : (
                  <button className="kb-primary-btn" onClick={() => setIsEditing(true)} type="button">編集</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .kb-root { background: #f8fafc; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; }
        .kb-topbar { background: #fff; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 100; }
        .kb-logout-btn { background: #f1f5f9; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; color: #475569; cursor: pointer; transition: 0.2s; }
        .kb-logout-btn:hover { background: #e2e8f0; }
        .kb-admin-grid-2col { display: grid; grid-template-columns: 2fr 3fr; gap: 20px; padding: 20px; max-width: 1600px; margin: 0 auto; }
        .kb-admin-card-large { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; height: calc(100vh - 100px); display: flex; flex-direction: column; }
        .kb-panel-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .kb-admin-head { font-size: 1.25rem; font-weight: 800; color: #1e293b; }
        .kb-admin-input { width: 100%; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; transition: 0.2s; }
        .kb-admin-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        .kb-manual-list-admin { flex: 1; overflow-y: auto; padding-right: 4px; }
        .kb-manual-item-admin { padding: 16px; border-radius: 12px; background: #f8fafc; cursor: pointer; margin-bottom: 12px; border: 1px solid #f1f5f9; transition: 0.2s; }
        .kb-manual-item-admin:hover { background: #f1f5f9; transform: translateY(-1px); }
        .kb-manual-item-admin.selected { background: #eff6ff; border-color: #3b82f6; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.08); }
        .kb-manual-title-admin { font-size: 14px; font-weight: 700; color: #1e293b; }
        .kb-manual-meta-admin { font-size: 12px; color: #64748b; margin-top: 6px; }
        .kb-manual-form { flex: 1; overflow-y: auto; padding-right: 4px; }
        .kb-admin-form-row { margin-bottom: 20px; }
        .kb-admin-form-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .kb-admin-label { font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 8px; display: block; }
        .kb-admin-select, .kb-admin-textarea { width: 100%; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; background: #fff; }
        .kb-admin-textarea { resize: vertical; min-height: 80px; }
        .kb-subnote { font-size: 12px; color: #94a3b8; }
        .kb-form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px dashed #e2e8f0; }
        .kb-primary-btn { background: #3b82f6; color: #fff; padding: 10px 24px; border-radius: 999px; border: none; font-weight: 700; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2); }
        .kb-primary-btn:hover { background: #2563eb; transform: translateY(-1px); }
        .kb-primary-btn:disabled { background: #94a3b8; cursor: not-allowed; transform: none; box-shadow: none; }
        .kb-secondary-btn { background: #fff; border: 1px solid #cbd5e1; color: #475569; padding: 10px 24px; border-radius: 999px; font-weight: 700; cursor: pointer; transition: 0.2s; }
        .kb-secondary-btn:hover { background: #f8fafc; border-color: #94a3b8; }
        .kb-delete-btn { background: #fff1f2; color: #e11d48; padding: 10px 24px; border-radius: 999px; border: 1px solid #fecaca; font-weight: 700; cursor: pointer; transition: 0.2s; }
        .kb-delete-btn:hover { background: #ffe4e6; border-color: #fb7185; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        .kb-loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(255, 255, 255, 0.8);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        .kb-spinner {
          width: 50px;
          height: 50px;
          border: 5px solid #e2e8f0;
          border-top: 5px solid #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .kb-loading-overlay p {
          font-weight: 700;
          color: #1e293b;
          text-align: center;
          line-height: 1.6;
        }
      `}</style>
    </div>
  );
}