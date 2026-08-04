"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/* ========= 型定義 ========= */

type ManualType = "doc" | "video";
type ManualViewScope = "all" | "direct" | "fc";

type Manual = {
  manualId: string;
  title: string;
  brandId?: string;
  bizId?: string;
  desc?: string | null;
  updatedAt?: string;
  tags?: string[];
  embedUrl?: string;
  externalUrl?: string;
  noDownload?: boolean;
  startDate?: string;
  endDate?: string;
  type?: ManualType;

  /** ✅ 追加：閲覧権限 */
  viewScope?: ManualViewScope; // "all" | "direct"

  /** ✅ シリーズ (1階層) */
  categoryId?: string | null;
  /** ✅ シリーズ内の表示順 */
  seriesOrder?: number | null;

  /** ✅ チャプター(動画・時刻付き) / 目次(資料)。編集画面で編集・保持。 */
  chapters?: { t: number; title: string }[];
  toc?: { title: string; page?: number }[];
};

type Brand = { brandId: string; name: string };
type Dept = { deptId: string; name: string };
type ManualCategory = {
  categoryId: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
};

const DRAFT_KEY = "kb_manual_draft_v1";

/* ========= ヘルパー ========= */

const getTodayDate = () => {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const generateNewManualId = () => `M200-${Date.now().toString().slice(-6)}`;

/** 秒 → mm:ss / h:mm:ss 表示 */
const fmtSec = (s?: number) => {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  return (h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};
/** "1:23" / "1:02:03" → 秒。不正なら null */
const parseSec = (str: string): number | null => {
  const parts = String(str).trim().split(":");
  if (!parts.length || parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
};

const normalizeViewScope = (v: any): ManualViewScope => {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "direct") return "direct";
  if (s === "fc") return "fc";
  return "all";
};

const createEmptyManual = (initialData: Partial<Manual> = {}): Manual => ({
  manualId: generateNewManualId(),
  title: "",
  brandId: "",
  bizId: "",
  desc: "",
  updatedAt: getTodayDate(),
  tags: [],
  embedUrl: "",
  externalUrl: "",
  noDownload: false,
  startDate: "",
  endDate: "",
  type: "doc",
  categoryId: null,
  seriesOrder: null,

  ...initialData,

  // ✅ ここで必ず "all/direct" に正規化（未指定なら all）
  viewScope: normalizeViewScope((initialData as any)?.viewScope),
});

const getEmbedSrc = (url?: string) => {
  if (!url || typeof url !== "string" || url.trim() === "") return "";
  const u = url.trim();

  // ✅ Canva 対策
  if (u.includes("canva.com/design/")) {
    const canvaMatch = u.match(/design\/([A-Za-z0-9_-]+)/);
    if (canvaMatch?.[1]) {
      return `https://www.canva.com/design/${canvaMatch[1]}/watch?embed`;
    }
  }

  // ✅ YouTube 対策
  const ytMatch = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch?.[1]) {
    return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?rel=0`;
  }

  // ✅ Google Drive / Docs 対策 (既存ロジックの改善版)
  const idMatch = u.match(/(?:id=|\/d\/)([\w-]+)(?:\/edit|\/view|\/preview|\/present|\/|$)/i);
  if (idMatch) {
    const fileId = idMatch[1];
    if (u.includes("docs.google.com/presentation")) {
      return `https://docs.google.com/presentation/d/${fileId}/embed?start=false&loop=false&delayms=3000`;
    }
    if (u.includes("docs.google.com/document")) {
      return `https://docs.google.com/document/d/${fileId}/preview`;
    }
    if (u.includes("docs.google.com/spreadsheets")) {
      return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
    }
    return `https://drive.google.com/file/d/${fileId}/preview`;
  }

  // それ以外（既にembed形式のURLなど）はそのまま返す
  return u;
};

function safeSetDraft(draft: any) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (e) {
    console.warn("Failed to set draft:", e);
  }
}

/* ========= ✅ 統一ローディング（あなたの app/admin/loading.tsx と同型） ========= */

