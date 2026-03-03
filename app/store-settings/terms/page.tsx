"use client";

import React, { useState } from "react";
import Link from "next/link";

// --- Icons ---
const ChevronLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 20, height: 20 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);
const GlobeAltIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 16, height: 16 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
  </svg>
);
const CodeBracketIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 16, height: 16 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
  </svg>
);
const CheckCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16, color: '#10b981' }}>
    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
  </svg>
);

// --- Mock Data ---
// brand: 'COMMON' | 'JOYFIT' | 'FIT365'
const INITIAL_TERMS = [
  {
    id: 1,
    title: "アプリ利用規約",
    brand: "COMMON",
    type: "HTML",
    content: "<h1>利用規約</h1><p>全ブランド共通の規約です...</p>",
    updatedAt: "2023-10-01",
    isPublic: true,
  },
  {
    id: 2,
    title: "JOYFIT プライバシーポリシー",
    brand: "JOYFIT",
    type: "URL",
    content: "https://joyfit.jp/privacy",
    updatedAt: "2023-09-15",
    isPublic: true,
  },
  {
    id: 3,
    title: "FIT365 特定商取引法に基づく表記",
    brand: "FIT365",
    type: "HTML",
    content: "<h1>FIT365 特商法</h1>",
    updatedAt: "2023-08-20",
    isPublic: false,
  },
];

