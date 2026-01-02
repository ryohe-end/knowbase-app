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
  groupIds?: string[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type Brand = { brandId: string; name: string };
type Group = { groupId: string; groupName: string };

const ROLE_OPTIONS: { value: KbUserRole; label: string }[] = [
  { value: "admin", label: "管理者" },
  { value: "viewer", label: "閲覧のみ" },
];

const DEFAULT_USER_FORM: KbUser = {
  userId: "",
  name: "",
  email: "",
  role: "viewer",
  brandIds: [],
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // フォーム状態
  const [form, setForm] = useState<KbUser>(DEFAULT_USER_FORM);
  const [newPassword, setNewPassword] = useState("");

  // ✅ ローディング表示用
  const [busyText, setBusyText] = useState<string>("");
  const busy = loading || saving;

  // ✅ 新規/既存判定は selectedUserId 基準（安全）
  const isNewCreationMode = !selectedUserId;

  // ====== データロード関数 ======
  async function loadAllData() {
    setLoading(true);
    try {
      const [uRes, bRes, gRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/brands"),
        fetch("/api/groups"),
      ]);

      const [uJson, bJson, gJson] = await Promise.all([
        uRes.json(),
        bRes.json(),
        gRes.json(),
      ]);

      setUsers(uJson.users ?? []);
      setBrands(bJson.brands || []);
      setGroups(gJson.groups || []);
    } catch (err) {
      console.error("Failed to fetch admin data:", err);
    } finally {
      setLoading(false);
    }
  }

  // ====== 初期ロード ======
  useEffect(() => {
    loadAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== 新規作成時: userIdが空なら自動採番 ======
  useEffect(() => {
    if (isNewCreationMode && !form.userId) {
      setForm((prev) => ({ ...prev, userId: generateNewUserId() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewCreationMode, form.userId]);

  // マップの作成
  const brandMap = useMemo(
    () =>
      brands.reduce(
        (acc, b) => ({ ...acc, [b.brandId]: b }),
        {} as Record<string, Brand>
      ),
    [brands]
  );

  const groupMap = useMemo(
    () =>
      groups.reduce(
        (acc, g) => ({ ...acc, [g.groupId]: g }),
        {} as Record<string, Group>
      ),
    [groups]
  );

  // ====== 一覧 → 絞り込み ======
  const filteredUsers = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return users;

    return users.filter((u) => {
      const brandNames = (u.brandIds || [])
        .map((id) => brandMap[id]?.name || id)
        .join(" ");
      const groupNames = (u.groupIds || [])
        .map((id) => groupMap[id]?.groupName || id)
        .join(" ");

      const haystack = [
        u.userId,
        u.name,
        u.email,
        u.role,
        brandNames,
        groupNames,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(kw);
    });
  }, [users, search, brandMap, groupMap]);

  // ====== 一覧行クリック → フォームへ反映 ======
  function handleSelectUser(u: KbUser) {
    if (saving) return; // ✅ 処理中の誤操作防止
    setSelectedUserId(u.userId);
    setForm({
      userId: u.userId,
      name: u.name,
      email: u.email,
      role: u.role ?? "viewer",
      brandIds: u.brandIds ?? [],
      groupIds: u.groupIds ?? [],
      isActive: u.isActive ?? true,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    });
    setNewPassword("");
  }

  // ====== 新規作成モード ======
  function handleNewUser() {
    setSelectedUserId(null);
    setForm({
      ...DEFAULT_USER_FORM,
      userId: generateNewUserId(),
    });
    setNewPassword("");
  }

  // ✅ クリアボタン：新規作成モードに戻す（=フォーム初期化）
  function handleClear() {
    if (saving) return;
    const ok = confirm("入力内容をクリアして、新規作成モードに戻しますか？");
    if (!ok) return;
    handleNewUser();
  }

  // フォームの入力処理 (通常テキスト・セレクトボックス)
  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;

    if (type === "checkbox" && name === "isActive") {
      setForm((prev) => ({
        ...prev,
        isActive: (e.target as HTMLInputElement).checked,
      }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // ID配列のON/OFFを切り替えるハンドラー（単一選択）
  const handleIdToggle = (name: "brandIds" | "groupIds", id: string) => {
    setForm((prev) => {
      const currentIds = prev[name] || [];
      if (currentIds.includes(id)) {
        return { ...prev, [name]: [] };
      }
      return { ...prev, [name]: [id] };
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
      if (
        !confirm(
          "新規ユーザーですが、パスワードが設定されていません。続行しますか？ (Googleログインのみで運用する場合に許可)"
        )
      ) {
        return;
      }
    }

    // パスワードが入力された場合、8文字以上チェック
    if (newPassword.trim().length > 0 && newPassword.trim().length < 8) {
      alert("パスワードは8文字以上である必要があります。");
      return;
    }

    setBusyText(isNewCreationMode ? "新規作成しています..." : "更新しています...");
    setSaving(true);

    try {
      const payload = {
        mode: isNewCreationMode ? "create" : "update",
        user: form,
        newPassword: newPassword.trim() || undefined,
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
      setNewPassword("");
      alert("保存しました。");
    } catch (err) {
      console.error(err);
      alert("保存時にエラーが発生しました。");
    } finally {
      setBusyText("");
      setSaving(false);
    }
  }

  // ====== 削除 ======
  async function handleDelete() {
    if (!selectedUserId) return;

    const u = users.find((x) => x.userId === selectedUserId);
    const ok = confirm(
      `⚠️ ユーザーを削除します\n\n` +
        `ID: ${selectedUserId}\n` +
        `氏名: ${u?.name ?? ""}\n` +
        `メール: ${u?.email ?? ""}\n\n` +
        `この操作は取り消せません。本当に削除しますか？`
    );
    if (!ok) return;

    setBusyText("削除しています...");
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
        alert(`削除に失敗しました: ${json.error || "不明なエラー"}`);
        return;
      }

      await loadAllData();
      handleNewUser();
      alert("削除しました。");
    } catch (err) {
      console.error(err);
      alert("削除時にエラーが発生しました。");
    } finally {
      setBusyText("");
      setSaving(false);
    }
  }

  // ====== 画面 ======
  return (
    <div className="kb-root">
      {/* ✅ 全画面ローディング */}
      {busy && (
        <div className="kb-loading-overlay" role="alert" aria-busy="true">
          <div className="kb-loading-card">
            <div className="kb-loading-row">
              <div className="kb-spinner" />
              <div>
                <div className="kb-loading-title">
                  {busyText || (loading ? "読み込み中..." : "処理中...")}
                </div>
                <div className="kb-loading-sub">
                  画面を閉じずにそのままお待ちください
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="kb-topbar">
        <Link
          href="/admin"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            textDecoration: "none",
          }}
        >
          <div
            className="kb-topbar-left"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              cursor: "pointer",
            }}
          >
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

        <div
          className="kb-topbar-center"
          style={{ fontSize: "18px", fontWeight: "700" }}
        >
          ユーザー管理
        </div>

        <div className="kb-topbar-right">
          <Link href="/admin">
            <button className="kb-logout-btn" disabled={saving}>
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
              disabled={loading || saving}
            >
              ＋ 新規作成
            </button>
          </div>

          <div className="kb-admin-body" style={{ padding: "0 0 10px 0" }}>
            <input
              className="kb-admin-input"
              placeholder="ID / 名前 / メール / 権限 / 所属で検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading || saving}
              style={{ marginBottom: 12 }}
            />

            <div className="kb-manual-list-admin">
              {loading && <div style={{ padding: "10px" }}>データ読み込み中...</div>}

              {!loading && filteredUsers.length === 0 && (
                <div
                  style={{
                    padding: "12px 10px",
                    fontSize: 12,
                    color: "#6b7280",
                  }}
                >
                  {users.length === 0
                    ? "ユーザーが登録されていません。"
                    : "検索条件に一致するユーザーがいません。"}
                </div>
              )}

              {!loading &&
                filteredUsers.map((u) => (
                  <div
                    key={u.userId}
                    onClick={() => handleSelectUser(u)}
                    className={`kb-user-item-admin ${
                      selectedUserId === u.userId ? "selected" : ""
                    }`}
                    style={{ cursor: saving ? "not-allowed" : "pointer" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div className="kb-user-title">
                        {u.name} ({u.userId})
                      </div>
                      <div
                        className="kb-user-role-badge"
                        style={{
                          backgroundColor:
                            u.role === "admin"
                              ? "#fecaca"
                              : u.role === "editor"
                              ? "#ffedd5"
                              : "#e0f2fe",
                          color:
                            u.role === "admin"
                              ? "#b91c1c"
                              : u.role === "editor"
                              ? "#9a3412"
                              : "#0369a1",
                        }}
                      >
                        {ROLE_OPTIONS.find((r) => r.value === u.role)?.label || u.role}
                      </div>
                    </div>

                    <div className="kb-user-email-meta">{u.email}</div>

                    <div className="kb-user-meta-info">
                      {u.brandIds?.length
                        ? `ブランド: ${u.brandIds
                            .map((id) => brandMap[id]?.name || id)
                            .join(", ")}`
                        : "ブランド: 全て"}
                      {" / "}
                      {(u.groupIds?.length ?? 0) > 0 && (
                        <span style={{ color: "#374151" }}>
                          属性: {(u.groupIds ?? [])
                            .map((id) => groupMap[id]?.groupName || id)
                            .join(", ")}
                        </span>
                      )}
                      {u.isActive ? "" : " / [無効]"}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </section>

        {/* 右カラム: フォーム */}
        <section className="kb-admin-card-large">
          <div className="kb-admin-head">
            {selectedUserId ? "ユーザー編集" : "ユーザー新規作成"}
          </div>

          <div className="kb-manual-form">
            <form
              onSubmit={handleSave}
              style={{ display: "flex", flexDirection: "column", height: "100%" }}
            >
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
                  style={{ background: "#f3f4f8" }}
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
                  disabled={saving}
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
                  disabled={saving}
                />
              </div>

              {/* パスワード設定欄 */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">パスワード設定/変更</label>
                <input
                  className="kb-admin-input full"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={
                    isNewCreationMode
                      ? "新規パスワード (8文字以上推奨)"
                      : "変更する場合のみ入力"
                  }
                  disabled={saving}
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
                  disabled={saving}
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
                <label className="kb-admin-label full">対象ブランド</label>
                <div className="kb-chip-list full" style={{ marginBottom: 4 }}>
                  {brands.map((b) => {
                    const isSelected = form.brandIds?.[0] === b.brandId;
                    return (
                      <button
                        key={b.brandId}
                        type="button"
                        className={`kb-chip small ${isSelected ? "kb-chip-active" : ""}`}
                        onClick={() => handleIdToggle("brandIds", b.brandId)}
                        disabled={saving}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
                <div className="kb-subnote full">
                  ※ ユーザーがアクセスできるブランドを<strong>1つ</strong>制限します。
                </div>
              </div>

              {/* 対象属性グループ (単一選択) */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">対象属性グループ</label>
                <div className="kb-chip-list full" style={{ marginBottom: 4 }}>
                  {groups.map((g) => {
                    const isSelected = form.groupIds?.[0] === g.groupId;
                    return (
                      <button
                        key={g.groupId}
                        type="button"
                        className={`kb-chip small ${isSelected ? "kb-chip-active" : ""}`}
                        onClick={() => handleIdToggle("groupIds", g.groupId)}
                        disabled={saving}
                      >
                        {g.groupName}
                      </button>
                    );
                  })}
                </div>
                <div className="kb-subnote full" style={{ marginTop: 4 }}>
                  ※ ユーザーが所属する属性グループを<strong>1つ</strong>設定します。
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
                    disabled={saving}
                  />
                  <label htmlFor="isActive">有効なユーザーとして扱う</label>
                </div>
              </div>

              {/* フォームアクションボタン */}
              <div
                className="kb-form-actions"
                style={{
                  marginTop: "auto",
                  paddingTop: 15,
                  display: "flex",
                  gap: "10px",
                  justifyContent: "flex-end",
                }}
              >
                {/* ✅ クリア（いつでも出す） */}
                <button
                  type="button"
                  className="kb-logout-btn"
                  onClick={handleClear}
                  disabled={saving}
                  style={{ margin: 0 }}
                  title="入力内容をリセットして新規作成モードに戻します"
                >
                  クリア
                </button>

                {/* ✅ 既存ユーザー編集時のみ削除（おしゃれ赤） */}
                {!!selectedUserId && (
                  <button
                    type="button"
                    className="kb-danger-btn"
                    onClick={handleDelete}
                    disabled={saving}
                    style={{ margin: 0 }}
                  >
                    削除
                  </button>
                )}

                {/* 保存・更新ボタン */}
                <button
                  className="kb-primary-btn"
                  type="submit"
                  disabled={saving || !form.name || !form.email}
                  style={{ minWidth: "100px" }}
                >
                  {saving ? "処理中..." : selectedUserId ? "更新" : "新規作成"}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