function BusyOverlay({ text }: { text: string }) {
  return (
    <div
      className="kb-loading-full-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999999,
        textAlign: "center",
        minHeight: "100vh",
      }}
      role="alert"
      aria-busy="true"
    >
      <div
        className="kb-loading-main-box"
        style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <div
          className="kb-logo-spin-container"
          style={{ position: "relative", width: 80, height: 80, marginBottom: 24 }}
        >
          <img
            src="/logos/KnowBase_icon.png"
            alt="Loading Logo"
            className="kb-spin-logo"
            style={{
              width: 40,
              height: 40,
              position: "absolute",
              top: 20,
              left: 20,
              zIndex: 2,
            }}
          />
          <div className="kb-outer-ring" />
        </div>

        <div
          className="kb-loading-bar-container"
          style={{
            width: 160,
            height: 4,
            background: "#f1f5f9",
            borderRadius: 10,
            marginBottom: 12,
            overflow: "hidden",
          }}
        >
          <div className="kb-loading-bar-fill" />
        </div>

        <p
          className="kb-loading-status"
          style={{ fontSize: 13, color: "#64748b", fontWeight: 600, margin: 0 }}
        >
          {text}
        </p>
      </div>

      <style jsx>{`
        .kb-outer-ring {
          width: 80px;
          height: 80px;
          border: 3px solid #f1f5f9;
          border-top: 3px solid #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        .kb-loading-bar-fill {
          width: 50%;
          height: 100%;
          background: #3b82f6;
          border-radius: 10px;
          animation: progress 1.5s ease-in-out infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes progress {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(200%);
          }
        }
      `}</style>
    </div>
  );
}

/* ========= メインコンポーネント ========= */

