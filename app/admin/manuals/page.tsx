// app/admin/manuals/page.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/* ========= 型 ========= */

type Manual = {
  manualId: string;
  title: string;
  brandId?: string;
  bizId?: string;
  desc?: string | null;
  updatedAt?: string;
  tags?: string[];
  embedUrl?: string;
  noDownload?: boolean;
  startDate?: string;
  endDate?: string;
  type?: "doc" | "video";
};

type Brand = { brandId: string; name: string };
type Dept = { deptId: string; name: string };

const DRAFT_KEY = "kb_manual_draft_v1";

// 今日 YYYY-MM-DD
const getTodayDate = () => {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// 仮ID
const generateNewManualId = () => `M200-${Date.now().toString().slice(-6)}`;

// 空Manual
const createEmptyManual = (initialData: Partial<Manual> = {}): Manual => ({
  manualId: generateNewManualId(),
  title: "",
  brandId: "",
  bizId: "",
  desc: "",
  updatedAt: getTodayDate(),
  tags: [],
  embedUrl: "",
  noDownload: false,
  startDate: "",
  endDate: "",
  type: "doc",
  ...initialData,
});

// Drive/Slides 埋め込みURL整形（プレビュー用）
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
    console.warn("Failed to set draft to localStorage:", e);
  }
}

