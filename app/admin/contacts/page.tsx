// app/admin/contacts/page.tsx

"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";

/* ========= 型定義 (再整理) ========= */
type Brand = {
  brandId: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
};

type Dept = {
  deptId: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
};

type Contact = {
  contactId: string;
  name: string;
  email: string;
  brandId: string; // "ALL" or brandId
  deptId: string;
  role?: string;
  tags?: string[];
};

// ヘルパー関数: 新規Contactの仮IDを生成
const generateNewContactId = () => {
  // C100 から始まる仮IDを生成
  return `C100-${Date.now().toString().slice(-6)}`;
};

const ALL_BRAND_ID = "ALL";
const ALL_DEPT_ID = "ALL";
const PAGE_SIZE = 5; 

export default function AdminContactsPage() {
  // ====== マスタ & 担当者一覧 ======
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  // フィルタ
  const [keyword, setKeyword] = useState("");
  const [filterBrand, setFilterBrand] = useState<string>(ALL_BRAND_ID);
  const [filterDept, setFilterDept] = useState<string>(ALL_DEPT_ID);

  // フォーム（新規 & 編集）
  const [editingId, setEditingId] = useState<string | null>(null); // nullなら新規、IDなら編集

  // ★修正: 初期値を空文字列に変更し、ハイドレーションエラーを回避
  const [formContactId, setFormContactId] = useState("");
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formBrandId, setFormBrandId] = useState(ALL_BRAND_ID);
  const [formDeptId, setFormDeptId] = useState(ALL_DEPT_ID);
  const [formRole, setFormRole] = useState("");
  const [formTags, setFormTags] = useState(""); // カンマ区切り

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // ページネーション
  const [page, setPage] = useState(1); 

  // ====== データロード関数 ======
  const loadAllData = async () => {
    try {
        const [bRes, dRes, cRes] = await Promise.all([
          fetch("/api/brands"),
          fetch("/api/depts"),
          fetch("/api/contacts"),
        ]);
        const [bJson, dJson, cJson] = await Promise.all([
          bRes.json(),
          dRes.json(),
          cRes.json(),
        ]);

        const bList: Brand[] = (bJson.brands || []).sort(
          (a: Brand, b: Brand) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999)
        );
        const dList: Dept[] = (dJson.depts || []).sort(
          (a: Dept, b: Dept) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999)
        );

        setBrands(bList);
        setDepts(dList);
        setContacts(cJson.contacts || []);
        
      } catch (e) {
        console.error("Failed to load contacts admin:", e);
        setError("担当者情報の読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
  };

  // ====== 初期ロードとIDの初期化 ======
  useEffect(() => {
    loadAllData();
    // startNew() の呼び出しは削除
  }, []);

  // ★修正: クライアントマウント時にのみIDを生成
  useEffect(() => {
    // formContactIdが空で、かつ新規作成モードであればIDを生成
    if (!formContactId && !editingId) {
        setFormContactId(generateNewContactId());
    }
  }, [formContactId, editingId]); // 依存配列に formContactId と editingId を追加

  const brandMap = useMemo(
    () =>
      brands.reduce<Record<string, Brand>>((map, b) => {
        map[b.brandId] = b;
        return map;
      }, {}),
    [brands]
  );

  const deptMap = useMemo(
    () =>
      depts.reduce<Record<string, Dept>>((map, d) => {
        map[d.deptId] = d;
        return map;
      }, {}),
    [depts]
  );

  // ====== フィルタ済み一覧 (並び替え済み) ======
  const filteredContacts = useMemo(() => {
    const kw = keyword.trim().toLowerCase();

    return contacts.filter((c) => {
      // ブランド
      if (
        filterBrand !== ALL_BRAND_ID &&
        !(c.brandId === ALL_BRAND_ID || c.brandId === filterBrand)
      ) {
        return false;
      }

      // 部署
      if (filterDept !== ALL_DEPT_ID && c.deptId !== filterDept) {
        return false;
      }

      if (!kw) return true;

      const deptLabel = deptMap[c.deptId]?.name ?? "";
      const brandLabel = brandMap[c.brandId]?.name ?? "";
      const haystack = [
        c.contactId,
        c.name,
        c.email,
        c.role ?? "",
        deptLabel,
        brandLabel,
        ...(c.tags || []),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(kw);
    }).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [contacts, filterBrand, filterDept, keyword, deptMap, brandMap]);

  // ページネーションロジック
  const { currentContacts, totalPages, safePage } = useMemo(() => {
    const total = Math.max(1, Math.ceil((filteredContacts.length || 0) / PAGE_SIZE));
    const sp = Math.min(Math.max(1, page), total);
    const start = (sp - 1) * PAGE_SIZE;
    const slice = filteredContacts.slice(start, start + PAGE_SIZE);
    return { currentContacts: slice, totalPages: total, safePage: sp };
  }, [filteredContacts, page]);

  // フィルタ条件が変わったら1ページ目に戻す
  useEffect(() => {
    setPage(1);
  }, [filterBrand, filterDept, keyword]);
  
  // データ増減で page が範囲外になったら補正
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage]);

  const handlePrev = () => setPage((p) => Math.max(1, p - 1));
  const handleNext = () => setPage((p) => Math.min(totalPages, p + 1));
  
  // 新規作成モードの判定
  const isNewCreationMode = !editingId; 
  
  // ====== フォーム関連 ======

  // 新規作成モードへ切り替え
  const startNew = () => {
    setEditingId(null);
    setFormContactId(generateNewContactId()); // ★修正: 新規切り替え時にIDを生成
    setFormName("");
    setFormEmail("");
    setFormBrandId(ALL_BRAND_ID);
    setFormDeptId(ALL_DEPT_ID);
    setFormRole("");
    setFormTags("");
    setMessage(null);
    setError(null);
  };

  // 編集モードへ切り替え
  const startEdit = (c: Contact) => {
    setEditingId(c.contactId);
    setFormContactId(c.contactId);
    setFormName(c.name);
    setFormEmail(c.email);
    setFormBrandId(c.brandId || ALL_BRAND_ID);
    setFormDeptId(c.deptId || ALL_DEPT_ID);
    setFormRole(c.role || "");
    setFormTags((c.tags || []).join(", "));
    setMessage(null);
    setError(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    const contactIdToSend = formContactId.trim();
    
    // 必須チェック
    if (!contactIdToSend) {
        setError("contactId は必須です。"); 
        return;
    }
    if (!formName.trim()) {
      setError("名前は必須です。");
      return;
    }
    if (!formEmail.trim()) {
      setError("メールアドレスは必須です。");
      return;
    }

    const payload: Contact = {
      contactId: contactIdToSend,
      name: formName.trim(),
      email: formEmail.trim(),
      brandId: formBrandId || ALL_BRAND_ID,
      deptId: formDeptId || ALL_DEPT_ID,
      role: formRole.trim() || undefined,
      tags: formTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    setSaving(true);
    try {
      const method = editingId ? "PUT" : "POST";
      
      const res = await fetch("/api/contacts", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        console.error("Save contact error:", json);
        setError(json.error || "保存に失敗しました。");
        return;
      }

      await loadAllData();
      setMessage(editingId ? "担当者情報を更新しました。" : "担当者を追加しました。");
      
      // 保存後、新規作成モードへ戻る
      startNew();
      
    } catch (e) {
      console.error(e);
      setError("保存処理中にエラーが発生しました。");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (contactId: string) => {
    if (!window.confirm(`contactId: ${contactId} を削除しますか？`)) return;

    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/contacts?contactId=${encodeURIComponent(contactId)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("Delete contact error:", json);
        setError(json.error || "削除に失敗しました。");
        return;
      }

      await loadAllData();
      setMessage("担当者を削除しました。");
      startNew();
      
    } catch (e) {
      console.error(e);
      setError("削除処理中にエラーが発生しました。");
    }
  };

  // ====== レンダリング ======

  return (
    <div className="kb-root">
      {/* ===== Top bar (デザイン統一) ===== */}
      <div className="kb-topbar">
        <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <img
                src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
                alt="KB Logo"
                style={{ width: "48px", height: "48px", objectFit: "contain" }}
            />
            <img
                src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png"
                alt="KnowBase Text Logo"
                style={{ height: "22px", objectFit: "contain" }}
            />
        </div>

        <div className="kb-topbar-center" style={{ fontSize: "18px", fontWeight: "700" }}>
            担当者管理
        </div>

        <div className="kb-topbar-right">
          <Link href="/admin">
            <button className="kb-logout-btn">
              管理メニューへ戻る
            </button>
          </Link>
        </div>
      </div>

      {/* ===== メインコンテンツ: 2カラムグリッド ===== */}
      <div className="kb-admin-grid-2col" style={{ marginTop: 16 }}>
        {/* 左カラム: 編集フォーム */}
        <section className="kb-admin-card-large">
          <div className="kb-admin-head">
            担当者 {editingId ? "編集" : "新規追加"}
            <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 400, color: '#6b7280' }}>
                (DynamoDB: yamauchi-Contacts)
            </span>
          </div>
          
          <div className="kb-manual-form">
            {message && (
              <div
                style={{ fontSize: 12, color: "#16a34a", marginBottom: 8, padding: 8, borderRadius: 6, background: '#dcfce7' }}
              >
                {message}
              </div>
            )}
            {error && (
              <div
                style={{ fontSize: 12, color: "#ef4444", marginBottom: 8, padding: 8, borderRadius: 6, background: '#fee2e2' }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">
                  contactId <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  className="kb-admin-input full"
                  type="text"
                  placeholder="自動採番"
                  value={formContactId}
                  readOnly={true} // ★修正: 常に読み取り専用
                  style={{ background: '#f3f4f8' }} // ★修正: 常にグレーアウト
                  required
                />
                <div className="kb-subnote full">
                    ※ 既存の担当者を編集する場合は、右の一覧から選択してください。
                    {isNewCreationMode && formContactId && ( // formContactId が存在する場合のみ表示
                        <span style={{color: '#ef4444'}}> (仮ID: {formContactId} が自動採番されています)</span>
                    )}
                </div>
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">
                    名前 <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    className="kb-admin-input full"
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="kb-admin-label">
                    メールアドレス <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    className="kb-admin-input full"
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">対象ブランド</label>
                  <select
                    className="kb-admin-select full"
                    value={formBrandId}
                    onChange={(e) => setFormBrandId(e.target.value)}
                  >
                    <option value={ALL_BRAND_ID}>全ブランド({ALL_BRAND_ID})</option>
                    {brands.map((b) => (
                      <option key={b.brandId} value={b.brandId}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="kb-admin-label">対象部署</label>
                  <select
                    className="kb-admin-select full"
                    value={formDeptId}
                    onChange={(e) => setFormDeptId(e.target.value)}
                  >
                    <option value={ALL_DEPT_ID}>全部署({ALL_DEPT_ID})</option>
                    {depts.map((d) => (
                      <option key={d.deptId} value={d.deptId}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">役割・担当業務</label>
                <input
                  className="kb-admin-input full"
                  type="text"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  placeholder="例：MotionBoard, Canva運用, QSCチェック など"
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タグ（カンマ区切り）</label>
                <input
                  className="kb-admin-input full"
                  type="text"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  placeholder="例：Canva, 請求, PrimeDrive"
                />
              </div>

              <div className="kb-form-actions" style={{ marginTop: 'auto', paddingTop: 15 }}>
                {editingId && (
                  <button
                    className="kb-delete-btn"
                    type="button"
                    onClick={() => handleDelete(editingId)}
                    disabled={saving}
                  >
                    削除
                  </button>
                )}
                <button
                    className="kb-secondary-btn"
                    type="button"
                    onClick={startNew}
                    disabled={saving}
                >
                    新規としてやり直す
                </button>
                <button
                  className="kb-primary-btn"
                  type="submit"
                  disabled={saving || !formName.trim() || !formEmail.trim() || !formContactId.trim()}
                >
                  {saving ? "保存中..." : (editingId ? "更新する" : "追加する")}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* 右カラム: 一覧 */}
        <section className="kb-admin-card-large">
          <div className="kb-panel-header-row">
            <div className="kb-admin-head">
                担当者一覧
                <span 
                    style={{ 
                        marginLeft: 8, 
                        fontSize: 12, 
                        fontWeight: 400, 
                        color: '#6b7280' 
                    }}
                >
                    {loading ? '...' : `${filteredContacts.length}件中 ${
                        (safePage - 1) * PAGE_SIZE + 1
                    }〜${Math.min(
                        safePage * PAGE_SIZE,
                        filteredContacts.length
                    )} 件を表示`}
                </span>
            </div>
          </div>
          <div className="kb-admin-body" style={{ padding: '0 0 10px 0' }}>
            {/* フィルタ */}
            <div
              className="kb-admin-form-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 1fr 1fr",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <input
                className="kb-admin-input"
                placeholder="名前・メール・業務・タグで検索"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                disabled={loading}
              />
              <select
                className="kb-admin-select"
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                disabled={loading}
              >
                <option value={ALL_BRAND_ID}>全ブランド</option>
                {brands.map((b) => (
                  <option key={b.brandId} value={b.brandId}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                className="kb-admin-select"
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                disabled={loading}
              >
                <option value={ALL_DEPT_ID}>全部署</option>
                {depts.map((d) => (
                  <option key={d.deptId} value={d.deptId}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="kb-manual-list-admin">
              {loading && <div style={{ padding: '10px' }}>データ読み込み中...</div>}

              {!loading && currentContacts.length === 0 && (
                <div 
                    style={{ padding: "12px 10px", fontSize: 12, color: "#6b7280" }}
                >
                  条件に一致する担当者がいません。
                </div>
              )}

              {!loading && currentContacts.length > 0 && currentContacts.map((c) => { 
                  const deptLabel = c.deptId === ALL_DEPT_ID ? '全部署' : deptMap[c.deptId]?.name ?? c.deptId;
                  const brandLabel = c.brandId === ALL_BRAND_ID ? '全ブランド' : brandMap[c.brandId]?.name ?? c.brandId;

                  return (
                    <div
                      key={c.contactId}
                      className={`kb-user-item-admin ${editingId === c.contactId ? 'selected' : ''}`}
                      onClick={() => startEdit(c)}
                    >
                      <div className="kb-user-title">
                        {c.name}{" "}
                        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 4 }}>({c.contactId})</span>
                      </div>
                      <div className="kb-user-email-meta">{c.email}</div>
                      <div className="kb-user-meta-info">
                          {brandLabel} / {deptLabel}
                      </div>
                      {c.role && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#4b5563",
                            marginTop: 4,
                          }}
                        >
                          {c.role}
                        </div>
                      )}
                      <div className="kb-tag-row" style={{ marginTop: 4 }}>
                          {(c.tags || []).map((t, i) => (
                            <span className="kb-tag" key={i}>{t}</span>
                          ))}
                      </div>
                    </div>
                  );
                })}
            </div>
            
            {/* ページャーの追加 */}
            {totalPages > 1 && (
                <div className="kb-pager" style={{ marginTop: 15, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="kb-pager-btn"
                    onClick={handlePrev}
                    disabled={safePage === 1}
                  >
                    ← 前へ
                  </button>
                  <span className="kb-pager-info">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="kb-pager-btn"
                    onClick={handleNext}
                    disabled={safePage === totalPages}
                  >
                    次へ →
                  </button>
                </div>
            )}
          </div>
        </section>
      </div>

      {/* スタイル定義はマニュアル管理と共通化 */}
      <style jsx>{`
        .kb-admin-grid-2col {
            display: grid;
            grid-template-columns: 2fr 3fr; 
            gap: 16px;
            margin-top: 16px;
        }
        .kb-admin-card-large {
            background: #ffffff;
            border-radius: 16px;
            padding: 16px;
            box-shadow: 0 10px 20px rgba(15, 23, 42, 0.04);
            border: 1px solid #e5e7eb;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
        }
        .kb-panel-header-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .kb-admin-head {
            font-size: 16px;
            font-weight: 700;
        }
        .kb-manual-list-admin {
            flex-grow: 1;
            overflow-y: auto;
            padding-right: 4px; 
        }
        /* 担当者アイテムのスタイル (一覧) */
        .kb-user-item-admin {
            padding: 10px 12px;
            border-radius: 10px;
            margin-bottom: 8px;
            border: 1px solid #f1f5f9;
            background: #f9fafb;
            cursor: pointer;
            transition: all 0.1s ease;
        }
        .kb-user-item-admin:hover {
            background: #eff6ff;
            border-color: #dbeafe;
        }
        .kb-user-item-admin.selected {
            background: #e0f2fe;
            border-color: #0ea5e9;
            box-shadow: 0 0 0 1px #0ea5e9;
        }
        .kb-user-title {
            font-size: 14px;
            font-weight: 600;
        }
        .kb-user-email-meta {
            font-size: 11px;
            color: #0ea5e9;
            margin-top: 2px;
        }
        .kb-user-meta-info {
            font-size: 11px;
            color: #6b7280;
            margin-top: 2px;
        }
        .kb-tag {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 999px;
            background: #e0f2fe;
            color: #0369a1;
        }
        .kb-tag-row {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        
        .kb-manual-form {
            overflow-y: auto;
            flex-grow: 1;
            padding-right: 4px;
        }
        .kb-admin-form-row {
            margin-bottom: 15px;
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .kb-admin-form-row.two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        .kb-admin-form-row .full {
            grid-column: 1 / -1;
        }
        .kb-admin-label {
            display: block;
            font-size: 12px;
            color: #4b5563;
            margin-bottom: 4px;
            font-weight: 600;
        }
        .kb-admin-input, .kb-admin-select {
            width: 100%;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid #d1d5db;
            font-size: 13px;
            background: #ffffff;
        }
        .kb-admin-input:read-only {
             background: #f3f4f8; /* 読み取り専用はグレーアウト */
             color: #6b7280;
        }
        .kb-subnote {
            font-size: 11px;
            color: #9ca3af;
        }
        .kb-form-actions {
            padding-top: 15px;
            border-top: 1px dashed #e5e7eb;
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }
        .kb-primary-btn, .kb-secondary-btn, .kb-delete-btn {
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            border-radius: 999px;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.15s ease;
        }
        .kb-primary-btn {
            background: #0ea5e9;
            color: #ffffff;
        }
        .kb-secondary-btn { 
            background: #ffffff;
            border-color: #d1d5db;
            color: #374151;
        }
        .kb-delete-btn {
            background: #fecaca;
            border-color: #fca5a5;
            color: #b91c1c;
            margin-right: auto;
        }
        
        /* ページャーのスタイルは app/globals.css に依存 */
        .kb-pager {
            /* スタイル調整用に display: flex を設定 */
            display: flex; 
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: #6b7280;
        }
        .kb-pager-btn {
            /* app/globals.css のスタイルを継承 */
        }

        @media (max-width: 960px) {
            .kb-admin-grid-2col {
                grid-template-columns: 1fr;
            }
        }
      `}</style>
    </div>
  );
}