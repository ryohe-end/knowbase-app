"use client";
export const dynamic = "force-dynamic";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * 型定義
 */
type ManualDraft = {
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

const DRAFT_KEY = "kb_manual_draft_v1";

/**
 * 編集用URLの組み立て
 */
function buildEditUrl(fileId?: string | null, editUrl?: string | null) {
  if (editUrl && editUrl.startsWith("http")) return editUrl;
  if (fileId) return `https://docs.google.com/presentation/d/${fileId}/edit`;
  return "";
}

/**
 * プレビュー用URLの組み立て (Google Slides embed)
 */
function buildEmbedUrl(fileId?: string | null, editUrl?: string | null) {
  const url = buildEditUrl(fileId, editUrl);
  if (!url) return "";
  const m = url.match(/\/d\/([\w-]+)/);
  const id = m?.[1] || fileId;
  if (!id) return "";
  return `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false&delayms=3000`;
}

/**
 * LocalStorage 操作
 */
function safeGetDraft(): ManualDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeClearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

/**
 * メインコンポーネント
 */
export default function ManualEditLanding() {
  const router = useRouter();
  const sp = useSearchParams();

  // URLパラメータから情報を取得
  const fileId = sp.get("fileId"); 
  const editUrlParam = sp.get("editUrl");

  // メモ化されたURL
  const editUrl = useMemo(
    () => buildEditUrl(fileId, editUrlParam),
    [fileId, editUrlParam]
  );
  const embedUrl = useMemo(
    () => buildEmbedUrl(fileId, editUrlParam),
    [fileId, editUrlParam]
  );

  const [draft, setDraft] = useState<ManualDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // 初回マウント時に下書きをロード
  useEffect(() => {
    setDraft(safeGetDraft());
  }, []);

  const canSave = !!draft?.title && !!editUrl;

  /**
   * 保存処理 (DBへの登録)
   */
  const saveAndBack = async () => {
    if (!draft) {
      alert("下書き（draft）が見つかりません。管理画面に戻ってやり直してください。");
      return;
    }
    if (!editUrl) {
      alert("編集URLが取得できませんでした。");
      return;
    }

    setSaving(true);
    try {
      const payload: ManualDraft = {
        ...draft,
        embedUrl: editUrl, // 編集URLを保存用URLとしてセット
        tags: draft.tags || [],
      };

      const res = await fetch("/api/manuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        alert(`保存に失敗しました: ${json.error || res.statusText}`);
        return;
      }

      const newManualId = json.manualId || payload.manualId;
      safeClearDraft();
      router.push(`/admin/manuals?select=${encodeURIComponent(newManualId)}`);
    } catch (e) {
      console.error(e);
      alert("保存中にエラーが発生しました。");
    } finally {
      setSaving(false);
    }
  };

  /**
   * 破棄処理 (下書き削除 + Driveファイル削除)
   */
  const discardAndBack = async () => {
    const ok = confirm(
      "下書きを破棄します。\n※作成したGoogleスライド（コピー）もゴミ箱に移動します。\nよろしいですか？"
    );
    if (!ok) return;

    setDiscarding(true);
    try {
      if (fileId) {
        const res = await fetch("/api/drive/trash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        const json = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          alert(`下書きは破棄しますが、ファイルの削除に失敗しました。\n${json.error || res.statusText}`);
        }
      }
      safeClearDraft();
      router.push("/admin/manuals");
    } catch (e) {
      console.error(e);
      alert("破棄処理中にエラーが発生しました。");
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <div style={{ padding: 18, maxWidth: 1100, margin: "0 auto", fontFamily: "sans-serif" }}>
      {/* ヘッダーエリア */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>
          テンプレート作成完了：編集 → 登録
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Link href="/admin/manuals">
            <button style={btnSecondary}>← 管理画面へ戻る</button>
          </Link>
        </div>
      </div>

      {!draft && (
        <div style={noteDanger}>
          下書き（draft）が見つかりません。<br />
          /admin/manuals に戻って「テンプレートから作成」を押し直してください。
        </div>
      )}

      {draft && (
        <>
          {/* メインカード */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14 }}>
              登録内容（下書き）
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, fontSize: 13, marginBottom: 20 }}>
              <div style={{ color: "#6b7280" }}>タイトル</div>
              <div style={{ fontWeight: 700 }}>{draft.title}</div>
              <div style={{ color: "#6b7280" }}>manualId</div>
              <div>{draft.manualId}</div>
              <div style={{ color: "#6b7280" }}>fileId（コピー）</div>
              <div style={{ wordBreak: "break-all" }}>{fileId || "(なし)"}</div>
              <div style={{ color: "#6b7280" }}>embedUrl（保存用）</div>
              <div style={{ wordBreak: "break-all" }}>{editUrl || "(取得不可)"}</div>
            </div>

            {/* ✅ ボタン配置の修正：編集・登録・破棄 */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
              
              {/* 1. Googleスライドで編集 (黄色) */}
              {editUrl ? (
                <button
                  type="button"
                  style={{
                    ...btnPrimary,
                    background: "#facc15",
                    borderColor: "#facc15",
                    color: "#000",
                    boxShadow: "0 4px 12px rgba(250, 204, 21, 0.25)"
                  }}
                  onClick={() => window.open(editUrl, "_blank", "noopener,noreferrer")}
                >
                  Googleスライドで編集 (新しいタブ)
                </button>
              ) : (
                <button style={{ ...btnPrimary, opacity: 0.5 }} disabled>編集URLなし</button>
              )}

              {/* 2. 登録ボタン (青色) */}
              <button
                style={{
                  ...btnPrimary,
                  opacity: canSave && !saving ? 1 : 0.5,
                  cursor: canSave && !saving ? "pointer" : "not-allowed",
                }}
                onClick={saveAndBack}
                disabled={!canSave || saving}
              >
                {saving ? "保存中..." : "この編集URLでマニュアル登録して戻る"}
              </button>

              {/* 3. 破棄ボタン (赤色系) */}
              <button
                style={{
                  ...btnSecondary,
                  background: "#fee2e2",
                  color: "#b91c1c",
                  borderColor: "#fecdd3",
                  opacity: discarding ? 0.6 : 1,
                }}
                onClick={discardAndBack}
                disabled={discarding}
              >
                {discarding ? "破棄中..." : "下書きを破棄して戻る（コピーも削除）"}
              </button>
            </div>

            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 12 }}>
              ※「登録して戻る」を押すまでDBには保存されません。<br />
              ※破棄は、下書き削除とGoogleドライブ上のファイルをゴミ箱へ移動します。
            </div>
          </div>

          {/* プレビューエリア */}
          {embedUrl && (
            <div style={{ ...card, marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
                プレビュー（閲覧用）
              </div>
              <div style={{ width: "100%", paddingTop: "56.25%", position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb", background: "#0b1220" }}>
                <iframe
                  src={embedUrl}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                  allowFullScreen
                  loading="lazy"
                />
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
                ※プレビュー画面では編集できません。編集は上の黄色いボタンをクリックしてください。
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * スタイル定義
 */
const btnPrimary: React.CSSProperties = {
  background: "#0ea5e9",
  color: "#fff",
  border: "1px solid #0ea5e9",
  borderRadius: 999,
  padding: "12px 24px",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const btnSecondary: React.CSSProperties = {
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 999,
  padding: "12px 24px",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 10px 25px rgba(15,23,42,0.05)",
};

const noteDanger: React.CSSProperties = {
  background: "#fff1f2",
  border: "1px solid #fecdd3",
  color: "#9f1239",
  borderRadius: 12,
  padding: 16,
  fontSize: 14,
  fontWeight: 800,
};