export default function AdminManuals() {
  const router = useRouter();
  const sp = useSearchParams();
  const selectId = sp.get("select");

  const [manuals, setManuals] = useState<Manual[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [categories, setCategories] = useState<ManualCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedManual, setSelectedManual] = useState<Manual | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false);

  const [manualForm, setManualForm] = useState<Manual>(createEmptyManual());
  const [tagInput, setTagInput] = useState("");
  const [chapGenBusy, setChapGenBusy] = useState(false);

  /* ===== チャプター編集 ===== */
  const chapters = manualForm.chapters || [];
  const setChapters = (next: { t: number; title: string }[]) =>
    setManualForm((f) => ({ ...f, chapters: next }));
  const updateChapter = (i: number, patch: Partial<{ t: number; title: string }>) =>
    setChapters(chapters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const addChapter = () => setChapters([...chapters, { t: 0, title: "" }]);
  const removeChapter = (i: number) => setChapters(chapters.filter((_, idx) => idx !== i));
  const sortChapters = () => setChapters([...chapters].sort((a, b) => a.t - b.t));
  // 前処理済みMarkdownから AI で章立てを生成しフォームへ流し込む(保存で確定)。
  const generateChaptersForForm = async () => {
    if (!manualForm.manualId) return;
    setChapGenBusy(true);
    try {
      const res = await fetch(`/api/manuals/${encodeURIComponent(manualForm.manualId)}/chapters`, {
        method: "POST",
        headers: getAdminHeaders(),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 202) { alert(d.error || "前処理(Markdown化)を開始しました。数分後に再度お試しください。"); return; }
      if (d.ok && Array.isArray(d.chapters) && d.chapters.length) setChapters(d.chapters);
      else alert(d.error || "章を生成できませんでした（時刻情報のある動画のみ対応）。");
    } catch { alert("生成に失敗しました。"); }
    finally { setChapGenBusy(false); }
  };

  // ✅ 画面処理中（統一ローディング）
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [busyText, setBusyText] = useState("");

  const busy = loading || saving || copying;

  /** 管理画面用：認可は HttpOnly Cookie で行う（fetch に credentials: "include" を付ける） */
  const getAdminHeaders = useCallback((): HeadersInit => ({}), []);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setBusyText("KnowBase 管理画面を読み込み中...");

    try {
      const manualHeaders: HeadersInit = getAdminHeaders();

      const [mRes, bRes, dRes, cRes] = await Promise.all([
        fetch("/api/manuals", {
          method: "GET",
          headers: manualHeaders,
          cache: "no-store",
        }),
        fetch("/api/brands", { cache: "no-store" }),
        fetch("/api/depts", { cache: "no-store" }),
        fetch("/api/manual-categories", { cache: "no-store" }),
      ]);

      const [mJson, bJson, dJson, cJson] = await Promise.all([
        mRes.json().catch(() => ({})),
        bRes.json().catch(() => ({})),
        dRes.json().catch(() => ({})),
        cRes.json().catch(() => ({})),
      ]);

      if (!mRes.ok) {
        console.error("manuals fetch failed:", mJson);
        throw new Error(mJson?.error || "Failed to fetch manuals");
      }
      if (!bRes.ok) {
        console.error("brands fetch failed:", bJson);
        throw new Error(bJson?.error || "Failed to fetch brands");
      }
      if (!dRes.ok) {
        console.error("depts fetch failed:", dJson);
        throw new Error(dJson?.error || "Failed to fetch depts");
      }
      // カテゴリ取得失敗は致命ではないので警告のみ
      if (!cRes.ok || !cJson?.ok) {
        console.warn("categories fetch failed:", cJson);
      }

      // ✅ viewScope を必ず "all/direct" に正規化
      const normalizedManuals: Manual[] = (mJson.manuals || []).map((m: any) => ({
        ...m,
        viewScope: normalizeViewScope(m?.viewScope),
      }));

      setManuals(normalizedManuals);
      setBrands(bJson.brands || []);
      setDepts(dJson.depts || []);
      setCategories(cJson?.categories || []);
    } catch (e) {
      console.error("Fetch error:", e);
    } finally {
      setLoading(false);
      setBusyText("");
    }
  }, [getAdminHeaders]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    if (loading) return;
    if (!selectId) return;
    const found = manuals.find((m) => m.manualId === selectId);
    if (found) {
      setSelectedManual(found);
      setManualForm(createEmptyManual(found)); // ✅ 正規化込み
      setTagInput((found.tags || []).join(", "));
      setIsEditing(false);
    }
  }, [loading, selectId, manuals]);

  const brandMap = useMemo(
    () => brands.reduce((acc, b) => ({ ...acc, [b.brandId]: b }), {} as Record<string, Brand>),
    [brands]
  );
  const deptMap = useMemo(
    () => depts.reduce((acc, d) => ({ ...acc, [d.deptId]: d }), {} as Record<string, Dept>),
    [depts]
  );
  const categoryMap = useMemo(
    () => categories.reduce((acc, c) => ({ ...acc, [c.categoryId]: c }), {} as Record<string, ManualCategory>),
    [categories]
  );
  /** 1階層シリーズ (parentId は無視。あれば後方互換のため全件を flat として扱う) */
  const seriesList = useMemo(
    () => [...categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [categories]
  );

  /** シリーズラベル */
  const seriesLabel = (categoryId?: string | null): string => {
    if (!categoryId) return "未分類";
    const c = categoryMap[categoryId];
    return c?.name ?? "未分類";
  };
  // 既存呼び出しの互換用
  const categoryLabel = seriesLabel;

  const handleNewManual = () => {
    setManualForm(createEmptyManual());
    setTagInput("");
    setSelectedManual(null);
    setIsEditing(true);
  };

  const handleOpenTemplateModal = () => {
    if (!manualForm.title) {
      alert("先にタイトルを入力してください。");
      return;
    }
    setShowTemplateModal(true);
  };

  const handleExecuteCopy = async (templateType: "landscape" | "portrait") => {
    setShowTemplateModal(false);
    setCopying(true);
    setBusyText("テンプレートをコピーしています...");

    const finalTags = tagInput
      .split(/[,、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const draft = {
      ...manualForm,
      tags: finalTags,
      viewScope: normalizeViewScope(manualForm.viewScope),
    };
    safeSetDraft(draft);

    try {
      const res = await fetch("/api/drive/copy-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: manualForm.title, templateType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "copy failed");
      router.push(
        `/admin/manuals/edit?fileId=${data.fileId}&editUrl=${encodeURIComponent(data.editUrl)}`
      );
    } catch (e: any) {
      alert(`コピー失敗: ${e.message}`);
      setCopying(false);
      setBusyText("");
    }
  };

  const handleEditManual = (manual: Manual) => {
    setManualForm(createEmptyManual(manual)); // ✅ 正規化込み
    setTagInput((manual.tags || []).join(", "));
    setSelectedManual(manual);
    setIsEditing(true);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;

    if (name === "tags") {
      setTagInput(value);
      return;
    }

    const val = type === "checkbox" ? (e.target as HTMLInputElement).checked : value;

    // ✅ viewScope は all/direct を担保
    if (name === "viewScope") {
      setManualForm((prev) => ({ ...prev, viewScope: normalizeViewScope(val) }));
      return;
    }

    setManualForm((prev) => ({ ...prev, [name]: val }));
  };

  const handleSave = async () => {
    if (!manualForm.title) {
      alert("タイトル必須");
      return;
    }

    const finalTags = tagInput
      .split(/[,、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: Manual = {
      ...manualForm,
      tags: finalTags,
      updatedAt: getTodayDate(),
      viewScope: normalizeViewScope(manualForm.viewScope),
    };

    setSaving(true);
    setBusyText(selectedManual === null ? "新規作成しています..." : "保存しています...");

    try {
      const isNew = selectedManual === null;

      const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...getAdminHeaders(), // ✅ ここ重要（POST/PUTもadmin-key付与）
      };

      const res = await fetch("/api/manuals", {
        method: isNew ? "POST" : "PUT",
        headers,
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "save failed");

      await loadAllData();
      setIsEditing(false);
      alert("保存しました");
    } catch (e: any) {
      alert(`保存エラー: ${e?.message || "不明なエラー"}`);
    } finally {
      setSaving(false);
      setBusyText("");
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    const original = selectedManual || createEmptyManual();
    setManualForm(createEmptyManual(original));
    setTagInput(((original.tags as string[]) || []).join(", "));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("本当にこのマニュアルを削除しますか？")) return;

    setSaving(true);
    setBusyText("削除しています...");

    try {
      const res = await fetch(`/api/manuals?manualId=${id}`, {
        method: "DELETE",
        headers: {
          ...getAdminHeaders(), // ✅ ここ重要（DELETEもadmin-key付与）
        },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "delete failed");

      await loadAllData();
      setSelectedManual(null);
      setIsEditing(false);
      alert("削除しました");
    } catch (e: any) {
      alert(`削除に失敗しました: ${e?.message || ""}`);
    } finally {
      setSaving(false);
      setBusyText("");
    }
  };

  const filteredManuals = useMemo(() => {
    const kw = filterText.trim().toLowerCase();
    return manuals.filter((m) => {
      if (showUncategorizedOnly && m.categoryId) return false;
      const titleHit = (m.title || "").toLowerCase().includes(kw);
      const idHit = (m.manualId || "").toLowerCase().includes(kw);
      const tagHit = (m.tags || []).some((t) => (t || "").toLowerCase().includes(kw));
      const catName = categoryLabel(m.categoryId).toLowerCase();
      const catHit = catName.includes(kw);
      return !kw || titleHit || idHit || tagHit || catHit;
    });
  }, [manuals, filterText, showUncategorizedOnly, categoryMap]);

  const uncategorizedCount = useMemo(() => manuals.filter((m) => !m.categoryId).length, [manuals]);

  return (
    <div className="kb-root">
      {/* ✅ 初回ロード / 保存 / コピー 全部同じ見た目 */}
      {busy && <BusyOverlay text={busyText || "処理中..."} />}

      {showTemplateModal && (
        <div className="kb-modal-overlay">
          <div className="kb-modal-content">
            <div className="kb-modal-header">テンプレートの向きを選択</div>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 24 }}>
              作成するマニュアルの形式を選んでください。
            </p>

            <div className="kb-template-options">
              <button
                className="kb-template-card"
                onClick={() => handleExecuteCopy("landscape")}
                disabled={busy}
              >
                <div className="kb-template-icon-wrapper">
                  <div className="kb-template-icon landscape" />
                </div>
                <span>横Ver</span>
              </button>

              <button
                className="kb-template-card"
                onClick={() => handleExecuteCopy("portrait")}
                disabled={busy}
              >
                <div className="kb-template-icon-wrapper">
                  <div className="kb-template-icon portrait" />
                </div>
                <span>縦Ver</span>
              </button>
            </div>

            <button
              className="kb-secondary-btn"
              onClick={() => setShowTemplateModal(false)}
              style={{ marginTop: 32, width: "100%" }}
              disabled={busy}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="kb-topbar">
        <Link
          href="/admin"
          style={{ display: "flex", alignItems: "center", gap: 20, textDecoration: "none" }}
        >
          <div
            className="kb-topbar-left"
            style={{ display: "flex", alignItems: "center", gap: 20, cursor: "pointer" }}
          >
            <img
              src="/logos/KnowBase_icon.png"
              alt="Logo"
              style={{ width: 48, height: 48, objectFit: "contain" }}
            />
            <img
              src="/logos/KnowBase_CR.png"
              alt="LogoText"
              style={{ height: 22, objectFit: "contain" }}
            />
          </div>
        </Link>

        <div className="kb-topbar-center" style={{ fontSize: 18, fontWeight: 700 }}>
          マニュアル管理
        </div>

        <div className="kb-topbar-right">
          <Link href="/admin">
            <button className="kb-logout-btn" disabled={busy}>
              管理メニューへ戻る
            </button>
          </Link>
        </div>
      </div>

      <div className="kb-admin-grid-2col">
        {/* 左：一覧 */}
        <div className="kb-admin-card-large">
          <div className="kb-panel-header-row">
            <div className="kb-admin-head">マニュアル一覧（{loading ? "..." : manuals.length}件）</div>
            <button
              className="kb-primary-btn"
              onClick={handleNewManual}
              style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999 }}
              disabled={busy}
            >
              ＋ 新規作成
            </button>
          </div>

          <input
            type="text"
            className="kb-admin-input"
            placeholder="タイトル、ID、タグ、カテゴリで検索..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ marginBottom: 8 }}
            disabled={busy}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showUncategorizedOnly}
              onChange={(e) => setShowUncategorizedOnly(e.target.checked)}
              disabled={busy}
            />
            未分類のみ表示 ({uncategorizedCount} 件)
          </label>

          <div className="kb-manual-list-admin">
            {!loading &&
              filteredManuals.map((m) => {
                const selected = selectedManual?.manualId === m.manualId;
                const scope = normalizeViewScope(m.viewScope);

                return (
                  <div
                    key={m.manualId}
                    className={`kb-manual-item-admin ${selected ? "selected" : ""}`}
                    onClick={() => !busy && handleEditManual(m)}
                    style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}
                  >
                    <div className="kb-manual-title-admin">
                      {m.type === "video" ? "🎬 " : "📄 "}
                      {m.title}
                      {scope === "direct" && <span className="kb-scope-badge">直営のみ</span>}
                      {scope === "fc" && <span className="kb-scope-badge">FCのみ</span>} 
                    </div>
                    <div className="kb-manual-meta-admin">
                      {brandMap[m.brandId || ""]?.name || "全社"} / {deptMap[m.bizId || ""]?.name || "未設定"} /
                      <span style={{ color: m.categoryId ? "#1d4ed8" : "#ef4444", fontWeight: 700 }}>
                        {categoryLabel(m.categoryId)}
                      </span> /
                      更新日: {m.updatedAt || "未設定"}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* 右：詳細/編集 */}
        <div className="kb-admin-card-large">
          <div className="kb-admin-head">
            {isEditing
              ? selectedManual === null
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

          {(isEditing || selectedManual) && (
            <div className="kb-manual-form">
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">マニュアルID</label>
                <input
                  type="text"
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
                  disabled={busy}
                />
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">タイプ</label>
                  <select
                    name="type"
                    className="kb-admin-select full"
                    value={manualForm.type || "doc"}
                    onChange={handleInputChange}
                    disabled={!isEditing || busy}
                  >
                    <option value="doc">資料（📄）</option>
                    <option value="video">動画（🎬）</option>
                  </select>
                </div>

                <div>
                  <label className="kb-admin-label">ブランド</label>
                  <select
                    name="brandId"
                    className="kb-admin-select full"
                    value={manualForm.brandId || ""}
                    onChange={handleInputChange}
                    disabled={!isEditing || busy}
                  >
                    <option value="">- 全社 -</option>
                    {brands.map((b) => (
                      <option key={b.brandId} value={b.brandId}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

             {/* ✅ 修正：閲覧権限の選択肢追加 */}
<div className="kb-admin-form-row">
  <label className="kb-admin-label full">閲覧権限</label>
  <select
    name="viewScope"
    className="kb-admin-select full"
    value={normalizeViewScope(manualForm.viewScope)}
    onChange={handleInputChange}
    disabled={!isEditing || busy}
  >
    <option value="all">すべて（直営 / FC / 本部）</option>
    <option value="direct">直営のみ（直営 / 本部）</option>
    <option value="fc">FCのみ（FC / 本部）</option>
  </select>
  <div className="kb-subnote full" style={{ marginTop: 6, minHeight: '1.5em' }}>
    {manualForm.viewScope === 'direct' && (
      <span>※ <b>直営店舗</b> と <b>本部</b> のみ表示されます（FCは非表示）</span>
    )}
    {manualForm.viewScope === 'fc' && (
      <span>※ <b>FC店舗</b> と <b>本部</b> のみ表示されます（直営は非表示）</span>
    )}
    {manualForm.viewScope === 'all' && (
      <span>※ 全てのユーザー（直営・FC・本部）が閲覧可能です。</span>
    )}
  </div>
</div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">公開開始日</label>
                  <input
                    type="date"
                    name="startDate"
                    className="kb-admin-input full"
                    value={manualForm.startDate || ""}
                    onChange={handleInputChange}
                    readOnly={!isEditing}
                    disabled={busy}
                  />
                </div>

                <div>
                  <label className="kb-admin-label">公開終了日</label>
                  <input
                    type="date"
                    name="endDate"
                    className="kb-admin-input full"
                    value={manualForm.endDate || ""}
                    onChange={handleInputChange}
                    readOnly={!isEditing}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">配信部署</label>
                <select
                  name="bizId"
                  className="kb-admin-select full"
                  value={manualForm.bizId || ""}
                  onChange={handleInputChange}
                  disabled={!isEditing || busy}
                >
                  <option value="">- 選択しない -</option>
                  {depts.map((d) => (
                    <option key={d.deptId} value={d.deptId}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* ✅ シリーズと表示順は「シリーズ管理」画面で設定する仕様に変更 */}
              {manualForm.categoryId && (
                <div className="kb-admin-form-row">
                  <label className="kb-admin-label full">現在のシリーズ</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f1f5f9", borderRadius: 8, fontSize: 13 }}>
                    <span style={{ fontWeight: 700, color: "#1d4ed8" }}>📚 {seriesLabel(manualForm.categoryId)}</span>
                    {typeof manualForm.seriesOrder === "number" && (
                      <span style={{ color: "#64748b", fontWeight: 600 }}>#{manualForm.seriesOrder}</span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>
                      シリーズの編集は <Link href="/admin/categories" style={{ color: "#3b82f6", fontWeight: 700 }}>シリーズ管理</Link> から
                    </span>
                  </div>
                </div>
              )}

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">説明</label>
                <textarea
                  name="desc"
                  className="kb-admin-textarea full"
                  value={manualForm.desc || ""}
                  onChange={handleInputChange}
                  readOnly={!isEditing}
                  rows={3}
                  disabled={busy}
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タグ（カンマ区切り）</label>
                <input
                  type="text"
                  name="tags"
                  className="kb-admin-input full"
                  value={tagInput}
                  onChange={handleInputChange}
                  readOnly={!isEditing}
                  disabled={busy}
                  placeholder="例: 経理, 請求, PDF"
                />
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
                  disabled={busy}
                  placeholder="https://drive.google.com/..."
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">外部URL（参考リンクなど）</label>
                <input
                  type="url"
                  name="externalUrl"
                  className="kb-admin-input full"
                  value={manualForm.externalUrl || ""}
                  onChange={handleInputChange}
                  readOnly={!isEditing}
                  disabled={busy}
                  placeholder="https://example.com"
                />
                <div className="kb-subnote full" style={{ marginTop: 4 }}>
                  ※埋め込みではなく、別タブで開くリンクとして利用されます。
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label
                  className="kb-admin-label"
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    name="noDownload"
                    checked={!!manualForm.noDownload}
                    onChange={handleInputChange}
                    disabled={!isEditing || busy}
                    style={{ width: 18, height: 18 }}
                  />
                  <span>ダウンロードを禁止する（閲覧のみ）</span>
                </label>
              </div>

              {manualForm.type === "video" && (
                <div className="kb-admin-form-row full" style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <label className="kb-admin-label full" style={{ margin: 0 }}>チャプター（動画・時刻付き）</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={sortChapters} disabled={!isEditing || busy || chapters.length < 2}
                        style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
                        時刻順に並べ替え
                      </button>
                      <button type="button" onClick={generateChaptersForForm} disabled={!isEditing || busy || chapGenBusy}
                        style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", cursor: chapGenBusy ? "default" : "pointer" }}>
                        {chapGenBusy ? "生成中…" : chapters.length ? "AIで再生成" : "AIで生成"}
                      </button>
                    </div>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 8, marginTop: 6, background: "#fafafa" }}>
                    {chapters.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "10px 6px", textAlign: "center" }}>
                        チャプターはまだありません。「AIで生成」または「＋ 行を追加」で作成できます。
                      </div>
                    ) : (
                      chapters.map((c, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                          <input type="text" defaultValue={fmtSec(c.t)} disabled={!isEditing || busy}
                            onBlur={(e) => { const s = parseSec(e.target.value); if (s == null) { e.target.value = fmtSec(c.t); } else { updateChapter(i, { t: s }); e.target.value = fmtSec(s); } }}
                            title="開始時刻 (mm:ss または h:mm:ss)"
                            style={{ width: 84, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: "6px 8px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff" }} />
                          <input type="text" value={c.title} disabled={!isEditing || busy}
                            onChange={(e) => updateChapter(i, { title: e.target.value })}
                            placeholder="章タイトル"
                            style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff" }} />
                          <button type="button" onClick={() => removeChapter(i)} disabled={!isEditing || busy}
                            title="削除" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", cursor: "pointer" }}>✕</button>
                        </div>
                      ))
                    )}
                    <button type="button" onClick={addChapter} disabled={!isEditing || busy}
                      style={{ marginTop: 4, fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px dashed #94a3b8", background: "#fff", color: "#334155", cursor: "pointer" }}>
                      ＋ 行を追加
                    </button>
                  </div>
                  <div className="kb-subnote full" style={{ marginTop: 4 }}>
                    ※ 時刻は「1:23」や「1:02:03」形式。保存すると閲覧プレビューのチャプターに反映されます（YouTube動画はクリックで頭出し）。
                  </div>
                </div>
              )}

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

              <div
                className="kb-form-actions"
                style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}
              >
                {selectedManual && (
                  <button
                    className="kb-delete-btn"
                    onClick={() => handleDelete(selectedManual.manualId)}
                    type="button"
                    style={{ marginRight: "auto" }}
                    disabled={busy}
                  >
                    削除
                  </button>
                )}

                {isEditing && selectedManual === null && (
                  <button
                    className="kb-secondary-btn"
                    onClick={handleOpenTemplateModal}
                    type="button"
                    disabled={busy}
                  >
                    テンプレートから作成
                  </button>
                )}

                {isEditing ? (
                  <>
                    <button className="kb-secondary-btn" onClick={handleCancel} type="button" disabled={busy}>
                      中止
                    </button>
                    <button
                      className="kb-primary-btn"
                      onClick={handleSave}
                      disabled={busy || !manualForm.title}
                      type="button"
                    >
                      {selectedManual === null ? "新規作成" : "保存"}
                    </button>
                  </>
                ) : (
                  <button className="kb-primary-btn" onClick={() => setIsEditing(true)} type="button" disabled={busy}>
                    編集
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .kb-root {
          background: #f8fafc;
          min-height: 100vh;
          font-family: "Inter", -apple-system, sans-serif;
        }
        .kb-topbar {
          background: #fff;
          padding: 12px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #e2e8f0;
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .kb-logout-btn {
          background: #f1f5f9;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-weight: 600;
          color: #475569;
          cursor: pointer;
          transition: 0.2s;
        }
        .kb-logout-btn:hover {
          background: #e2e8f0;
        }

        .kb-admin-grid-2col {
          display: grid;
          grid-template-columns: 2fr 3fr;
          gap: 20px;
          padding: 20px;
          max-width: 1600px;
          margin: 0 auto;
        }
        .kb-admin-card-large {
          background: #fff;
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
          height: calc(100vh - 100px);
          display: flex;
          flex-direction: column;
        }
        .kb-panel-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .kb-admin-head {
          font-size: 1.25rem;
          font-weight: 800;
          color: #1e293b;
        }
        .kb-admin-input {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          font-size: 14px;
          transition: 0.2s;
        }
        .kb-admin-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .kb-manual-list-admin {
          flex: 1;
          overflow-y: auto;
          padding-right: 4px;
        }
        .kb-manual-item-admin {
          padding: 16px;
          border-radius: 12px;
          background: #f8fafc;
          cursor: pointer;
          margin-bottom: 12px;
          border: 1px solid #f1f5f9;
          transition: 0.2s;
        }
        .kb-manual-item-admin:hover {
          background: #f1f5f9;
          transform: translateY(-1px);
        }
        .kb-manual-item-admin.selected {
          background: #eff6ff;
          border-color: #3b82f6;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.08);
        }
        .kb-manual-title-admin {
          font-size: 14px;
          font-weight: 700;
          color: #1e293b;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .kb-scope-badge {
          font-size: 11px;
          font-weight: 800;
          padding: 3px 10px;
          border-radius: 999px;
          border: 1px solid #fecaca;
          background: #fff1f2;
          color: #e11d48;
        }
        .kb-manual-meta-admin {
          font-size: 12px;
          color: #64748b;
          margin-top: 6px;
        }
        .kb-manual-form {
          flex: 1;
          overflow-y: auto;
          padding-right: 4px;
        }
        .kb-admin-form-row {
          margin-bottom: 20px;
        }
        .kb-admin-form-row.two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .kb-admin-label {
          font-size: 13px;
          font-weight: 700;
          color: #475569;
          margin-bottom: 8px;
          display: block;
        }
        .kb-admin-select,
        .kb-admin-textarea {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          font-size: 14px;
          background: #fff;
        }
        .kb-admin-textarea {
          resize: vertical;
          min-height: 80px;
        }
        .kb-subnote {
          font-size: 12px;
          color: #94a3b8;
        }
        .kb-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px dashed #e2e8f0;
        }
        .kb-primary-btn {
          background: #3b82f6;
          color: #fff;
          padding: 10px 24px;
          border-radius: 999px;
          border: none;
          font-weight: 700;
          cursor: pointer;
          transition: 0.2s;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
        }
        .kb-primary-btn:hover {
          background: #2563eb;
          transform: translateY(-1px);
        }
        .kb-primary-btn:disabled {
          background: #94a3b8;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        .kb-secondary-btn {
          background: #fff;
          border: 1px solid #cbd5e1;
          color: #475569;
          padding: 10px 24px;
          border-radius: 999px;
          font-weight: 700;
          cursor: pointer;
          transition: 0.2s;
        }
        .kb-secondary-btn:hover {
          background: #f8fafc;
          border-color: #94a3b8;
        }
        .kb-delete-btn {
          background: #fff1f2;
          color: #e11d48;
          padding: 10px 24px;
          border-radius: 999px;
          border: 1px solid #fecaca;
          font-weight: 700;
          cursor: pointer;
          transition: 0.2s;
        }
        .kb-delete-btn:hover {
          background: #ffe4e6;
          border-color: #fb7185;
        }

        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }

        /* モーダル */
        .kb-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }
        .kb-modal-content {
          background: #fff;
          padding: 32px;
          border-radius: 24px;
          width: 440px;
          max-width: 90%;
          text-align: center;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          border: 1px solid #f1f5f9;
        }
        .kb-modal-header {
          font-size: 20px;
          font-weight: 800;
          margin-bottom: 8px;
          color: #1e293b;
        }
        .kb-template-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-top: 32px;
          align-items: stretch;
        }
        .kb-template-card {
          border: 2px solid #e2e8f0;
          background: #f8fafc;
          border-radius: 16px;
          padding: 24px 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
        }
        .kb-template-card:hover {
          border-color: #3b82f6;
          background: #eff6ff;
          transform: translateY(-4px);
        }
        .kb-template-icon-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
          min-height: 60px;
        }
        .kb-template-icon {
          background: #cbd5e1;
          border-radius: 4px;
          border: 2px solid #94a3b8;
        }
        .kb-template-icon.landscape {
          width: 56px;
          height: 36px;
        }
        .kb-template-icon.portrait {
          width: 36px;
          height: 56px;
        }
        .kb-template-card span {
          font-size: 14px;
          font-weight: 700;
          color: #1e293b;
          display: block;
          width: 100%;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
