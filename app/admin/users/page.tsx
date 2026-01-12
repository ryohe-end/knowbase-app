"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";

/* ========= 型 ========= */
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

const generateNewUserId = () => `U900-${Date.now().toString().slice(-6)}`;

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

  // ✅ メールに一時パスワード含める（新規/再発行時）
  const [includePasswordInMail, setIncludePasswordInMail] = useState(true);

  // ✅ ローディング表示用
  const [busyText, setBusyText] = useState<string>("");
  const busy = loading || saving;

  // ✅ 新規/既存判定
  const isNewCreationMode = !selectedUserId;

  // ====== データロード ======
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

  // ====== 新規作成時: userId 自動採番 ======
  useEffect(() => {
    if (isNewCreationMode && !form.userId) {
      setForm((prev) => ({ ...prev, userId: generateNewUserId() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewCreationMode, form.userId]);

  // マップ作成
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

      const haystack = [u.userId, u.name, u.email, u.role, brandNames, groupNames]
        .join(" ")
        .toLowerCase();

      return haystack.includes(kw);
    });
  }, [users, search, brandMap, groupMap]);

  // ====== 一覧行クリック → フォームへ反映 ======
  function handleSelectUser(u: KbUser) {
    if (saving) return;
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
    setIncludePasswordInMail(true);
  }

  // ====== 新規作成モード ======
  function handleNewUser() {
    setSelectedUserId(null);
    setForm({
      ...DEFAULT_USER_FORM,
      userId: generateNewUserId(),
    });
    setIncludePasswordInMail(true);
  }

  // ✅ クリア（新規作成モードに戻す）
  function handleClear() {
    if (saving) return;
    const ok = confirm("入力内容をクリアして、新規作成モードに戻しますか？");
    if (!ok) return;
    handleNewUser();
  }

  // フォーム入力
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

  // ID配列（単一選択）
  const handleIdToggle = (name: "brandIds" | "groupIds", id: string) => {
    setForm((prev) => {
      const currentIds = prev[name] || [];
      if (currentIds.includes(id)) return { ...prev, [name]: [] };
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

    // 新規作成時は自動発行が走るので注意喚起
    if (isNewCreationMode) {
      const ok = confirm(
        "新規ユーザーを作成します。\n\n" +
          "・一時パスワードは自動発行されます\n" +
          (includePasswordInMail
            ? "・メールに一時パスワードを同封します\n"
            : "・メールにはURLのみ送ります（パスワードは同封しません）\n") +
          "\n続行しますか？"
      );
      if (!ok) return;
    }

    setBusyText(isNewCreationMode ? "新規作成しています..." : "更新しています...");
    setSaving(true);

    try {
      const payload = {
        mode: isNewCreationMode ? "create" : "update",
        user: form,
        includePassword: includePasswordInMail,
        // ✅ 通常 update はパスワード変更しない
        resetPassword: false,
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

      alert(isNewCreationMode ? "保存しました（メール送信しました）。" : "更新しました。");
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

  // ✅ 再送信（URLのみ）
  async function handleResendUrlOnly() {
    if (!selectedUserId) return;
    const u = users.find((x) => x.userId === selectedUserId);
    if (!u) return;

    if (u.isActive === false) {
      alert("無効ユーザーのため送信できません。先に有効化してください。");
      return;
    }

    const ok = confirm(
      `ログイン案内（URLのみ）を再送します。\n\nID: ${u.userId}\n氏名: ${u.name}\nメール: ${u.email}`
    );
    if (!ok) return;

    setBusyText("再送信しています...");
    setSaving(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "resend",
          user: { userId: u.userId },
          resetPassword: false,
          includePassword: false,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        console.error("Resend error:", json);
        alert(`再送に失敗しました: ${json.error || "不明なエラー"}`);
        return;
      }

      alert("再送しました。（URLのみ）");
    } catch (err) {
      console.error(err);
      alert("再送時にエラーが発生しました。");
    } finally {
      setBusyText("");
      setSaving(false);
    }
  }

  // ✅ パスワード再発行して送信（自動生成）
  async function handleReissuePasswordAndSend() {
    if (!selectedUserId) return;
    const u = users.find((x) => x.userId === selectedUserId);
    if (!u) return;

    if (u.isActive === false) {
      alert("無効ユーザーのため送信できません。先に有効化してください。");
      return;
    }

    const ok = confirm(
      `パスワードを再発行してメール送信します。\n\n` +
        `ID: ${u.userId}\n氏名: ${u.name}\nメール: ${u.email}\n\n` +
        `※ 一時パスワードは自動生成されます。`
    );
    if (!ok) return;

    setBusyText("パスワード再発行＆送信しています...");
    setSaving(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "resend",
          user: { userId: u.userId },
          resetPassword: true,
          includePassword: includePasswordInMail,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        console.error("Reissue error:", json);
        alert(`再発行に失敗しました: ${json.error || "不明なエラー"}`);
        return;
      }

      await loadAllData();
      alert(
        includePasswordInMail
          ? "送信しました。（一時パスワード同封）"
          : "送信しました。（URLのみ）"
      );
    } catch (err) {
      console.error(err);
      alert("再発行時にエラーが発生しました。");
    } finally {
      setBusyText("");
      setSaving(false);
    }
  }

  // ====== 画面 ======
  return (
    <div className="kb-root">
      {/* ✅ 全画面ローディング */}
      <AdminLoadingOverlay
  visible={busy}
  text={busyText || (loading ? "KnowBase 管理画面を読み込み中..." : "処理中...")}
/>

      {/* Topbar */}
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

      {/* ===== 2カラム ===== */}
      <div className="kb-admin-grid-2col" style={{ marginTop: 16 }}>
        {/* 左: 一覧 */}
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

            <div
              className="kb-manual-list-admin"
              style={{
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
                scrollSnapType: "y mandatory",
                height: "400px",
                gap: "12px",
                padding: "4px",
                WebkitOverflowScrolling: "touch",
                scrollbarWidth: "thin",
              }}
            >
              {loading && (
                <div style={{ padding: "10px" }}>データ読み込み中...</div>
              )}

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
                    style={{
                      cursor: saving ? "not-allowed" : "pointer",
                      flex: "0 0 auto",
                      scrollSnapAlign: "start",
                      margin: 0,
                      border:
                        selectedUserId === u.userId
                          ? "2px solid #3b82f6"
                          : "1px solid #e5e7eb",
                      borderRadius: "12px",
                      padding: "16px",
                      backgroundColor: "#fff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div className="kb-user-title" style={{ fontWeight: 700 }}>
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
                          padding: "2px 8px",
                          borderRadius: "99px",
                          fontSize: "11px",
                        }}
                      >
                        {ROLE_OPTIONS.find((r) => r.value === u.role)?.label ||
                          u.role}
                      </div>
                    </div>

                    <div
                      className="kb-user-email-meta"
                      style={{
                        color: "#6b7280",
                        fontSize: "13px",
                        margin: "4px 0",
                      }}
                    >
                      {u.email}
                    </div>

                    <div
                      className="kb-user-meta-info"
                      style={{
                        fontSize: "12px",
                        marginTop: "8px",
                        color: "#4b5563",
                      }}
                    >
                      {u.brandIds?.length
                        ? `ブランド: ${u.brandIds
                            .map((id) => brandMap[id]?.name || id)
                            .join(", ")}`
                        : "ブランド: 全て"}
                      {" / "}
                      {(u.groupIds?.length ?? 0) > 0 && (
                        <span>
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

        {/* 右: フォーム */}
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
                  readOnly
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

              {/* ✅ 一時パスワード同封 */}
              <div className="kb-admin-form-row">
                <div className="kb-checkbox-wrap">
                  <input
                    id="includePasswordInMail"
                    type="checkbox"
                    checked={includePasswordInMail}
                    onChange={(e) => setIncludePasswordInMail(e.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="includePasswordInMail">
                    メールに一時パスワードを含める（新規作成/再発行時）
                  </label>
                </div>
                <div className="kb-subnote full" style={{ marginTop: 6 }}>
                  ※ パスワードは手入力不要。サーバー側で自動生成します。
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

              {/* ブランド */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">対象ブランド</label>
                <div className="kb-chip-list full" style={{ marginBottom: 4 }}>
                  {brands.map((b) => {
                    const isSelected = form.brandIds?.[0] === b.brandId;
                    return (
                      <button
                        key={b.brandId}
                        type="button"
                        className={`kb-chip small ${
                          isSelected ? "kb-chip-active" : ""
                        }`}
                        onClick={() => handleIdToggle("brandIds", b.brandId)}
                        disabled={saving}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
                <div className="kb-subnote full">
                  ※ ユーザーがアクセスできるブランドを<strong>1つ</strong>
                  制限します。
                </div>
              </div>

              {/* 属性 */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">対象属性グループ</label>
                <div className="kb-chip-list full" style={{ marginBottom: 4 }}>
                  {groups.map((g) => {
                    const isSelected = form.groupIds?.[0] === g.groupId;
                    return (
                      <button
                        key={g.groupId}
                        type="button"
                        className={`kb-chip small ${
                          isSelected ? "kb-chip-active" : ""
                        }`}
                        onClick={() => handleIdToggle("groupIds", g.groupId)}
                        disabled={saving}
                      >
                        {g.groupName}
                      </button>
                    );
                  })}
                </div>
                <div className="kb-subnote full" style={{ marginTop: 4 }}>
                  ※ ユーザーが所属する属性グループを<strong>1つ</strong>
                  設定します。
                </div>
              </div>

              {/* 有効/無効 */}
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

              {/* アクション */}
              <div
                className="kb-form-actions"
                style={{
                  marginTop: "auto",
                  paddingTop: 15,
                  display: "flex",
                  gap: "10px",
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                {/* 既存ユーザーのみ */}
                {!!selectedUserId && (
                  <>
                    <button
                      type="button"
                      className="kb-logout-btn"
                      onClick={handleResendUrlOnly}
                      disabled={saving}
                      style={{ margin: 0 }}
                      title="ログインURLのみ再送します"
                    >
                      再送信（URLのみ）
                    </button>

                    <button
                      type="button"
                      className="kb-primary-btn"
                      onClick={handleReissuePasswordAndSend}
                      disabled={saving}
                      style={{ margin: 0 }}
                      title="一時パスワードを自動生成して送信します"
                    >
                      パスワード再発行して送信
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="kb-logout-btn"
                  onClick={handleClear}
                  disabled={saving}
                  style={{ margin: 0 }}
                  title="フォームを初期化して新規作成モードへ戻します"
                >
                  クリア
                </button>

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