export default function AdminManuals() {
  const router = useRouter();
  const sp = useSearchParams();
  const selectId = sp.get("select"); // /admin/manuals?select=Mxxx

  const [manuals, setManuals] = useState<Manual[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCopying, setIsCopying] = useState(false);
  const [selectedManual, setSelectedManual] = useState<Manual | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [filterText, setFilterText] = useState("");

  const [manualForm, setManualForm] = useState<Manual>(createEmptyManual());

  const loadAllData = useCallback(async () => {
    try {
      const [mRes, bRes, dRes] = await Promise.all([
        fetch("/api/manuals"),
        fetch("/api/brands"),
        fetch("/api/depts"),
      ]);
      const [mJson, bJson, dJson] = await Promise.all([mRes.json(), bRes.json(), dRes.json()]);
      setManuals(mJson.manuals || []);
      setBrands(bJson.brands || []);
      setDepts(dJson.depts || []);
    } catch (e) {
      console.error("Failed to fetch admin data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // ✅ /admin/manuals?select=... が来たら、自動でそのマニュアルを選択する
  useEffect(() => {
    if (loading) return;
    if (!selectId) return;
    const found = manuals.find((m) => m.manualId === selectId);
    if (found) {
      setSelectedManual(found);
      setManualForm({ ...found });
      setIsEditing(false);
    }
    // クエリは残っててもOKだが、気になるなら router.replace('/admin/manuals') でもOK
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectId, manuals]);

  const brandMap = useMemo(
    () => brands.reduce((acc, b) => ({ ...acc, [b.brandId]: b }), {} as Record<string, Brand>),
    [brands]
  );
  const deptMap = useMemo(
    () => depts.reduce((acc, d) => ({ ...acc, [d.deptId]: d }), {} as Record<string, Dept>),
    [depts]
  );

  const handleNewManual = () => {
    setManualForm(createEmptyManual());
    setSelectedManual(null);
    setIsEditing(true);
  };

  // ✅ テンプレートから作成 → editページへ（draftはlocalStorageへ）
  const handleCreateFromTemplate = async () => {
    if (!manualForm.title) {
      alert("テンプレートコピー前に、まずタイトルを入力してください。");
      return;
    }

    setIsCopying(true);

    // ★ draft を保存（embedUrlはまだ空のまま）
    const draft = {
      ...manualForm,
      // 新規登録として扱いたいので仮IDを確定させておく
      manualId: manualForm.manualId?.startsWith("M200-") ? manualForm.manualId : generateNewManualId(),
      updatedAt: manualForm.updatedAt || getTodayDate(),
      tags: manualForm.tags || [],
    };
    safeSetDraft(draft);

    try {
      const res = await fetch("/api/drive/copy-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: manualForm.title }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        alert(
          `テンプレートの作成に失敗しました: ${
            data?.details?.error?.message || data?.error || res.statusText
          }`
        );
        return;
      }

      const fileId: string | undefined = data.fileId;
      const editUrl: string | undefined = data.editUrl;

      // ✅ 同一タブで editページへ（draftはlocalStorageにある）
      const qs = new URLSearchParams();
      if (fileId) qs.set("fileId", fileId);
      if (editUrl) qs.set("editUrl", editUrl);
      router.push(`/admin/manuals/edit?${qs.toString()}`);
    } catch (e) {
      console.error("Template copy error:", e);
      alert("テンプレートコピー処理中にエラーが発生しました。");
    } finally {
      setIsCopying(false);
      await loadAllData();
    }
  };

  const handleEditManual = (manual: Manual) => {
    setManualForm({ ...manual });
    setSelectedManual(manual);
    setIsEditing(true);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;

    if (type === "checkbox" && name === "noDownload") {
      setManualForm((prev) => ({ ...prev, noDownload: (e.target as HTMLInputElement).checked }));
      return;
    }

    if (name === "tags") {
      const tagsArray = value
        .split(/[,\s]+/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
      setManualForm((prev) => ({ ...prev, tags: tagsArray }));
      return;
    }

    setManualForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (!manualForm.title) {
      alert("タイトルは必須です。");
      return;
    }

    const payload = { ...manualForm, tags: manualForm.tags || [] };

    try {
      const isNew = manualForm.manualId.startsWith("M200-");
      const method = isNew ? "POST" : "PUT";

      const res = await fetch("/api/manuals", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        alert(`保存に失敗しました: ${json.error || res.statusText}`);
        return;
      }

      await loadAllData();

      const updatedManual = { ...payload, manualId: isNew ? json.manualId : manualForm.manualId };
      setSelectedManual(updatedManual);
      setManualForm(updatedManual);
      setIsEditing(false);
    } catch (e) {
      console.error("Save error:", e);
      alert("保存処理中にエラーが発生しました。");
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setManualForm(selectedManual || createEmptyManual());
  };

  const handleDelete = async (manualId: string) => {
    if (!window.confirm(`マニュアルID: ${manualId} を削除しますか？`)) return;

    try {
      const res = await fetch(`/api/manuals?manualId=${encodeURIComponent(manualId)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        alert(`削除に失敗しました: ${json.error || res.statusText}`);
        return;
      }

      await loadAllData();
      setSelectedManual(null);
      setIsEditing(false);
      setManualForm(createEmptyManual());
    } catch (e) {
      console.error("Delete error:", e);
      alert("削除処理中にエラーが発生しました。");
    }
  };

  const filteredManuals = useMemo(() => {
    if (loading) return [];
    const kw = filterText.trim().toLowerCase();
    if (!kw) return manuals;
    return manuals.filter((m) => {
      const desc = m.desc || "";
      return (
        m.title?.toLowerCase().includes(kw) ||
        desc.toLowerCase().includes(kw) ||
        m.manualId.toLowerCase().includes(kw) ||
        m.tags?.some((t) => t.toLowerCase().includes(kw))
      );
    });
  }, [manuals, filterText, loading]);

  const isNewCreationMode = manualForm.manualId.startsWith("M200-");

  return (
    <div className="kb-root">
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
          マニュアル管理
        </div>
        <div className="kb-topbar-right">
          <Link href="/admin">
            <button className="kb-logout-btn">管理メニューへ戻る</button>
          </Link>
        </div>
      </div>

      <div className="kb-admin-grid-2col">
        {/* 左 */}
        <div className="kb-admin-card-large">
          <div className="kb-panel-header-row">
            <div className="kb-admin-head">マニュアル一覧（{loading ? "..." : manuals.length}件）</div>
            <button
              className="kb-primary-btn"
              onClick={handleNewManual}
              style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999 }}
              disabled={loading}
            >
              ＋ 新規作成
            </button>
          </div>

          <input
            type="text"
            placeholder="タイトル、ID、タグで検索..."
            className="kb-admin-input"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ marginBottom: 12 }}
            disabled={loading}
          />

          <div className="kb-manual-list-admin">
            {loading && <div style={{ color: "#6b7280" }}>データ読み込み中...</div>}

            {!loading && filteredManuals.length > 0 ? (
              filteredManuals.map((manual) => (
                <div
                  key={manual.manualId}
                  className={`kb-manual-item-admin ${
                    selectedManual?.manualId === manual.manualId ? "selected" : ""
                  }`}
                  onClick={() => handleEditManual(manual)}
                >
                  <div className="kb-manual-title-admin">{manual.title}</div>
                  <div className="kb-manual-meta-admin">
                    {brandMap[manual.brandId || ""]?.name || "全社"} /{" "}
                    {deptMap[manual.bizId || ""]?.name || "未設定"} / 更新日:{" "}
                    {manual.updatedAt || "未設定"}
                  </div>
                </div>
              ))
            ) : (
              !loading && (
                <div style={{ color: "#6b7280" }}>
                  {manuals.length === 0
                    ? "マニュアルが登録されていません。"
                    : "検索条件に一致するマニュアルがありません。"}
                </div>
              )
            )}
          </div>
        </div>

        {/* 右 */}
        <div className="kb-admin-card-large">
          <div className="kb-admin-head">
            {isEditing
              ? isNewCreationMode
                ? "新規マニュアル作成"
                : "マニュアル編集"
              : selectedManual
              ? "マニュアル詳細"
              : "マニュアル未選択"}
          </div>

          {!selectedManual && !isEditing && !loading && (
            <div style={{ color: "#6b7280", paddingTop: 30, textAlign: "center" }}>
              編集したいマニュアルを選択するか、「＋ 新規作成」ボタンを押してください。
            </div>
          )}

          {loading && (
            <div style={{ color: "#6b7280", paddingTop: 30, textAlign: "center" }}>データ読み込み中...</div>
          )}

          {!loading && (isEditing || selectedManual) && (
            <div className="kb-manual-form">
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">マニュアルID</label>
                <input
                  type="text"
                  name="manualId"
                  className="kb-admin-input full"
                  value={manualForm.manualId}
                  readOnly
                  style={{ background: "#f3f4f8" }}
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タイトル（必須）</label>
                <input
                  type="text"
                  name="title"
                  className="kb-admin-input full"
                  value={manualForm.title || ""}
                  onChange={handleInputChange}
                  readOnly={!isEditing}
                />
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">ブランド</label>
                  <select
                    name="brandId"
                    className="kb-admin-select full"
                    value={manualForm.brandId || ""}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                  >
                    <option value="">- 全社 -</option>
                    {brands.map((b) => (
                      <option key={b.brandId} value={b.brandId}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="kb-admin-label">部署/業務</label>
                  <select
                    name="bizId"
                    className="kb-admin-select full"
                    value={manualForm.bizId || ""}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                  >
                    <option value="">- 選択しない -</option>
                    {depts.map((d) => (
                      <option key={d.deptId} value={d.deptId}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">説明</label>
                <textarea
                  name="desc"
                  className="kb-admin-textarea full"
                  value={manualForm.desc || ""}
                  onChange={handleInputChange}
                  readOnly={!isEditing}
                  rows={3}
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タグ（カンマ区切り）</label>
                <input
                  type="text"
                  name="tags"
                  className="kb-admin-input full"
                  value={(manualForm.tags || []).join(", ")}
                  onChange={handleInputChange}
                  readOnly={!isEditing}
                  placeholder="例: 経理, 請求, PDF"
                />
                <div className="kb-subnote full" style={{ marginTop: 4 }}>
                  ※カンマ、またはスペースで区切ってください。
                </div>
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">更新日</label>
                  <input
                    type="date"
                    name="updatedAt"
                    className="kb-admin-input full"
                    value={manualForm.updatedAt || ""}
                    onChange={handleInputChange}
                    readOnly={!isEditing}
                  />
                </div>
                <div>
                  <label className="kb-admin-label">ダウンロード不可</label>
                  <div className="kb-checkbox-wrap">
                    <input
                      type="checkbox"
                      name="noDownload"
                      checked={manualForm.noDownload || false}
                      onChange={handleInputChange}
                      disabled={!isEditing}
                      id="noDownload"
                    />
                    <label htmlFor="noDownload">一般画面でのダウンロードを禁止する</label>
                  </div>
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">埋め込みURL（Google Drive/Slides）</label>
                <input
                  type="url"
                  name="embedUrl"
                  className="kb-admin-input full"
                  value={manualForm.embedUrl || ""}
                  onChange={handleInputChange}
                  readOnly={!isEditing}
                  placeholder="https://drive.google.com/..."
                />
                <div className="kb-subnote full" style={{ marginTop: 4 }}>
                  ※テンプレートから作成した場合、新しいファイルの編集URLが自動で入力されます。
                </div>
              </div>

              {getEmbedSrc(manualForm.embedUrl) && (
                <div className="kb-admin-form-row full" style={{ marginTop: 20 }}>
                  <label className="kb-admin-label full">ライブプレビュー</label>
                  <div
                    style={{
                      width: "100%",
                      paddingTop: "56.25%",
                      position: "relative",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      background: "#020617",
                    }}
                  >
                    <iframe
                      src={getEmbedSrc(manualForm.embedUrl)}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        border: "none",
                      }}
                      allowFullScreen
                      loading="lazy"
                    />
                  </div>
                </div>
              )}

              <div className="kb-form-actions">
                {isEditing && isNewCreationMode && (
                  <button
                    className="kb-secondary-btn"
                    onClick={handleCreateFromTemplate}
                    disabled={isCopying}
                    type="button"
                  >
                    {isCopying ? "テンプレートコピー中..." : "テンプレートから作成 → 編集へ"}
                  </button>
                )}

                {isEditing && (
                  <>
                    <button className="kb-secondary-btn" onClick={handleCancel} type="button">
                      キャンセル
                    </button>
                    <button
                      className="kb-primary-btn"
                      onClick={handleSave}
                      disabled={!manualForm.title}
                      type="button"
                    >
                      {manualForm.manualId.startsWith("M200-") ? "新規作成" : "保存"}
                    </button>
                  </>
                )}

                {selectedManual && !isEditing && (
                  <>
                    <button className="kb-delete-btn" onClick={() => handleDelete(selectedManual.manualId)}>
                      削除
                    </button>
                    <button className="kb-primary-btn" onClick={() => handleEditManual(selectedManual)} type="button">
                      編集
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
        .kb-manual-item-admin {
          padding: 10px 12px;
          border-radius: 10px;
          margin-bottom: 8px;
          border: 1px solid #f1f5f9;
          background: #f9fafb;
          cursor: pointer;
          transition: all 0.1s ease;
        }
        .kb-manual-item-admin:hover {
          background: #eff6ff;
          border-color: #dbeafe;
        }
        .kb-manual-item-admin.selected {
          background: #e0f2fe;
          border-color: #0ea5e9;
          box-shadow: 0 0 0 1px #0ea5e9;
        }
        .kb-manual-title-admin {
          font-size: 14px;
          font-weight: 600;
        }
        .kb-manual-meta-admin {
          font-size: 11px;
          color: #6b7280;
          margin-top: 2px;
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
        .kb-admin-input,
        .kb-admin-select,
        .kb-admin-textarea {
          width: 100%;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          font-size: 13px;
          background: #ffffff;
        }
        .kb-admin-textarea {
          resize: vertical;
        }
        .kb-admin-input:read-only,
        .kb-admin-select:disabled,
        .kb-admin-textarea:read-only {
          background: #f3f4f8;
          color: #6b7280;
        }
        .kb-subnote {
          font-size: 11px;
          color: #9ca3af;
        }
        .kb-checkbox-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
          cursor: pointer;
        }
        .kb-checkbox-wrap input[type="checkbox"] {
          width: auto;
          height: auto;
          cursor: pointer;
        }
        .kb-checkbox-wrap label {
          font-size: 13px;
          color: #1f2937;
          font-weight: 400;
          margin-bottom: 0;
          cursor: pointer;
        }
        .kb-form-actions {
          margin-top: 20px;
          padding-top: 15px;
          border-top: 1px dashed #e5e7eb;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }
        .kb-primary-btn,
        .kb-secondary-btn,
        .kb-delete-btn {
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
        .kb-secondary-btn:disabled {
          background: #f3f4f8;
          color: #9ca3af;
          cursor: not-allowed;
        }
        .kb-delete-btn {
          background: #fecaca;
          border-color: #fca5a5;
          color: #b91c1c;
          margin-right: auto;
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

