"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";

/* ========= 型定義 ========= */
type Brand = { brandId: string; name: string };
type Dept = { deptId: string; name: string };
type Group = { groupId: string; groupName: string };

type NewsItem = {
  newsId: string;
  title: string;
  body: string;
  visibleFrom?: string | null;
  visibleTo?: string | null;
  brandId?: string | null;
  deptId?: string | null;
  targetGroupIds?: string[];
  tags?: string[];
  publishedAt?: string;
  isActive?: boolean;
};

/* ========= ヘルパー関数 ========= */
const generateNewNewsId = () => `N900-${Date.now().toString().slice(-6)}`;

const createEmptyNews = (): NewsItem => ({
  newsId: generateNewNewsId(),
  title: "",
  body: "",
  visibleFrom: "",
  visibleTo: "",
  brandId: "ALL",
  deptId: "ALL",
  targetGroupIds: ["direct"], 
  tags: [],
  isActive: true,
});

const getTodayDate = () => new Date().toISOString().slice(0, 10);

function getStatus(n: NewsItem) {
  if (n.isActive === false) return { label: "非表示", color: "#6b7280" }; 
  const today = getTodayDate();
  if (n.visibleFrom && n.visibleFrom > today) return { label: "公開前", color: "#9ca3af" };
  if (n.visibleTo && n.visibleTo < today) return { label: "公開終了", color: "#ef4444" };
  return { label: "公開中", color: "#22c55e" };
}

