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
  tags?: string[];
};

const generateNewContactId = () => `C100-${Date.now().toString().slice(-6)}`;
const ALL_BRAND_ID = "ALL";
const ALL_DEPT_ID = "ALL";
const PAGE_SIZE = 10; // 少し多めに設定

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
  const [formTags, setFormTags] = useState(""); 

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1); 

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
  
  // フィルター条件が変わったらページを1に戻す
  useEffect(() => { setPage(1); }, [keyword, filterBrand, filterDept]);

  useEffect(() => { 
    if (!formContactId && !editingId) setFormContactId(generateNewContactId()); 
  }, [formContactId, editingId]);

  const brandMap = useMemo(() => brands.reduce<Record<string, Brand>>((map, b) => { map[b.brandId] = b; return map; }, {}), [brands]);
  const deptMap = useMemo(() => depts.reduce<Record<string, Dept>>((map, d) => { map[d.deptId] = d; return map; }, {}), [depts]);

  const filteredContacts = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return contacts.filter((c) => {
      if (filterBrand !== ALL_BRAND_ID && c.brandId !== filterBrand) return false;
      if (filterDept !== ALL_DEPT_ID && c.deptId !== filterDept) return false;
      if (!kw) return true;
      const haystack = [c.contactId, c.name, c.email, c.role ?? "", deptMap[c.deptId]?.name ?? "", brandMap[c.brandId]?.name ?? "", ...(c.tags || [])].join(" ").toLowerCase();
      return haystack.includes(kw);
    }).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [contacts, filterBrand, filterDept, keyword, deptMap, brandMap]);

  const { currentContacts, totalPages } = useMemo(() => {
    const total = Math.max(1, Math.ceil(filteredContacts.length / PAGE_SIZE));
    const sp = Math.min(Math.max(1, page), total);
    return { 
        currentContacts: filteredContacts.slice((sp - 1) * PAGE_SIZE, sp * PAGE_SIZE), 
        totalPages: total 
    };
  }, [filteredContacts, page]);

  const startNew = () => {
    setEditingId(null); setFormContactId(generateNewContactId());
    setFormName(""); setFormEmail(""); setFormBrandId(ALL_BRAND_ID);
    setFormDeptId(ALL_DEPT_ID); setFormRole(""); setFormTags("");
    setMessage(null); setError(null);
  };

  const startEdit = (c: Contact) => {
    setEditingId(c.contactId); setFormContactId(c.contactId);
    setFormName(c.name); setFormEmail(c.email); setFormBrandId(c.brandId || ALL_BRAND_ID);
    setFormDeptId(c.deptId || ALL_DEPT_ID); setFormRole(c.role || "");
    setFormTags((c.tags || []).join(", ")); setMessage(null); setError(null);
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
      tags: formTags.split(",").map(s => s.trim()).filter(Boolean),
    };

    try {
      const res = await fetch("/api/contacts", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(`保存に失敗しました: ${data.detail || '権限またはDBエラー'}`);
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
        <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" alt="Logo" style={{ width: 48, height: 48 }} />
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png" alt="LogoText" style={{ height: 22 }} />
        </div>
        <div className="kb-topbar-center" style={{ fontSize: 18, fontWeight: 700 }}>担当者管理</div>
        <div className="kb-topbar-right">
          <Link href="/admin"><button className="kb-logout-btn">戻る</button></Link>
        </div>
      </div>

      <div className="kb-admin-grid-2col" style={{ marginTop: 16 }}>
        <section className="kb-admin-card-large">
          <div className="kb-admin-head">担当者 {editingId ? "編集" : "新規追加"}</div>
          <div className="kb-manual-form">
            {message && <div style={{ fontSize: 12, color: "#16a34a", marginBottom: 8, padding: 8, borderRadius: 6, background: '#dcfce7' }}>{message}</div>}
            {error && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8, padding: 8, borderRadius: 6, background: '#fee2e2' }}>{error}</div>}
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">contactId</label>
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
                <input className="kb-admin-input full" type="text" value={formRole} onChange={(e) => setFormRole(e.target.value)} placeholder="例：QSCチェック" />
              </div>
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タグ（カンマ区切り）</label>
                <input className="kb-admin-input full" type="text" value={formTags} onChange={(e) => setFormTags(e.target.value)} />
              </div>
              <div className="kb-form-actions" style={{ marginTop: 20 }}>
                {editingId && <button className="kb-delete-btn" type="button" onClick={() => handleDelete(editingId)}>削除</button>}
                <button className="kb-secondary-btn" type="button" onClick={startNew}>キャンセル</button>
                <button className="kb-primary-btn" type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
              </div>
            </form>
          </div>
        </section>

        <section className="kb-admin-card-large">
          <div className="kb-admin-head">担当者一覧 ({filteredContacts.length}件)</div>
          <div className="kb-admin-body" style={{ padding: '0 0 10px 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="kb-admin-form-row" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              <input className="kb-admin-input" placeholder="検索..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <select className="kb-admin-select" value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
                <option value={ALL_BRAND_ID}>全ブランド</option>
                {brands.map(b => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
              </select>
              <select className="kb-admin-select" value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                <option value={ALL_DEPT_ID}>全部署</option>
                {depts.map(d => <option key={d.deptId} value={d.deptId}>{d.name}</option>)}
              </select>
            </div>
            <div className="kb-manual-list-admin">
              {currentContacts.length === 0 ? <p style={{ padding: 20, textAlign: 'center', color: '#999' }}>データがありません</p> : 
                currentContacts.map(c => (
                <div key={c.contactId} className={`kb-user-item-admin ${editingId === c.contactId ? 'selected' : ''}`} onClick={() => startEdit(c)}>
                  <div className="kb-user-title">{c.name} <span style={{fontSize: 11, fontWeight: 400, color: '#666'}}>({c.contactId})</span></div>
                  <div className="kb-user-email-meta">{c.email}</div>
                  <div className="kb-user-meta-info">{brandMap[c.brandId]?.name || '共通'} / {deptMap[c.deptId]?.name || '共通'}</div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 10 }}>
                    <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>前</button>
                    <span>{page} / {totalPages}</span>
                    <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>次</button>
                </div>
            )}
          </div>
        </section>
      </div>

      <style jsx>{`
        .kb-admin-grid-2col { display: grid; grid-template-columns: 2fr 3fr; gap: 16px; }
        .kb-admin-card-large { background: #fff; border-radius: 16px; padding: 16px; border: 1px solid #e5e7eb; height: 85vh; display: flex; flex-direction: column; overflow: hidden; }
        .kb-admin-head { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
        .kb-manual-list-admin { flex: 1; overflow-y: auto; }
        .kb-user-item-admin { padding: 10px; border-radius: 10px; margin-bottom: 8px; background: #f9fafb; cursor: pointer; border: 1px solid #f1f5f9; }
        .kb-user-item-admin.selected { border-color: #0ea5e9; background: #e0f2fe; }
        .kb-user-title { font-weight: 600; font-size: 14px; }
        .kb-user-email-meta { font-size: 12px; color: #64748b; }
        .kb-user-meta-info { font-size: 11px; margin-top: 4px; color: #94a3b8; }
        .kb-admin-input, .kb-admin-select { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #d1d5db; font-size: 14px; }
        .kb-admin-label { font-size: 12px; font-weight: 600; margin-bottom: 4px; display: block; }
        .kb-admin-form-row { margin-bottom: 12px; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .kb-form-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 15px; border-top: 1px dashed #eee; }
        .kb-primary-btn { background: #0ea5e9; color: #fff; padding: 8px 20px; border-radius: 999px; border: none; font-weight: 600; cursor: pointer; }
        .kb-secondary-btn { background: #fff; border: 1px solid #d1d5db; padding: 8px 20px; border-radius: 999px; cursor: pointer; }
        .kb-delete-btn { background: #fee2e2; color: #b91c1c; padding: 8px 20px; border-radius: 999px; border: none; margin-right: auto; cursor: pointer; }
      `}</style>
    </div>
  );
}