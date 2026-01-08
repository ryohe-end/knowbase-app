"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";

/* ========= 型定義 ========= */
type Brand = { brandId: string; name: string; sortOrder?: number; };
type Dept = { deptId: string; name: string; sortOrder?: number; };
type Contact = {
  contactId: string;
  name: string;
  email: string;
  brandId: string; 
  deptId: string;
  role?: string;
};

const generateNewContactId = () => `C100-${Date.now().toString().slice(-6)}`;
const ALL_BRAND_ID = "ALL";
const ALL_DEPT_ID = "ALL";

/* ハイライト用コンポーネント */
function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword.trim()) return <>{text}</>;
  
  // 検索ワードで分割（大文字小文字を区別しない）
  const parts = text.split(new RegExp(`(${keyword})`, 'gi'));
  
  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === keyword.toLowerCase() 
          ? (
            <mark 
              key={i} 
              style={{ 
                backgroundColor: '#ffef9c', 
                color: 'inherit', 
                padding: '0 2px', 
                borderRadius: '2px' 
              }}
            >
              {part}
            </mark>
          )
          : part
      )}
    </>
  );
}

export default function AdminContactsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState("");
  const [filterBrand, setFilterBrand] = useState<string>(ALL_BRAND_ID);
  const [filterDept, setFilterDept] = useState<string>(ALL_DEPT_ID);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formContactId, setFormContactId] = useState("");
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formBrandId, setFormBrandId] = useState(ALL_BRAND_ID);
  const [formDeptId, setFormDeptId] = useState(ALL_DEPT_ID);
  const [formRole, setFormRole] = useState("");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAllData = async () => {
    try {
        const [bRes, dRes, cRes] = await Promise.all([
          fetch("/api/brands"),
          fetch("/api/depts"),
          fetch("/api/contacts"),
        ]);
        const [bJson, dJson, cJson] = await Promise.all([
          bRes.json(), dRes.json(), cRes.json(),
        ]);
        setBrands((bJson.brands || []).sort((a: any, b: any) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)));
        setDepts((dJson.depts || []).sort((a: any, b: any) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)));
        setContacts(cJson.contacts || []);
      } catch (e) {
        setError("データの読み込みに失敗しました。");
      } finally { setLoading(false); }
  };

  useEffect(() => { loadAllData(); }, []);
  
  useEffect(() => { 
    if (!formContactId && !editingId) setFormContactId(generateNewContactId()); 
  }, [formContactId, editingId]);

  const brandMap = useMemo(() => brands.reduce<Record<string, Brand>>((map, b) => { map[b.brandId] = b; return map; }, {}), [brands]);
  const deptMap = useMemo(() => depts.reduce<Record<string, Dept>>((map, d) => { map[d.deptId] = d; return map; }, {}), [depts]);

  const filteredContacts = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return contacts.filter((c) => {
      // 1. ブランド・部署フィルター
      if (filterBrand !== ALL_BRAND_ID && c.brandId !== filterBrand) return false;
      if (filterDept !== ALL_DEPT_ID && c.deptId !== filterDept) return false;
      
      // キーワードが空なら全件表示
      if (!kw) return true;

      // 2. 検索対象（haystack）から tags を除外し、role を含める
      const haystack = [
        c.contactId, 
        c.name, 
        c.email, 
        c.role ?? "", // 担当業務（カンマ区切り文字列）を検索対象にする
        deptMap[c.deptId]?.name ?? "", 
        brandMap[c.brandId]?.name ?? ""
      ].join(" ").toLowerCase();

      return haystack.includes(kw);
    }).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [contacts, filterBrand, filterDept, keyword, deptMap, brandMap]);

  const startNew = () => {
    setEditingId(null); setFormContactId(generateNewContactId());
    setFormName(""); setFormEmail(""); setFormBrandId(ALL_BRAND_ID);
    setFormDeptId(ALL_DEPT_ID); setFormRole(""); 
    setMessage(null); setError(null);
  };

  const startEdit = (c: Contact) => {
    setEditingId(c.contactId); setFormContactId(c.contactId);
    setFormName(c.name); setFormEmail(c.email); setFormBrandId(c.brandId || ALL_BRAND_ID);
    setFormDeptId(c.deptId || ALL_DEPT_ID); setFormRole(c.role || "");
    setMessage(null); setError(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null); setError(null);
    setSaving(true);

    const payload = {
      contactId: formContactId,
      name: formName.trim(),
      email: formEmail.trim(),
      brandId: formBrandId,
      deptId: formDeptId,
      role: formRole.trim() || undefined,
    };

    try {
      const res = await fetch("/api/contacts", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`保存に失敗しました: ${data.detail || 'エラー'}`);
        return;
      }
      await loadAllData();
      setMessage(editingId ? "更新しました。" : "追加しました。");
      startNew();
    } catch (e) {
      setError("通信エラーが発生しました。");
    } finally { setSaving(false); }
  };

  const handleDelete = async (contactId: string) => {
    if (!window.confirm("この担当者を削除してもよろしいですか？")) return;
    try {
      const res = await fetch(`/api/contacts?contactId=${encodeURIComponent(contactId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await loadAllData();
      setMessage("削除しました。");
      startNew();
    } catch (e) { setError("削除に失敗しました。"); }
  };

  if (loading) return <div style={{ padding: 40 }}>読み込み中...</div>;

  return (
    <div className="kb-root">
      <div className="kb-topbar">
        <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: "none" }}>
          <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px", cursor: "pointer" }}>
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" alt="Logo" style={{ width: 48, height: 48, objectFit: "contain" }} />
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png" alt="LogoText" style={{ height: 22, objectFit: "contain" }} />
          </div>
        </Link>
        <div className="kb-topbar-center" style={{ fontSize: 18, fontWeight: 700 }}>担当者管理</div>
        <div className="kb-topbar-right">
          <Link href="/admin"><button className="kb-logout-btn">管理者メニューへ戻る</button></Link>
        </div>
      </div>

      <div className="kb-admin-grid-2col" style={{ marginTop: 16 }}>
        {/* 左側：担当者一覧（縦スライダー） */}
        <section className="kb-admin-card-large">
          <div className="kb-admin-head">担当者一覧 ({filteredContacts.length}件)</div>
          <div className="kb-admin-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="kb-admin-form-row" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              <input className="kb-admin-input" placeholder="名前 / IDで検索..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <select className="kb-admin-select" value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
                <option value={ALL_BRAND_ID}>全ブランド</option>
                {brands.map(b => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
              </select>
              <select className="kb-admin-select" value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                <option value={ALL_DEPT_ID}>全部署</option>
                {depts.map(d => <option key={d.deptId} value={d.deptId}>{d.name}</option>)}
              </select>
            </div>
            
            <div className="kb-manual-list-admin scroll-container">
              {filteredContacts.length === 0 ? <p style={{ padding: 20, textAlign: 'center', color: '#999' }}>該当するデータがありません</p> : 
                filteredContacts.map(c => (
                <div key={c.contactId} className={`kb-user-item-admin scroll-item ${editingId === c.contactId ? 'selected' : ''}`} onClick={() => startEdit(c)}>
                  <div className="kb-user-title">
                    <HighlightText text={c.name} keyword={keyword} /> 
                    <span style={{fontSize: 11, fontWeight: 400, color: '#666'}}>
                      (<HighlightText text={c.contactId} keyword={keyword} />)
                    </span>
                  </div>
                  <div className="kb-user-email-meta">
                    <HighlightText text={c.email} keyword={keyword} />
                  </div>
                  <div className="kb-user-meta-info">
                    <HighlightText text={brandMap[c.brandId]?.name || '共通'} keyword={keyword} /> / <HighlightText text={deptMap[c.deptId]?.name || '共通'} keyword={keyword} />
                  </div>
                  
                  {/* 担当業務バッジ表示（安全なsplit処理） */}
                  {typeof c.role === 'string' && c.role.trim() !== "" && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                      {c.role.split(/[、,]/).map((r: string, idx: number) => {
                        const trimmedRole = r.trim();
                        if (!trimmedRole) return null;
                        return (
                          <span
                            key={idx}
                            style={{
                              fontSize: '10px',
                              background: '#e0f2fe',
                              color: '#0369a1',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              border: '1px solid #bae6fd',
                              fontWeight: 500
                            }}
                          >
                            <HighlightText text={trimmedRole} keyword={keyword} />
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 右側：担当者 編集/追加フォーム */}
        <section className="kb-admin-card-large">
          <div className="kb-admin-head">担当者 {editingId ? "編集" : "新規追加"}</div>
          <div className="kb-manual-form">
            {message && <div style={{ fontSize: 12, color: "#16a34a", marginBottom: 8, padding: 8, borderRadius: 6, background: '#dcfce7' }}>{message}</div>}
            {error && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8, padding: 8, borderRadius: 6, background: '#fee2e2' }}>{error}</div>}
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">担当者ID</label>
                <input className="kb-admin-input full" type="text" value={formContactId} readOnly style={{ background: '#f3f4f8' }} />
              </div>
              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">名前 *</label>
                  <input className="kb-admin-input full" type="text" value={formName} onChange={(e) => setFormName(e.target.value)} required />
                </div>
                <div>
                  <label className="kb-admin-label">メールアドレス *</label>
                  <input className="kb-admin-input full" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} required />
                </div>
              </div>
              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">対象ブランド</label>
                  <select className="kb-admin-select full" value={formBrandId} onChange={(e) => setFormBrandId(e.target.value)}>
                    <option value={ALL_BRAND_ID}>全ブランド</option>
                    {brands.map(b => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="kb-admin-label">対象部署</label>
                  <select className="kb-admin-select full" value={formDeptId} onChange={(e) => setFormDeptId(e.target.value)}>
                    <option value={ALL_DEPT_ID}>全部署</option>
                    {depts.map(d => <option key={d.deptId} value={d.deptId}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">担当業務</label>
                <input className="kb-admin-input full" type="text" value={formRole} onChange={(e) => setFormRole(e.target.value)} placeholder="例：QSCチェック、発注管理" />
              </div>
              
              <div className="kb-form-actions" style={{ marginTop: 'auto', paddingTop: 20 }}>
                {editingId && <button className="kb-delete-btn" type="button" onClick={() => handleDelete(editingId)}>削除</button>}
                <button className="kb-secondary-btn" type="button" onClick={startNew}>キャンセル</button>
                <button className="kb-primary-btn" type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
              </div>
            </form>
          </div>
        </section>
      </div>

      <style jsx>{`
        .kb-admin-grid-2col { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; }
        .kb-admin-card-large { background: #fff; border-radius: 16px; padding: 16px; border: 1px solid #e5e7eb; height: 85vh; display: flex; flex-direction: column; overflow: hidden; }
        .kb-admin-head { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
        
        /* 縦スライダー設定 */
        .scroll-container { 
          flex: 1; 
          overflow-y: auto; 
          scroll-snap-type: y mandatory; 
        }
        .scroll-item { 
          scroll-snap-align: start; 
          scroll-margin-top: 10px;
        }
        .scroll-container::-webkit-scrollbar { width: 6px; }
        .scroll-container::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }

        .kb-user-item-admin { padding: 16px; border-radius: 12px; margin-bottom: 12px; background: #f8fafc; cursor: pointer; border: 1px solid #f1f5f9; transition: all 0.2s; }
        .kb-user-item-admin:hover { background: #f1f5f9; border-color: #cbd5e1; }
        .kb-user-item-admin.selected { border-color: #0ea5e9; background: #f0f9ff; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
        
        .kb-user-title { font-weight: 600; font-size: 15px; }
        .kb-user-email-meta { font-size: 13px; color: #64748b; margin-top: 2px; }
        .kb-user-meta-info { font-size: 12px; margin-top: 6px; color: #94a3b8; }
        
        .kb-admin-input, .kb-admin-select { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #d1d5db; font-size: 14px; outline: none; transition: border-color 0.2s; }
        .kb-admin-input:focus, .kb-admin-select:focus { border-color: #0ea5e9; }
        .kb-admin-label { font-size: 12px; font-weight: 600; margin-bottom: 4px; display: block; color: #475569; }
        .kb-admin-form-row { margin-bottom: 16px; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .kb-form-actions { display: flex; justify-content: flex-end; gap: 10px; border-top: 1px dashed #e2e8f0; }
        .kb-primary-btn { background: #0ea5e9; color: #fff; padding: 10px 24px; border-radius: 999px; border: none; font-weight: 600; cursor: pointer; }
        .kb-secondary-btn { background: #fff; border: 1px solid #cbd5e1; padding: 10px 24px; border-radius: 999px; cursor: pointer; color: #475569; }
        .kb-delete-btn { background: #fee2e2; color: #b91c1c; padding: 10px 24px; border-radius: 999px; border: none; margin-right: auto; cursor: pointer; font-weight: 600; }
      `}</style>
    </div>
  );
}