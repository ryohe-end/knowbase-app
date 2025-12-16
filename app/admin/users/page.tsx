// /app/admin/users/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
// types/user, brand, dept のローカルコピーを更新
export type KbUserRole = "admin" | "editor" | "viewer";
export type KbUser = {
  userId: string;
  name: string;
  email: string;
  role: KbUserRole;
  brandIds?: string[]; 
  // ★修正: deptIdsを削除
  groupIds?: string[]; 
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};
type Brand = { brandId: string; name: string };
// ★修正: Deptタイプを削除
type Group = { groupId: string; groupName: string }; 


const ROLE_OPTIONS: { value: KbUserRole; label: string }[] = [
  { value: "admin", label: "管理者" },
  { value: "editor", label: "編集者" },
  { value: "viewer", label: "閲覧のみ" },
];

const DEFAULT_USER_FORM: KbUser = {
    userId: "",
    name: "",
    email: "",
    role: "viewer",
    brandIds: [],
    // ★修正: deptIdsを削除
    groupIds: [],
    isActive: true,
};

// ヘルパー関数: 新規ユーザーの仮IDを生成
const generateNewUserId = () => {
  return `U900-${Date.now().toString().slice(-6)}`;
};


export default function AdminUsersPage() {
  const [users, setUsers] = useState<KbUser[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  // ★修正: depts Stateを削除
  const [groups, setGroups] = useState<Group[]>([]); 
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // フォーム状態
  const [form, setForm] = useState<KbUser>(DEFAULT_USER_FORM);
  const [newPassword, setNewPassword] = useState(""); // パスワード入力フィールドの状態

  // ====== データロード関数 ======
  async function loadAllData() {
    try {
        // ★修正: fetch("/api/depts")を削除
        const [uRes, bRes, gRes] = await Promise.all([ 
            fetch("/api/users"),
            fetch("/api/brands"),
            fetch("/api/groups"),
        ]);

        // ★修正: dJsonを削除
        const [uJson, bJson, gJson] = await Promise.all([
            uRes.json(),
            bRes.json(),
            gRes.json(), 
        ]);

        setUsers(uJson.users ?? []);
        setBrands(bJson.brands || []);
        // ★修正: setDeptsを削除
        setGroups(gJson.groups || []); 
    } catch (err) {
      console.error("Failed to fetch admin data:", err);
    } finally {
      setLoading(false);
    }
  }

  // ====== 初期ロードとID生成 ======
  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    // フォームIDが空(初期状態)で、かつ新規作成モードであればIDを生成
    if (!form.userId && !selectedUserId) {
        setForm(prev => ({ ...prev, userId: generateNewUserId() }));
    }
  }, [form.userId, selectedUserId]);
  
  // マップの作成
  const brandMap = useMemo(() => brands.reduce((acc, b) => ({ ...acc, [b.brandId]: b }), {} as Record<string, Brand>), [brands]);
  // ★修正: deptMapを削除
  const groupMap = useMemo(() => groups.reduce((acc, g) => ({ ...acc, [g.groupId]: g }), {} as Record<string, Group>), [groups]); 

  // ====== 一覧 → 絞り込み ======
  const filteredUsers = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return users;

    return users.filter((u) => {
      const brandNames = (u.brandIds || []).map(id => brandMap[id]?.name || id).join(' ');
      // ★修正: 部署関連のロジックを削除
      const groupNames = (u.groupIds || []).map(id => groupMap[id]?.groupName || id).join(' ');

      const haystack = [
        u.userId,
        u.name,
        u.email,
        u.role,
        brandNames,
        // ★修正: deptNamesを削除
        groupNames, 
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(kw);
    });
  }, [users, search, brandMap, groupMap]); // ★修正: deptMapを削除

  // ====== 一覧行クリック → フォームへ反映 ======
  function handleSelectUser(u: KbUser) {
    setSelectedUserId(u.userId);
    setForm({
      userId: u.userId,
      name: u.name,
      email: u.email,
      role: u.role ?? "viewer",
      brandIds: u.brandIds ?? [],
      // ★修正: deptIdsを削除
      groupIds: u.groupIds ?? [], 
      isActive: u.isActive ?? true,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    });
    setNewPassword(""); // 既存ユーザーを選択したらパスワード欄をクリア
  }

  // ====== 新規作成モード ======
  function handleNewUser() {
    setSelectedUserId(null);
    setForm({
        ...DEFAULT_USER_FORM,
        userId: generateNewUserId() // 仮IDを付与
    });
    setNewPassword(""); // 新規作成時もパスワード欄をクリア
  }
  
  // フォームの入力処理 (通常テキスト・セレクトボックス)
  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    if (type === 'checkbox' && name === 'isActive') {
        setForm(prev => ({ ...prev, isActive: (e.target as HTMLInputElement).checked }));
        return;
    }
    
    setForm(prev => ({ ...prev, [name]: value }));
  };
  
  // ★ 修正: ID配列のON/OFFを切り替えるハンドラー (単一選択ロジックを両方に適用)
  const handleIdToggle = (name: 'brandIds' | 'groupIds', id: string) => { 
    setForm(prev => {
        const currentIds = prev[name] || [];
        
        // 単一選択ロジック (brandIds, groupIds共通)
        if (currentIds.includes(id)) {
            // 既に選択されている場合は解除 (クリア)
            return { 
                ...prev, 
                [name]: [] 
            };
        } else {
            // 新しいIDを選択 (配列全体を新しいIDのみで置き換え)
            return { 
                ...prev, 
                [name]: [id] 
            };
        }
    });
  };

  // ====== 保存（作成 / 更新） ======
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.userId.trim() || !form.email.trim() || !form.name.trim()) {
      alert("ユーザーID、氏名、メールアドレスは必須です。");
      return;
    }
    
    // 新規作成モードで、パスワードが空の場合は警告
    if (isNewCreationMode && !newPassword.trim()) {
        if (!confirm("新規ユーザーですが、パスワードが設定されていません。続行しますか？ (Googleログインのみで運用する場合に許可)")) {
            return;
        }
    }
    
    // パスワードが入力された場合、8文字以上のチェック (簡易チェック)
    if (newPassword.trim().length > 0 && newPassword.trim().length < 8) {
        alert("パスワードは8文字以上である必要があります。");
        return;
    }


    setSaving(true);
    try {
      const isNew = form.userId.startsWith("U900-");
      
      const payload = {
        mode: isNew ? "create" : "update",
        user: form,
        newPassword: newPassword.trim() || undefined // パスワードをバックエンドに送信
      };
      
      const res = await fetch("/api/users", {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("Save error:", json);
        alert(`保存に失敗しました: ${json.error || "不明なエラー"}`);
        return;
      }

      await loadAllData();
      
      const saved: KbUser = json.user;
      setSelectedUserId(saved.userId);
      setForm(saved);
      setNewPassword(""); // 保存成功後、パスワード欄をクリア
      alert("保存しました。");
    } catch (err) {
      console.error(err);
      alert("保存時にエラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  // ====== 削除 ======
  async function handleDelete() {
    if (!selectedUserId) return;
    if (!confirm(`ユーザー ${selectedUserId} を削除しますか？`)) return;

    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "delete",
          user: { userId: selectedUserId },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("Delete error:", json);
        alert("削除に失敗しました。");
        return;
      }

      await loadAllData();
      handleNewUser();
      alert("削除しました。");
    } catch (err) {
      console.error(err);
      alert("削除時にエラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  const isNewCreationMode = form.userId.startsWith("U900-");


  // ====== 画面 ======
  return (
    <div className="kb-root">
      {/* ... Top bar のコードは省略 ... */}
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
            ユーザー管理
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
        {/* 左カラム: ユーザー一覧 */}
        <section className="kb-admin-card-large">
          <div className="kb-panel-header-row">
            <div className="kb-admin-head">
              ユーザー一覧
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  color: "#6b7280",
                  fontWeight: 400,
                }}
              >
                {loading ? "読み込み中..." : `${filteredUsers.length}件`}
              </span>
            </div>
             <button 
                className="kb-primary-btn" 
                onClick={handleNewUser}
                style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999 }}
                disabled={loading}
            >
                ＋ 新規作成
            </button>
          </div>
          <div className="kb-admin-body" style={{ padding: '0 0 10px 0' }}>
            <input
              className="kb-admin-input"
              placeholder="ID / 名前 / メール / 権限 / 所属で検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading}
              style={{ marginBottom: 12 }}
            />
            <div
              className="kb-manual-list-admin"
            >
              {loading && <div style={{ padding: '10px' }}>データ読み込み中...</div>}
              {!loading && filteredUsers.length === 0 && (
                <div
                  style={{
                    padding: "12px 10px",
                    fontSize: 12,
                    color: "#6b7280",
                  }}
                >
                  {users.length === 0 ? "ユーザーが登録されていません。" : "検索条件に一致するユーザーがいません。"}
                </div>
              )}
              {!loading && filteredUsers.map((u) => (
                <div
                  key={u.userId}
                  onClick={() => handleSelectUser(u)}
                  className={`kb-user-item-admin ${selectedUserId === u.userId ? 'selected' : ''}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="kb-user-title">{u.name} ({u.userId})</div>
                    <div 
                        className="kb-user-role-badge"
                        style={{ 
                            backgroundColor: u.role === 'admin' ? '#fecaca' : u.role === 'editor' ? '#ffedd5' : '#e0f2fe',
                            color: u.role === 'admin' ? '#b91c1c' : u.role === 'editor' ? '#9a3412' : '#0369a1' 
                        }}
                    >
                        {ROLE_OPTIONS.find(r => r.value === u.role)?.label || u.role}
                    </div>
                  </div>
                  <div className="kb-user-email-meta">{u.email}</div>
                  <div className="kb-user-meta-info">
                    {u.brandIds?.length ? `ブランド: ${u.brandIds.map(id => brandMap[id]?.name || id).join(", ")}` : "ブランド: 全て"}
                    {" / "}
                    {u.groupIds?.length > 0 && 
                        <span style={{ color: '#374151' }}>
                            属性: {u.groupIds.map(id => groupMap[id]?.groupName || id).join(", ")}
                        </span>
                    }
                    {u.isActive ? '' : ' / [無効]'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 右カラム: フォーム */}
        <section className="kb-admin-card-large">
          <div className="kb-admin-head">
            {selectedUserId ? (isNewCreationMode ? "ユーザー新規作成" : "ユーザー編集") : "ユーザー新規作成"}
          </div>
          <div className="kb-manual-form">
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">
                  ユーザーID <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  className="kb-admin-input full"
                  type="text"
                  name="userId"
                  value={form.userId}
                  onChange={handleFormChange}
                  readOnly={true} 
                  style={{ background: '#f3f4f8' }}
                  placeholder="自動採番"
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">
                  氏名 <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  className="kb-admin-input full"
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  required
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">
                  メールアドレス <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  className="kb-admin-input full"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleFormChange}
                  required
                />
              </div>

              {/* パスワード設定欄 */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">
                  パスワード設定/変更
                </label>
                <input
                  className="kb-admin-input full"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={isNewCreationMode ? "新規パスワード (8文字以上推奨)" : "変更する場合のみ入力"}
                />
                <div className="kb-subnote full">
                    ※ 入力がない場合、パスワードは変更されません。(新規作成時は空のまま保存可能ですが、メール/パスワード認証はできません)
                </div>
              </div>


              <div className="kb-admin-form-row full">
                <label className="kb-admin-label full">権限ロール</label>
                <select
                  className="kb-admin-select full"
                  name="role"
                  value={form.role}
                  onChange={handleFormChange}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 対象ブランドID (単一選択) */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">
                  対象ブランド
                </label>
                <div className="kb-chip-list full" style={{ marginBottom: 4 }}>
                  {brands.map((b) => {
                    // 単一選択なので、form.brandIdsの最初の要素と比較すればOK
                    const isSelected = form.brandIds?.[0] === b.brandId;
                    return (
                      <button
                        key={b.brandId}
                        type="button"
                        className={`kb-chip small ${isSelected ? 'kb-chip-active' : ''}`}
                        onClick={() => handleIdToggle('brandIds', b.brandId)} // ★修正されたハンドラーを使用
                      >
                        {b.name} ({b.brandId})
                      </button>
                    );
                  })}
                </div>
                <div className="kb-subnote full">
                    ※ ユーザーがアクセスできるブランドを**1つ**制限します。
                </div>
              </div>
              
              {/* 対象属性グループ (単一選択) */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">
                  対象属性グループ
                </label>
                <div className="kb-chip-list full" style={{ marginBottom: 4 }}>
                  {groups.map((g) => {
                    // 単一選択なので、form.groupIdsの最初の要素と比較すればOK
                    const isSelected = form.groupIds?.[0] === g.groupId;
                    return (
                      <button
                        key={g.groupId}
                        type="button"
                        className={`kb-chip small ${isSelected ? 'kb-chip-active' : ''}`}
                        onClick={() => handleIdToggle('groupIds', g.groupId)} // ★修正されたハンドラーを使用
                      >
                        {g.groupName} ({g.groupId})
                      </button>
                    );
                  })}
                </div>
                <div className="kb-subnote full" style={{ marginTop: 4 }}>
                    ※ ユーザーが所属する属性グループを**1つ**設定します。
                </div>
              </div>


              <div className="kb-admin-form-row">
                <div className="kb-checkbox-wrap">
                  <input
                    id="isActive"
                    type="checkbox"
                    name="isActive"
                    checked={form.isActive ?? true}
                    onChange={handleFormChange}
                  />
                  <label htmlFor="isActive">
                    有効なユーザーとして扱う
                  </label>
                </div>
              </div>

              {/* フォームアクションボタン */}
              <div className="kb-form-actions" style={{ marginTop: 'auto', paddingTop: 15 }}>
                {selectedUserId && !isNewCreationMode && (
                    <button
                      type="button"
                      className="kb-delete-btn"
                      onClick={handleDelete}
                      disabled={saving}
                    >
                      削除
                    </button>
                )}
                
                <button
                  type="button"
                  className="kb-secondary-btn"
                  onClick={handleNewUser}
                  disabled={saving}
                >
                  新規としてやり直す
                </button>
                
                <button
                  className="kb-primary-btn"
                  type="submit"
                  disabled={saving || !form.name || !form.email}
                >
                  {saving ? "保存中..." : (isNewCreationMode ? "新規作成" : "保存")}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}