// app/admin/news/page.tsx
"use client";

export const dynamic = "force-dynamic";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

/* ========= 型定義 ========= */

type ViewScope = "all" | "direct";

type Dept = { deptId: string; name: string };

type News = {
  newsId: string;
  title: string;
  body?: string | null;
  updatedAt?: string;

  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD

  tags?: string[];
  url?: string;

  // ✅ 閲覧権限
  viewScope?: ViewScope;

  // ✅ 配信元部署（復活）
  bizId?: string;

  // ✅ 配信ブランド（復活）
  brandId?: string; // "JOYFIT" | "FIT365" | "ALL"(=すべて)

  // API互換（来てもOK）
  publishAt?: string | null; // datetime-local or ISO or null
  createdAt?: string;
  isHidden?: boolean;
};

/* ========= ヘルパー ========= */

const getTodayDate = () => {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const generateNewNewsId = () => `N200-${Date.now().toString().slice(-6)}`;

const normalizeViewScope = (v: any): ViewScope => {
  const raw = String(v || "").trim().toLowerCase();
  return raw === "direct" ? "direct" : "all";
};

const normalizeTags = (v: any): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(/[,、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeBrandId = (v: any): string => {
  const s = String(v ?? "").trim();
  if (!s) return "ALL";
  if (s === "JOYFIT") return "JOYFIT";
  if (s === "FIT365") return "FIT365";
  return "ALL";
};

/**
 * ✅ 保存用に publishAt を正規化
 * - "" / null / undefined => null
 * - "YYYY-MM-DDTHH:mm"（datetime-local）を ISO(Z) に変換して保存
 *   ※サーバ側の比較がブレないようにする（ここが③の肝）
 */
const normalizePublishAtForSave = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;

  // datetime-local 形式なら ISO へ（ローカル時刻として解釈）
  // 例: "2026-01-27T11:30"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    const ms = Date.parse(s); // ブラウザローカルの解釈
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString(); // "....Z"
  }

  // すでにISO/Z/offset等ならそのまま（パースできないならnull）
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return s;
};

const createEmptyNews = (initial: Partial<News> = {}): News => {
  const merged = {
    newsId: generateNewNewsId(),
    title: "",
    body: "",
    updatedAt: getTodayDate(),
    startDate: "",
    endDate: "",
    url: "",
    publishAt: null,
    viewScope: "all",
    bizId: "",
    brandId: "ALL",
    ...initial,
  } as any;

  return {
    ...merged,
    viewScope: normalizeViewScope(merged.viewScope),
    tags: normalizeTags(merged.tags),
    bizId: String(merged.bizId ?? ""),
    brandId: normalizeBrandId(merged.brandId),
    // 画面表示用は「datetime-local」形式も許容のまま保持
  } as News;
};

/* ========= ✅ 統一ローディング ========= */

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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ position: "relative", width: 80, height: 80, marginBottom: 24 }}>
          <img
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
            alt="Loading Logo"
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

        <p style={{ fontSize: 13, color: "#64748b", fontWeight: 600, margin: 0 }}>{text}</p>
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

/* ========= バッジ ========= */

function ScopeBadge({ scope }: { scope?: ViewScope }) {
  const sc = normalizeViewScope(scope);
  return <span className="kb-scope-badge">{sc === "direct" ? "直営のみ" : "すべて"}</span>;
}

function BrandBadge({ brandId }: { brandId?: string }) {
  const b = normalizeBrandId(brandId);
  if (b === "ALL") return null; // 混乱防止：ALLは出さない（必要なら「全ブランド」に変更可）
  return <span className="kb-brand-badge">{b}</span>;
}

/* ========= メイン ========= */

