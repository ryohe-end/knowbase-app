// app/admin/news/page.tsx
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
  fromDate?: string | null;
  toDate?: string | null;
  brandId?: string | null;
  deptId?: string | null;
  targetGroupIds?: string[];
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  isHidden?: boolean;
};

/* ========= ヘルパー関数 ========= */

const generateNewNewsId = () => {
  return `N900-${Date.now().toString().slice(-6)}`;
};

const createEmptyNews = (): NewsItem => ({
  newsId: generateNewNewsId(),
  title: "",
  body: "",
  fromDate: "",
  toDate: "",
  brandId: "ALL",
  deptId: "ALL",
  targetGroupIds: ["direct"], 
  tags: [],
  isHidden: false,
});

const getTodayDate = () => {
  return new Date().toISOString().slice(0, 10);
};

function getStatus(n: NewsItem) {
  if (n.isHidden) return { label: "非表示", color: "#6b7280" }; 
  const today = getTodayDate();
  if (n.fromDate && n.fromDate > today) return { label: "公開前", color: "#9ca3af" };
  if (n.toDate && n.toDate < today) return { label: "公開終了", color: "#ef4444" };
  return { label: "公開中", color: "#22c55e" };
}


export default function AdminNewsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [filterText, setFilterText] = useState("");

  const [newsForm, setNewsForm] = useState<NewsItem>(createEmptyNews());
  const [tagInput, setTagInput] = useState("");
  const [sendEmail, setSendEmail] = useState(true);

  async function loadAllData() {
    try {
      const [nRes, bRes, dRes, gRes] = await Promise.all([ 
        fetch("/api/news"),
        fetch("/api/brands"),
        fetch("/api/depts"),
        fetch("/api/groups"),
      ]);

      const [nJson, bJson, dJson, gJson] = await Promise.all([
        nRes.json(),
        bRes.json(),
        dRes.json(),
        gRes.json(), 
      ]);

      setNewsList(nJson.news || []);
      setBrands(bJson.brands || []);
      setDepts(dJson.depts || []);
      setGroups(gJson.groups || []);
    } catch (e) {
      console.error("Failed to load admin news:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllData();
  }, []);

  const brandMap = useMemo(() => brands.reduce((acc, b) => ({ ...acc, [b.brandId]: b }), {} as Record<string, Brand>), [brands]);
  const deptMap = useMemo(() => depts.reduce((acc, d) => ({ ...acc, [d.deptId]: d }), {} as Record<string, Dept>), [depts]);
  const groupMap = useMemo(() => groups.reduce((acc, g) => ({ ...acc, [g.groupId]: g }), {} as Record<string, Group>), [groups]);

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
    setSendEmail(true);
    setSelectedNews(null);
    setIsEditing(true);
  };

  const handleEdit = (n: NewsItem) => {
    setNewsForm({ 
        ...n, 
        tags: n.tags || [],
        targetGroupIds: n.targetGroupIds || [],
        isHidden: n.isHidden || false
    });
    setTagInput((n.tags || []).join(", "));
    setSelectedNews(n);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    const original = selectedNews || createEmptyNews();
    setNewsForm(original);
    setTagInput((original.tags || []).join(", "));
  };

  const handleGroupToggle = (groupId: string) => {
    if (!isEditing || !groupId) return;
    setNewsForm(prev => {
        const currentIds = prev.targetGroupIds || [];
        if (currentIds.includes(groupId)) {
            return { ...prev, targetGroupIds: currentIds.filter(id => id !== groupId) };
        } else {
            return { ...prev, targetGroupIds: [...currentIds, groupId] };
        }
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    if (name === 'tags') { 
        setTagInput(value);
        return;
    }
    setNewsForm(prev => {
        if (name === 'targetGroupIds') return prev;
        const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
        return { ...prev, [name]: val };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newsForm.title || !newsForm.body) {
      alert("タイトルと本文は必須です。");
      return;
    }

    const finalTags = tagInput.split(/[,、]/).map(s => s.trim()).filter(Boolean);
    const isNewCreation = !!(newsForm?.newsId?.startsWith("N900-"));
    
    const payload = {
      ...newsForm,
      fromDate: newsForm.fromDate || null,
      toDate: newsForm.toDate || null,
      targetGroupIds: newsForm.targetGroupIds || [],
      tags: finalTags,
    };
    
    const endpoint = isNewCreation ? "/api/news" : `/api/news/${newsForm.newsId}`;
    const method = isNewCreation ? "POST" : "PUT";

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorJson = await res.json();
        alert(`保存に失敗しました: ${errorJson.error || res.statusText}`);
        return;
      }
      
      if (isNewCreation && sendEmail) {
        fetch("/api/news/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: payload.title,
            body: payload.body,
            targetGroupIds: payload.targetGroupIds,
          }),
        }).catch(err => console.error("Notification failed:", err));
      }

      await loadAllData();
      const resData = await res.json().catch(() => ({}));
      const savedNews = isNewCreation ? resData.news : payload;
      setSelectedNews(savedNews);
      setNewsForm(savedNews);
      setTagInput((savedNews.tags || []).join(", "));
      setIsEditing(false);
      alert("保存しました。");
    } catch (e) {
      console.error("Save news error:", e);
      alert("お知らせの保存に失敗しました。");
    }
  };

  const handleDelete = async (newsId: string) => {
    if (!confirm("このお知らせを削除してよろしいですか？")) return;
    try {
        const res = await fetch(`/api/news/${newsId}`, { method: "DELETE" });
        if (!res.ok) {
            const errorJson = await res.json();
            alert(`削除に失敗しました: ${errorJson.error || res.statusText}`);
            return;
        }
        await loadAllData();
        setSelectedNews(null);
        setIsEditing(false);
        setNewsForm(createEmptyNews());
        setTagInput("");
    } catch (e) {
        console.error("Delete news error:", e);
        alert("お知らせの削除に失敗しました。");
    }
  };

  const isNewCreationMode = !!(newsForm?.newsId?.startsWith("N900-"));

  return (
    <div className="kb-root">
      {/* ===== Top bar ===== */}
      <div className="kb-topbar">
        <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" alt="KB Logo" style={{ width: "48px", height: "48px", objectFit: "contain" }} />
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png" alt="KnowBase Text Logo" style={{ height: "22px", objectFit: "contain" }} />
        </div>
        <div className="kb-topbar-center" style={{ fontSize: "18px", fontWeight: "700" }}>お知らせ管理</div>
        <div className="kb-topbar-right">
          <Link href="/admin"><button className="kb-logout-btn">管理メニューへ戻る</button></Link>
        </div>
      </div>

      <div className="kb-admin-grid-2col">
        {/* 左カラム: お知らせ一覧 */}
        <div className="kb-admin-card-large">
          <div className="kb-panel-header-row">
            <div className="kb-admin-head">お知らせ一覧（{loading ? '...' : newsList.length}件）</div>
            <button className="kb-primary-btn" onClick={handleNew} style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999 }} disabled={loading}>＋ 新規作成</button>
          </div>
          <input type="text" placeholder="タイトル、本文、タグで検索..." className="kb-admin-input" value={filterText} onChange={(e) => setFilterText(e.target.value)} style={{ marginBottom: 12 }} disabled={loading} />
          
          <div className="kb-manual-list-admin">
            {loading && <div className="kb-admin-body" style={{ color: '#6b7280' }}>データ読み込み中...</div>}
            {!loading && filteredNews.length > 0 ? (
                filteredNews.map((n, index) => {
                    const status = getStatus(n);
                    const brandLabel = n.brandId === "ALL" ? '全社共通' : brandMap[n.brandId || '']?.name || '未設定';
                    const deptLabel = n.deptId === "ALL" ? '全部署' : deptMap[n.deptId || '']?.name || '未設定';
                    const groupLabels = (n.targetGroupIds || []).map(id => groupMap[id]?.groupName || id);
                    
                    // 修正: IDが有効な場合のみ比較し、undefined同士で一致しないようにガードする
                    const isSelected = !!(selectedNews?.newsId && n.newsId && selectedNews.newsId === n.newsId);
                    
                    return (
                        <div 
                            key={n.newsId || `news-${index}`} 
                            className={`kb-user-item-admin ${isSelected ? 'selected' : ''}`}
                            onClick={() => handleEdit(n)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, color: '#ffffff', backgroundColor: status.color, fontWeight: 600 }}>{status.label}</span>
                                <div className="kb-user-title">{n.title}</div>
                            </div>
                            <div className="kb-user-meta-info" style={{ marginTop: 0 }}>
                                {brandLabel} / {deptLabel} 
                                {groupLabels.length > 0 && <span style={{ marginLeft: 8, color: '#374151' }}>属性: {groupLabels.join(', ')}</span>}
                            </div>
                        </div>
                    );
                })
            ) : (!loading && <div className="kb-admin-body" style={{ color: '#6b7280' }}>一致するお知らせがありません。</div>)}
          </div>
        </div>
        
        {/* 右カラム: 編集/詳細フォーム */}
        <div className="kb-admin-card-large">
          <div className="kb-admin-head">{isEditing ? (isNewCreationMode ? '新規お知らせ作成' : 'お知らせ編集') : selectedNews ? 'お知らせ詳細' : 'お知らせ未選択'}</div>
          {(!loading && (isEditing || selectedNews)) && (
            <form className="kb-manual-form" onSubmit={handleSave}>
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">お知らせID</label>
                <input type="text" name="newsId" className="kb-admin-input full" value={newsForm?.newsId || ''} readOnly style={{ background: '#f3f4f8' }} />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タイトル（必須）</label>
                <input type="text" name="title" className="kb-admin-input full" value={newsForm?.title || ''} onChange={handleInputChange} readOnly={!isEditing} />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">本文（必須）</label>
                <textarea name="body" className="kb-admin-textarea full" value={newsForm?.body || ''} onChange={handleInputChange} readOnly={!isEditing} rows={5} />
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                    <label className="kb-admin-label">対象ブランド</label>
                    <select name="brandId" className="kb-admin-select full" value={newsForm?.brandId || 'ALL'} onChange={handleInputChange} disabled={!isEditing}>
                        <option value="ALL">- 全社共通 -</option>
                        {brands.map(b => <option key={b.brandId || 'brand-null'} value={b.brandId}>{b.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="kb-admin-label">配信部署</label>
                    <select name="deptId" className="kb-admin-select full" value={newsForm?.deptId || 'ALL'} onChange={handleInputChange} disabled={!isEditing}>
                        <option value="ALL">- 全部署 -</option>
                        {depts.map(d => <option key={d.deptId || 'dept-null'} value={d.deptId}>{d.name}</option>)}
                    </select>
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">対象属性グループ (リスト選択)</label>
                <div className="kb-chip-list full" style={{ marginBottom: '8px' }}>
                    {groups.map((g, idx) => {
                        const isSelected = newsForm?.targetGroupIds?.includes(g.groupId);
                        return (
                            <button key={g.groupId || `group-${idx}`} type="button" className={`kb-chip small ${isSelected ? 'kb-chip-active' : ''}`} onClick={() => handleGroupToggle(g.groupId)} disabled={!isEditing}>
                                {g.groupName}
                            </button>
                        );
                    })}
                </div>
              </div>

              <div className="kb-admin-form-row" style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  <input type="checkbox" name="isHidden" checked={newsForm?.isHidden || false} onChange={handleInputChange} disabled={!isEditing} />
                  このお知らせを非表示にする
                </label>
                {isEditing && isNewCreationMode && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#2563eb', fontWeight: 'bold' }}>
                    <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                    メールにて通知する
                  </label>
                )}
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                    <label className="kb-admin-label">公開開始日</label>
                    <input type="date" name="fromDate" className="kb-admin-input full" value={newsForm?.fromDate || ''} onChange={handleInputChange} readOnly={!isEditing} />
                </div>
                <div>
                    <label className="kb-admin-label">公開終了日</label>
                    <input type="date" name="toDate" className="kb-admin-input full" value={newsForm?.toDate || ''} onChange={handleInputChange} readOnly={!isEditing} />
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タグ（カンマ区切り）</label>
                <input type="text" name="tags" className="kb-admin-input full" value={tagInput} onChange={handleInputChange} readOnly={!isEditing} placeholder="例: システム, 重要" />
              </div>

              <div className="kb-form-actions">
                {selectedNews && !isEditing && (
                    <button className="kb-delete-btn" onClick={() => handleDelete(selectedNews.newsId)} type="button">削除</button>
                )}
                {isEditing ? (
                    <>
                        <button className="kb-secondary-btn" onClick={handleCancel} type="button">キャンセル</button>
                        <button className="kb-primary-btn" type="submit" disabled={!newsForm?.title || !newsForm?.body}>{isNewCreationMode ? '新規登録' : '保存'}</button>
                    </>
                ) : (
                    <button className="kb-primary-btn" onClick={() => handleEdit(selectedNews!)} type="button">編集</button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}