export default function TermsManagementPage() {
  const [terms, setTerms] = useState(INITIAL_TERMS);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filterBrand, setFilterBrand] = useState("ALL"); // ALL, COMMON, JOYFIT, FIT365

  // Form State
  const [formData, setFormData] = useState({ 
    title: "", 
    brand: "COMMON", 
    type: "HTML", 
    content: "", 
    isPublic: true 
  });

  // Handlers
  const startEdit = (term: any) => {
    setEditingId(term.id);
    setFormData({ ...term });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData({ title: "", brand: "COMMON", type: "HTML", content: "", isPublic: true });
  };

  const handleSave = () => {
    if (editingId) {
      // Update existing
      setTerms((prev) => prev.map(t => t.id === editingId ? { ...formData, id: t.id, updatedAt: new Date().toISOString().split('T')[0] } : t));
    } else {
      // Create new (Optional logic, currently only edit is fully wired for list items)
      // For this demo, let's just assume we are editing existing ones or pushing new logic if needed.
    }
    setEditingId(null);
  };

  // フィルタリング処理
  const filteredTerms = terms.filter(term => {
    if (filterBrand === 'ALL') return true;
    return term.brand === filterBrand;
  });

  // --- UI Components ---

  const BrandBadge = ({ brand }: { brand: string }) => {
    let style = { bg: '#f1f5f9', color: '#64748b', label: '共通' };
    if (brand === 'JOYFIT') style = { bg: '#fef2f2', color: '#ef4444', label: 'JOYFIT' };
    if (brand === 'FIT365') style = { bg: '#fff7ed', color: '#f97316', label: 'FIT365' };

    return (
      <span style={{ 
        backgroundColor: style.bg, 
        color: style.color, 
        padding: '4px 8px', 
        borderRadius: 6, 
        fontSize: 11, 
        fontWeight: 700,
        display: 'inline-block',
        minWidth: 50,
        textAlign: 'center'
      }}>
        {style.label}
      </span>
    );
  };

  const TypeBadge = ({ type }: { type: string }) => {
    const isHtml = type === 'HTML';
    return (
      <span className={`kb-badge-pill ${isHtml ? 'kb-badge-blue' : 'kb-badge-orange'}`}>
        {isHtml ? <CodeBracketIcon /> : <GlobeAltIcon />}
        <span style={{ marginLeft: 4 }}>{type}</span>
      </span>
    );
  };

  return (
    <div className="kb-store-root">
      {/* Topbar */}
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/store-settings" className="kb-back-link">
             <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ChevronLeftIcon /> 設定メニューへ戻る
             </span>
          </Link>
          <div style={{ fontWeight: 700 }}>規約・ポリシー管理</div>
          <div style={{ width: 100 }} /> 
        </div>
      </div>

      <main className="kb-main-container">
        
        {/* VIEW: LIST */}
        {!editingId && (
          <>
            <header className="kb-page-header">
              <h1>規約・ポリシー一覧</h1>
              <p>アプリ内に表示する法的文書を管理します。</p>
            </header>

            {/* Brand Filter Tabs */}
            <div className="kb-tabs">
              {[
                { key: 'ALL', label: 'すべて' },
                { key: 'COMMON', label: '共通' },
                { key: 'JOYFIT', label: 'JOYFIT' },
                { key: 'FIT365', label: 'FIT365' }
              ].map(tab => (
                <button
                  key={tab.key}
                  className={`kb-tab-item ${filterBrand === tab.key ? 'active' : ''}`}
                  onClick={() => setFilterBrand(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="kb-card">
              <table className="kb-table">
                <thead>
                  <tr>
                    <th style={{ width: '10%' }}>ブランド</th>
                    <th style={{ width: '35%' }}>タイトル</th>
                    <th>表示タイプ</th>
                    <th>ステータス</th>
                    <th>最終更新</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTerms.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                        該当する規約がありません
                      </td>
                    </tr>
                  ) : filteredTerms.map((term) => (
                    <tr key={term.id} className="kb-table-row" onClick={() => startEdit(term)}>
                      <td><BrandBadge brand={term.brand} /></td>
                      <td className="kb-title-cell">
                        <strong>{term.title}</strong>
                      </td>
                      <td><TypeBadge type={term.type} /></td>
                      <td>
                        {term.isPublic ? (
                          <span className="kb-status-published"><CheckCircleIcon /> 公開中</span>
                        ) : (
                          <span className="kb-status-draft">下書き</span>
                        )}
                      </td>
                      <td style={{ color: '#64748b', fontSize: 13 }}>{term.updatedAt}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="kb-btn-outline">編集</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* VIEW: EDIT */}
        {editingId && (
          <div className="kb-edit-container">
            <div className="kb-edit-header">
              <h2>{formData.title || "新規作成"} を編集</h2>
            </div>

            <div className="kb-card kb-form-card">
              
              <div className="kb-form-row">
                {/* Brand Selector */}
                <div className="kb-form-group" style={{ flex: 1 }}>
                  <label>対象ブランド</label>
                  <select 
                    className="kb-select"
                    value={formData.brand}
                    onChange={(e) => setFormData({...formData, brand: e.target.value})}
                  >
                    <option value="COMMON">共通 (全ブランド)</option>
                    <option value="JOYFIT">JOYFIT</option>
                    <option value="FIT365">FIT365</option>
                  </select>
                </div>

                {/* Title Input */}
                <div className="kb-form-group" style={{ flex: 3 }}>
                  <label>規約タイトル</label>
                  <input 
                    type="text" 
                    className="kb-input" 
                    value={formData.title} 
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                  />
                </div>
              </div>

              {/* Type Switcher */}
              <div className="kb-form-group">
                <label>表示方法</label>
                <div className="kb-toggle-group">
                  <button 
                    className={`kb-toggle-btn ${formData.type === 'HTML' ? 'active' : ''}`}
                    onClick={() => setFormData({...formData, type: 'HTML'})}
                  >
                    <CodeBracketIcon /> HTML作成
                  </button>
                  <button 
                    className={`kb-toggle-btn ${formData.type === 'URL' ? 'active' : ''}`}
                    onClick={() => setFormData({...formData, type: 'URL'})}
                  >
                    <GlobeAltIcon /> 外部URL参照
                  </button>
                </div>
              </div>

              {/* Dynamic Content Input */}
              <div className="kb-form-group">
                <label>
                    {formData.type === 'HTML' ? "HTMLコンテンツ" : "参照先URL"}
                </label>
                
                {formData.type === 'HTML' ? (
                  <textarea 
                    className="kb-textarea" 
                    rows={10} 
                    value={formData.content}
                    onChange={(e) => setFormData({...formData, content: e.target.value})}
                    placeholder="<p>ここに規約本文を入力してください...</p>"
                  />
                ) : (
                  <input 
                    type="url" 
                    className="kb-input" 
                    value={formData.content}
                    onChange={(e) => setFormData({...formData, content: e.target.value})}
                    placeholder="https://example.com/terms"
                  />
                )}
              </div>

              {/* Status Toggle */}
              <div className="kb-form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <input 
                  type="checkbox" 
                  id="isPublic" 
                  checked={formData.isPublic}
                  onChange={(e) => setFormData({...formData, isPublic: e.target.checked})}
                  style={{ width: 20, height: 20 }}
                />
                <label htmlFor="isPublic" style={{ margin: 0, cursor: 'pointer' }}>アプリに公開する</label>
              </div>

              <div className="kb-form-actions">
                <button className="kb-btn-secondary" onClick={cancelEdit}>キャンセル</button>
                <button className="kb-btn-primary" onClick={handleSave}>保存する</button>
              </div>
            </div>
          </div>
        )}

      </main>

      <style jsx global>{`
        /* Global & Layout */
        .kb-store-root { background-color: #f8fafc; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #0f172a; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; display: flex; align-items: center; transition: color 0.2s; }
        .kb-back-link:hover { color: #3b82f6; }
        .kb-main-container { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
        
        /* Headers & Tabs */
        .kb-page-header { margin-bottom: 24px; }
        .kb-page-header h1 { font-size: 24px; font-weight: 800; margin: 0 0 8px 0; }
        .kb-page-header p { font-size: 14px; color: #64748b; margin: 0; }

        .kb-tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
        .kb-tab-item { background: transparent; border: none; padding: 10px 20px; font-size: 14px; font-weight: 600; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .kb-tab-item:hover { color: #3b82f6; }
        .kb-tab-item.active { color: #3b82f6; border-bottom-color: #3b82f6; }
        
        /* Cards & Tables */
        .kb-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .kb-table { width: 100%; border-collapse: collapse; text-align: left; }
        .kb-table th { background: #f8fafc; padding: 12px 16px; font-size: 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
        .kb-table td { padding: 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; vertical-align: middle; }
        .kb-table-row { cursor: pointer; transition: background 0.1s; }
        .kb-table-row:hover { background: #fcfdfe; }
        .kb-table-row:last-child td { border-bottom: none; }
        
        /* Cells & Badges */
        .kb-title-cell { color: #0f172a; font-size: 15px; }
        .kb-badge-pill { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
        .kb-badge-blue { background: #eff6ff; color: #2563eb; }
        .kb-badge-orange { background: #fff7ed; color: #ea580c; }
        
        .kb-status-published { display: flex; align-items: center; gap: 4px; color: #10b981; font-weight: 600; font-size: 13px; }
        .kb-status-draft { color: #94a3b8; font-weight: 600; font-size: 13px; display: inline-block; padding: 2px 8px; background: #f1f5f9; border-radius: 4px; }

        /* Form & Editing */
        .kb-edit-container { animation: fadeIn 0.3s ease; }
        .kb-edit-header { margin-bottom: 24px; }
        .kb-edit-header h2 { font-size: 20px; font-weight: 700; margin: 0; }
        .kb-form-card { padding: 32px; }
        .kb-form-row { display: flex; gap: 24px; margin-bottom: 24px; }
        .kb-form-group { margin-bottom: 24px; display: flex; flex-direction: column; }
        .kb-form-group label { font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 8px; }
        
        .kb-input, .kb-textarea, .kb-select { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; transition: border 0.2s; box-sizing: border-box; background: #fff; }
        .kb-input:focus, .kb-textarea:focus, .kb-select:focus { outline: none; border-color: #3b82f6; ring: 2px solid #bfdbfe; }
        .kb-textarea { font-family: monospace; line-height: 1.6; }
        
        /* Toggle Button Group */
        .kb-toggle-group { display: flex; gap: 12px; }
        .kb-toggle-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border: 1px solid #e2e8f0; background: #fff; border-radius: 8px; font-size: 14px; font-weight: 600; color: #64748b; cursor: pointer; transition: all 0.2s; }
        .kb-toggle-btn.active { border-color: #3b82f6; background: #eff6ff; color: #2563eb; }
        
        /* Buttons */
        .kb-btn-outline { background: #fff; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #475569; cursor: pointer; }
        .kb-btn-outline:hover { background: #f8fafc; border-color: #94a3b8; }
        
        .kb-form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px; padding-top: 24px; border-top: 1px solid #f1f5f9; }
        .kb-btn-primary { background: #3b82f6; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; }
        .kb-btn-primary:hover { background: #2563eb; }
        .kb-btn-secondary { background: transparent; color: #64748b; border: none; padding: 10px 24px; font-weight: 600; font-size: 14px; cursor: pointer; }
        .kb-btn-secondary:hover { color: #0f172a; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}