export default function AdminNewsPage() {
  const [newsList, setNewsList] = useState<News[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<News | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [form, setForm] = useState<News>(createEmptyNews());
  const [tagInput, setTagInput] = useState("");
  const [filterText, setFilterText] = useState("");

  const [saving, setSaving] = useState(false);
  const [busyText, setBusyText] = useState("");

  const busy = loading || saving;

  /** ✅ admin-key（/api/news, /api/news/notify で必須） */
  const getAdminHeaders = useCallback((): HeadersInit => {
    const k = (process.env.NEXT_PUBLIC_KB_ADMIN_API_KEY || "").trim();
    return k ? { "x-kb-admin-key": k } : {};
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setBusyText("お知らせを読み込み中...");

    try {
      const [newsRes, deptRes] = await Promise.all([
        fetch("/api/news", {
          method: "GET",
          headers: getAdminHeaders(),
          cache: "no-store",
        }),
        fetch("/api/depts", { cache: "no-store" }),
      ]);

      const newsJson = await newsRes.json().catch(() => ({}));
      const deptJson = await deptRes.json().catch(() => ({}));

      if (!newsRes.ok) {
        const msg = newsJson?.detail
          ? `${newsJson.error}: ${newsJson.detail}`
          : newsJson?.error || "Failed to fetch news";
        throw new Error(msg);
      }
      if (!deptRes.ok) {
        const msg = deptJson?.detail
          ? `${deptJson.error}: ${deptJson.detail}`
          : deptJson?.error || "Failed to fetch depts";
        throw new Error(msg);
      }

      setDepts(deptJson.depts || []);

      const rawList: any[] = newsJson.news || newsJson.items || newsJson.newsItems || [];
      const normalized: News[] = rawList.map((n: any) => ({
        newsId: String(n.newsId || ""),
        title: String(n.title || ""),
        body: n.body ?? "",
        url: n.url ?? "",
        updatedAt: n.updatedAt || "",
        startDate: n.startDate || "",
        endDate: n.endDate || "",
        publishAt: n.publishAt ?? null,
        tags: normalizeTags(n.tags),
        viewScope: normalizeViewScope(n.viewScope),
        createdAt: n.createdAt || "",
        isHidden: !!n.isHidden,
        bizId: String(n.bizId ?? ""),
        brandId: normalizeBrandId(n.brandId),
      }));

      setNewsList(normalized);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "読み込みに失敗しました");
    } finally {
      setLoading(false);
      setBusyText("");
    }
  }, [getAdminHeaders]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const deptMap = useMemo(
    () => depts.reduce((acc, d) => ({ ...acc, [d.deptId]: d }), {} as Record<string, Dept>),
    [depts]
  );

  const filtered = useMemo(() => {
    const kw = filterText.trim().toLowerCase();
    return newsList.filter((n) => {
      if (!kw) return true;
      const t = (n.title || "").toLowerCase().includes(kw);
      const id = (n.newsId || "").toLowerCase().includes(kw);
      const tag = (n.tags || []).some((x) => (x || "").toLowerCase().includes(kw));
      const body = (n.body || "").toLowerCase().includes(kw);
      const deptName = (deptMap[n.bizId || ""]?.name || "").toLowerCase().includes(kw);
      const brand = (normalizeBrandId(n.brandId) || "").toLowerCase().includes(kw);
      return t || id || tag || body || deptName || brand;
    });
  }, [newsList, filterText, deptMap]);

  const handleNew = () => {
    setSelected(null);
    setIsEditing(true);
    setForm(createEmptyNews());
    setTagInput("");
  };

  const handleSelect = (n: News) => {
    setSelected(n);
    setIsEditing(true);
    setForm(createEmptyNews(n));
    setTagInput((n.tags || []).join(", "));
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    if (name === "tags") {
      setTagInput(value);
      return;
    }
    if (name === "viewScope") {
      setForm((p) => ({ ...p, viewScope: normalizeViewScope(value) }));
      return;
    }
    if (name === "bizId") {
      setForm((p) => ({ ...p, bizId: String(value || "") }));
      return;
    }
    if (name === "brandId") {
      setForm((p) => ({ ...p, brandId: normalizeBrandId(value) }));
      return;
    }

    setForm((p) => ({ ...p, [name]: value }));
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (selected) {
      setForm(createEmptyNews(selected));
      setTagInput((selected.tags || []).join(", "));
    } else {
      setForm(createEmptyNews());
      setTagInput("");
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      alert("タイトル必須");
      return;
    }

    const finalTags = tagInput
      .split(/[,、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // ✅ publishAt 正規化（"" -> null / datetime-local -> ISO）
    const normalizedPublishAt = normalizePublishAtForSave(form.publishAt);

    const payload: News = {
      ...form,
      bizId: String(form.bizId ?? ""),
      brandId: normalizeBrandId(form.brandId),
      tags: finalTags,
      updatedAt: getTodayDate(),
      publishAt: normalizedPublishAt, // ✅ ここが重要
      viewScope: normalizeViewScope(form.viewScope),
    };

    setSaving(true);
    setBusyText(selected ? "保存しています..." : "新規作成しています...");

    try {
      const isNew = !selected;

      const res = await fetch("/api/news", {
        method: isNew ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json",
          ...getAdminHeaders(),
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.detail ? `${json.error}: ${json.detail}` : json?.error || "save failed";
        throw new Error(msg);
      }

      // ✅ 保存後の通知は「publishAt が空（= 即時）」のときだけ
      //    publishAt が入っている場合は cron 配信に任せる（即時誤爆防止）
      if (normalizedPublishAt === null) {
        try {
          await fetch("/api/news/notify?force=1", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAdminHeaders(),
            },
            body: JSON.stringify({ newsId: payload.newsId }),
          });
        } catch (e) {
          console.warn("notify failed (but save ok):", e);
        }
      }

      await loadAll();
      setIsEditing(false);
      alert(normalizedPublishAt ? "保存しました（予約配信）" : "保存しました（即時配信）");
    } catch (e: any) {
      alert(`保存エラー: ${e?.message || ""}`);
    } finally {
      setSaving(false);
      setBusyText("");
    }
  };

  const handleDelete = async (newsId: string) => {
    if (!confirm("本当にこのお知らせを削除しますか？")) return;

    setSaving(true);
    setBusyText("削除しています...");

    try {
      const res = await fetch(`/api/news?newsId=${encodeURIComponent(newsId)}`, {
        method: "DELETE",
        headers: { ...getAdminHeaders() },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.detail ? `${json.error}: ${json.detail}` : json?.error || "delete failed";
        throw new Error(msg);
      }

      await loadAll();
      setSelected(null);
      setIsEditing(false);
      alert("削除しました");
    } catch (e: any) {
      alert(`削除に失敗しました: ${e?.message || ""}`);
    } finally {
      setSaving(false);
      setBusyText("");
    }
  };

  return (
    <div className="kb-root">
      {busy && <BusyOverlay text={busyText || "処理中..."} />}

      <div className="kb-topbar">
        <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: 20, textDecoration: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
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

        <div style={{ fontSize: 18, fontWeight: 700 }}>お知らせ管理</div>

        <div>
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
            <div className="kb-admin-head">お知らせ一覧（{loading ? "..." : newsList.length}件）</div>
            <button
              className="kb-primary-btn"
              onClick={handleNew}
              style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999 }}
              disabled={busy}
            >
              ＋ 新規作成
            </button>
          </div>

          <input
            type="text"
            className="kb-admin-input"
            placeholder="タイトル、ID、本文、タグ、部署、ブランドで検索..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ marginBottom: 12 }}
            disabled={busy}
          />

          <div className="kb-list-scroll">
            {!loading &&
              filtered.map((n) => {
                const isSel = selected?.newsId === n.newsId;
                const deptName = deptMap[n.bizId || ""]?.name || "未設定";

                return (
                  <div
                    key={n.newsId}
                    className={`kb-item ${isSel ? "selected" : ""}`}
                    onClick={() => !busy && handleSelect(n)}
                    style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}
                  >
                    <div className="kb-item-title">
                      📰 {n.title}
                      <div style={{ marginLeft: 10, display: "inline-flex", gap: 8 }}>
                        <ScopeBadge scope={n.viewScope} />
                        <BrandBadge brandId={n.brandId} />
                      </div>
                    </div>
                    <div className="kb-item-meta">
                      部署: {deptName} / 更新日: {n.updatedAt || "未設定"} / 公開: {n.startDate || "-"} 〜 {n.endDate || "-"}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* 右：編集 */}
        <div className="kb-admin-card-large">
          <div className="kb-admin-head">
            {isEditing ? (selected ? "お知らせ編集" : "新規お知らせ作成") : selected ? "お知らせ詳細" : "未選択"}
          </div>

          {!selected && !isEditing && !loading && (
            <div style={{ color: "#6b7280", paddingTop: 30, textAlign: "center" }}>
              編集したいお知らせを選択するか、「＋ 新規作成」ボタンを押してください。
            </div>
          )}

          {(isEditing || selected) && (
            <div className="kb-form-scroll">
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">お知らせID</label>
                <input className="kb-admin-input full" value={form.newsId} readOnly style={{ background: "#f3f4f8" }} />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タイトル（必須）</label>
                <input
                  name="title"
                  className="kb-admin-input full"
                  value={form.title || ""}
                  onChange={handleChange}
                  readOnly={!isEditing}
                  disabled={busy}
                />
              </div>

              {/* ✅ 配信ブランド（復活） */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">配信ブランド</label>
                <select
                  name="brandId"
                  className="kb-admin-select full"
                  value={normalizeBrandId(form.brandId)}
                  onChange={handleChange}
                  disabled={!isEditing || busy}
                >
                  <option value="ALL">すべて</option>
                  <option value="JOYFIT">JOYFIT</option>
                  <option value="FIT365">FIT365</option>
                </select>
                <div className="kb-subnote full" style={{ marginTop: 6 }}>
                  ※ ユーザーのブランド設定に応じて配信対象を絞り込みます
                </div>
              </div>

              {/* ✅ 配信元部署（復活） */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">配信元部署</label>
                <select
                  name="bizId"
                  className="kb-admin-select full"
                  value={form.bizId || ""}
                  onChange={handleChange}
                  disabled={!isEditing || busy}
                >
                  <option value="">- 未設定 -</option>
                  {depts.map((d) => (
                    <option key={d.deptId} value={d.deptId}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <div className="kb-subnote full" style={{ marginTop: 6 }}>
                  ※ お知らせの「配信元」として表示したい部署を設定します
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">閲覧範囲（表示制御）</label>
                <select
                  name="viewScope"
                  className="kb-admin-select full"
                  value={normalizeViewScope(form.viewScope)}
                  onChange={handleChange}
                  disabled={!isEditing || busy}
                >
                  <option value="all">すべて（直営 / FC / 本部）</option>
                  <option value="direct">直営のみ（直営 / 本部）</option>
                </select>

                {/* ✅ 現在値バッジ（編集フォーム側にも表示） */}
                <div style={{ marginTop: 8 }}>
                  <ScopeBadge scope={form.viewScope} /> <BrandBadge brandId={form.brandId} />
                </div>

                <div className="kb-subnote full" style={{ marginTop: 6 }}>
                  ※「直営のみ」は <b>直営店舗</b> と <b>本部</b> のみ表示されます（FCは非表示）
                </div>
              </div>

              <div className="kb-admin-form-row two-col">
                <div>
                  <label className="kb-admin-label">公開開始日</label>
                  <input
                    type="date"
                    name="startDate"
                    className="kb-admin-input full"
                    value={form.startDate || ""}
                    onChange={handleChange}
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
                    value={form.endDate || ""}
                    onChange={handleChange}
                    readOnly={!isEditing}
                    disabled={busy}
                  />
                </div>
              </div>

              {/* ✅ 配信予約日時 */}
              <div className="kb-admin-form-row">
                <label className="kb-admin-label">配信予約日時（タイマー設定）</label>
                <input
                  type="datetime-local"
                  name="publishAt"
                  className="kb-admin-input full"
                  value={(form.publishAt as any) || ""}
                  onChange={handleChange}
                  readOnly={!isEditing}
                  disabled={busy}
                />
                <div className="kb-subnote">
                  ※空欄：保存後に即時通知 / 入力あり：指定時刻に通知（cron配信）
                </div>
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">本文</label>
                <textarea
                  name="body"
                  className="kb-admin-textarea full"
                  value={form.body || ""}
                  onChange={handleChange}
                  readOnly={!isEditing}
                  rows={6}
                  disabled={busy}
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">タグ（カンマ区切り）</label>
                <input
                  name="tags"
                  className="kb-admin-input full"
                  value={tagInput}
                  onChange={handleChange}
                  readOnly={!isEditing}
                  disabled={busy}
                  placeholder="例: 重要, メンテ, 障害"
                />
              </div>

              <div className="kb-admin-form-row">
                <label className="kb-admin-label full">参考URL（任意）</label>
                <input
                  name="url"
                  className="kb-admin-input full"
                  value={form.url || ""}
                  onChange={handleChange}
                  readOnly={!isEditing}
                  disabled={busy}
                  placeholder="https://example.com"
                />
              </div>

              <div className="kb-form-actions">
                {selected && (
                  <button
                    className="kb-delete-btn"
                    onClick={() => handleDelete(selected.newsId)}
                    type="button"
                    style={{ marginRight: "auto" }}
                    disabled={busy}
                  >
                    削除
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
                      disabled={busy || !form.title.trim()}
                      type="button"
                    >
                      {selected ? "保存" : "新規作成"}
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
          min-height: 120px;
        }
        .kb-subnote {
          font-size: 12px;
          color: #94a3b8;
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

        /* ✅ 閲覧範囲バッジ（青で統一） */
        .kb-scope-badge {
          font-size: 11px;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          line-height: 1;
          white-space: nowrap;
          border: 1px solid rgba(59, 130, 246, 0.28);
          background: rgba(59, 130, 246, 0.10);
          color: #1d4ed8;
        }

        /* ✅ ブランドバッジ（控えめ） */
        .kb-brand-badge {
          font-size: 11px;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          line-height: 1;
          white-space: nowrap;
          border: 1px solid rgba(2, 132, 199, 0.22);
          background: rgba(2, 132, 199, 0.08);
          color: #0369a1;
        }

        .kb-list-scroll {
          flex: 1;
          overflow-y: auto;
          padding-right: 4px;
        }
        .kb-item {
          padding: 16px;
          border-radius: 12px;
          background: #f8fafc;
          cursor: pointer;
          margin-bottom: 12px;
          border: 1px solid #f1f5f9;
          transition: 0.2s;
        }
        .kb-item:hover {
          background: #f1f5f9;
          transform: translateY(-1px);
        }
        .kb-item.selected {
          background: #eff6ff;
          border-color: #3b82f6;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.08);
        }
        .kb-item-title {
          font-size: 14px;
          font-weight: 800;
          color: #1e293b;
          display: flex;
          align-items: center;
        }
        .kb-item-meta {
          font-size: 12px;
          color: #64748b;
          margin-top: 6px;
        }

        .kb-form-scroll {
          flex: 1;
          overflow-y: auto;
          padding-right: 4px;
        }
        .kb-admin-form-row {
          margin-bottom: 18px;
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

        .kb-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 24px;
          padding-top: 18px;
          border-top: 1px dashed #e2e8f0;
        }

        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
}