export default function AdminNewsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // ★ メール配信用のState
  const [isNotifyChecked, setIsNotifyChecked] = useState(false); 
  const [isNotifying, setIsNotifying] = useState(false); 

  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [filterText, setFilterText] = useState("");

  const [newsForm, setNewsForm] = useState<NewsItem>(createEmptyNews());
  const [tagInput, setTagInput] = useState("");

  async function loadAllData() {
    try {
      const [nRes, bRes, dRes, gRes] = await Promise.all([ 
        fetch("/api/news"), fetch("/api/brands"), fetch("/api/depts"), fetch("/api/groups"),
      ]);
      const [nJson, bJson, dJson, gJson] = await Promise.all([
        nRes.json(), bRes.json(), dRes.json(), gRes.json(),
      ]);
      setNewsList(nJson.news || []);
      setBrands(bJson.brands || []);
      setDepts(dJson.depts || []);
      setGroups(gJson.groups || []);
    } catch (e) {
      console.error("Load error:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAllData(); }, []);

  const brandMap = useMemo(() => brands.reduce((acc, b) => ({ ...acc, [b.brandId]: b }), {} as Record<string, Brand>), [brands]);
  const deptMap = useMemo(() => depts.reduce((acc, d) => ({ ...acc, [d.deptId]: d }), {} as Record<string, Dept>), [depts]);

  const filteredNews = useMemo(() => {
    if (loading) return [];
    const kw = filterText.trim().toLowerCase();
    if (!kw) return newsList;
    return newsList.filter(n =>
      n.title?.toLowerCase().includes(kw) ||
      n.body?.toLowerCase().includes(kw) ||
      (n.tags || []).some(t => t.toLowerCase().includes(kw))
    );
  }, [newsList, filterText, loading]);

  const handleNew = () => {
    setNewsForm(createEmptyNews());
    setTagInput("");
    setIsNotifyChecked(false); // 新規作成時はオフ
    setSelectedNews(null);
    setIsEditing(true);
  };

  const handleEdit = (n: NewsItem) => {
    setNewsForm({ ...n, targetGroupIds: n.targetGroupIds || [], tags: n.tags || [] });
    setTagInput((n.tags || []).join(", "));
    setIsNotifyChecked(false); 
    setSelectedNews(n);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    const original = selectedNews || createEmptyNews();
    setNewsForm(original);
    setTagInput((original.tags || []).join(", "));
    setIsNotifyChecked(false);
  };

  const handleGroupToggle = (groupId: string) => {
    if (!isEditing || !groupId) return;
    setNewsForm(prev => {
        const currentIds = prev.targetGroupIds || [];
        const nextIds = currentIds.includes(groupId) ? currentIds.filter(id => id !== groupId) : [...currentIds, groupId];
        return { ...prev, targetGroupIds: nextIds };
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    if (name === 'tags') { setTagInput(value); return; }
    setNewsForm(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  // ★ 修正された保存ハンドル
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newsForm.title || !newsForm.body) return alert("タイトルと本文は必須です。");
    
    setIsSaving(true);
    const isNew = !selectedNews;
    const finalTags = tagInput.split(/[,、]/).map(s => s.trim()).filter(Boolean);
    const payload = { ...newsForm, tags: finalTags };
    
    const endpoint = isNew ? "/api/news" : `/api/news/${newsForm.newsId}`;
    const method = isNew ? "POST" : "PUT";

    try {
      // 1. お知らせ本体の保存
      const res = await fetch(endpoint, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const resData = await res.json();
      const savedNews = isNew ? resData.news : resData.item;

      // 2. メール配信処理（チェックが入っている場合のみ）
      if (isNotifyChecked && savedNews?.newsId) {
        setIsNotifying(true);
        try {
          const notifyRes = await fetch("/api/news/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newsId: savedNews.newsId }),
          });
          if (!notifyRes.ok) console.error("Notification failed");
        } catch (err) {
          console.error("Notification error:", err);
        } finally {
          setIsNotifying(false);
        }
      }

      alert(isNotifyChecked ? "保存とメール配信が完了しました。" : "保存しました。");
      
      await loadAllData();
      if (savedNews) {
        setSelectedNews(savedNews);
        setNewsForm(savedNews);
        setTagInput((savedNews.tags || []).join(", "));
      }
      setIsEditing(false);
      setIsNotifyChecked(false); // 送信後はリセット

    } catch (e: any) {
      alert(`保存エラー: ${e.message}`);
    } finally {
      setIsSaving(false);
      setIsNotifying(false);
    }
  };

  const handleDelete = async () => {
    const newsId = newsForm.newsId;
    if (!newsId || !confirm("このお知らせを完全に削除しますか？")) return;
    try {
      const res = await fetch(`/api/news/${newsId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await loadAllData();
      setSelectedNews(null);
      setIsEditing(false);
      setNewsForm(createEmptyNews());
      setTagInput("");
      alert("削除しました。");
    } catch (e: any) {
      alert(`削除エラー: ${e.message}`);
    }
  };

  const isNewCreationMode = !selectedNews;

  return (
    <div className="kb-root">
      {(isSaving || isNotifying) && (
        <div className="kb-loading-overlay">
          <div className="kb-spinner"></div>
          <p>{isNotifying ? "関係者へメールを配信しています..." : "お知らせを保存しています..."}</p>
        </div>
      )}

      {/* ===== Top bar ===== */}
      <div className="kb-topbar">
        <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: "none" }}>
          <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px", cursor: "pointer" }}>
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" alt="Logo" style={{ width: 48, height: 48, objectFit: "contain" }} />
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png" alt="LogoText" style={{ height: 22, objectFit: "contain" }} />
          </div>
        </Link>
        <div className="kb-topbar-center" style={{ fontSize: "18px", fontWeight: "700" }}>お知らせ管理</div>
        <div className="kb-topbar-right">
          <Link href="/admin"><button className="kb-logout-btn">管理メニューへ戻る</button></Link>
        </div>
      </div>

      <div className="kb-admin-grid-2col">
        {/* 左カラム：一覧 */}
        <div className="kb-admin-card-large">
          <div className="kb-panel-header-row">
            <div className="kb-admin-head">お知らせ一覧（{loading ? '...' : newsList.length}件）</div>
            <button className="kb-primary-btn" onClick={handleNew} style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999 }} disabled={loading}>＋ 新規作成</button>
          </div>
          <input type="text" placeholder="キーワードで検索..." className="kb-admin-input" value={filterText} onChange={(e) => setFilterText(e.target.value)} style={{ marginBottom: 12 }} />
          
          <div className="kb-manual-list-admin">
            {loading && <div className="kb-admin-body" style={{ color: '#6b7280' }}>データ読み込み中...</div>}
            {!loading && filteredNews.map((n) => (
              <div key={n.newsId} className={`kb-user-item-admin ${selectedNews?.newsId === n.newsId ? 'selected' : ''}`} onClick={() => handleEdit(n)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, color: '#ffffff', backgroundColor: getStatus(n).color, fontWeight: 600 }}>{getStatus(n).label}</span>
                  <div className="kb-user-title">{n.title}</div>
                </div>
                <div className="kb-user-meta-info" style={{ marginTop: 0 }}>
                  {n.brandId === "ALL" ? '全社共通' : brandMap[n.brandId!]?.name || '未設定'} / {n.deptId === "ALL" ? '全部署' : deptMap[n.deptId!]?.name || '未設定'}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* 右カラム：フォーム */}
        <div className="kb-admin-card-large">
          <div className="kb-admin-head">{isEditing ? (isNewCreationMode ? '新規お知らせ作成' : 'お知らせ編集') : selectedNews ? 'お知らせ詳細' : 'お知らせ未選択'}</div>
          {(!loading && (isEditing || selectedNews)) && (
            <form className="kb-manual-form" onSubmit={handleSave}>
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">お知らせID</label>
                <input type="text" className="kb-admin-input full" value={newsForm.newsId} readOnly style={{ background: '#f3f4f8' }} />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タイトル</label>
                <input type="text" name="title" className="kb-admin-input full" value={newsForm.title || ''} onChange={handleInputChange} readOnly={!isEditing} placeholder="例: システムメンテナンスのお知らせ" />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">本文</label>
                <textarea name="body" className="kb-admin-textarea full" value={newsForm.body || ''} onChange={handleInputChange} readOnly={!isEditing} rows={8} placeholder="お知らせの内容を入力してください..." />
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">対象ブランド</label>
  <select 
    name="brandId" 
    className="kb-admin-select full" 
    value={newsForm.brandId || 'ALL'} 
    onChange={handleInputChange} 
    disabled={!isEditing}
  >
    <option value="ALL">全社共通</option>
    {brands
      .filter(b => b.brandId !== "ALL") // 重複除外
      .map(b => (
        <option key={b.brandId} value={b.brandId}>
          {b.name}
        </option>
      ))
    }
  </select>
                </div>
                <div>
                  <label className="kb-admin-label">対象部署</label>
  <select 
    name="deptId" 
    className="kb-admin-select full" 
    value={newsForm.deptId || 'ALL'} 
    onChange={handleInputChange} 
    disabled={!isEditing}
  >
    {/* 1. まず固定の「全部署」を表示 */}
    <option value="ALL">全部署</option>
    
    {/* 2. DBのリストから、IDが "ALL" 以外のものだけをループで回す */}
    {depts
      .filter(d => d.deptId !== "ALL") // 重複を防ぐために ALL を除外
      .map(d => (
        <option key={d.deptId} value={d.deptId}>
          {d.name}
        </option>
      ))
    }
  </select>
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">対象属性グループ（複数選択可）</label>
                <div className="kb-chip-list">
                  {groups.map(g => (
                    <button key={g.groupId} type="button" className={`kb-chip small ${newsForm.targetGroupIds?.includes(g.groupId) ? 'kb-chip-active' : ''}`} onClick={() => handleGroupToggle(g.groupId)} disabled={!isEditing}>{g.groupName}</button>
                  ))}
                </div>
              </div>

              <div className="kb-admin-form-row two-col">
                <div><label className="kb-admin-label">公開開始日</label><input type="date" name="visibleFrom" className="kb-admin-input full" value={newsForm.visibleFrom || ''} onChange={handleInputChange} readOnly={!isEditing} /></div>
                <div><label className="kb-admin-label">公開終了日</label><input type="date" name="visibleTo" className="kb-admin-input full" value={newsForm.visibleTo || ''} onChange={handleInputChange} readOnly={!isEditing} /></div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タグ（カンマ区切り）</label>
                <input type="text" name="tags" className="kb-admin-input full" value={tagInput} onChange={handleInputChange} readOnly={!isEditing} placeholder="例: 重要, メンテナンス" />
              </div>

              <div className="kb-admin-form-row" style={{ marginTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', fontWeight: 600 }}>
                  <input type="checkbox" name="isActive" checked={newsForm.isActive ?? true} onChange={handleInputChange} disabled={!isEditing} />
                  公開を有効にする（チェックを外すと下書き/非表示）
                </label>
              </div>

              {/* ★ メール配信チェックボックス */}
              {isEditing && (
                <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#f0f9ff', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={isNotifyChecked}
                      onChange={(e) => setIsNotifyChecked(e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                    <span style={{ fontSize: '14px', fontWeight: '700', color: '#0369a1' }}>
                      保存時に、対象者へメール通知を配信する
                    </span>
                  </label>
                  <p style={{ fontSize: '12px', color: '#0c4a6e', marginTop: '6px', marginLeft: '28px' }}>
                    ※選択したブランド・部署のユーザー全員にメールが送信されます。
                  </p>
                </div>
              )}

              {/* ボタンアクションエリア */}
              <div className="kb-form-actions-news">
                <div className="left-actions">
                  {selectedNews && (
                    <button type="button" className="btn-delete-styled" onClick={handleDelete}>
                      お知らせを削除する
                    </button>
                  )}
                </div>

                <div className="right-actions">
                  {isEditing ? (
                    <>
                      <button className="kb-secondary-btn" onClick={handleCancel} type="button">キャンセル</button>
                      <button className="kb-primary-btn" type="submit" disabled={!newsForm.title || !newsForm.body || isSaving || isNotifying}>
                        {isNotifying ? 'メール配信中...' : isSaving ? '保存中...' : isNewCreationMode ? '新規登録して完了' : '変更を保存する'}
                      </button>
                    </>
                  ) : (
                    <button className="kb-primary-btn" onClick={() => setIsEditing(true)} type="button">内容を編集する</button>
                  )}
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      <style jsx>{`
        .kb-form-actions-news {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 32px;
          padding-top: 20px;
          border-top: 1px solid #edf2f7;
        }
        .right-actions {
          display: flex;
          gap: 12px;
        }
        .btn-delete-styled {
          background-color: #fff;
          color: #e53e3e;
          border: 1.5px solid #fca5a5;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-delete-styled:hover {
          background-color: #fef2f2;
          border-color: #ef4444;
          box-shadow: 0 2px 4px rgba(239, 68, 68, 0.1);
        }
        .kb-loading-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(255,255,255,0.7); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; }
        .kb-spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 10px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .kb-loading-overlay p { font-weight: 700; color: #1e293b; }
      `}</style>
    </div>
  );
}