// app/admin/manuals/edit/page.tsx
"use client";
export const dynamic = 'force-dynamic';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

// editUrl優先、なければfileIdから組み立て
function buildEditUrl(fileId?: string | null, editUrl?: string | null) {
  if (editUrl && editUrl.startsWith("http")) return editUrl;
  if (fileId) return `https://docs.google.com/presentation/d/${fileId}/edit`;
  return "";
}

// Slides embed（プレビュー用）
function buildEmbedUrl(fileId?: string | null, editUrl?: string | null) {
  const url = buildEditUrl(fileId, editUrl);
  if (!url) return "";
  const m = url.match(/\/d\/([\w-]+)/);
  const id = m?.[1] || fileId;
  if (!id) return "";
  return `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false&delayms=3000`;
}

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

export default function ManualEditLanding() {
  const router = useRouter();
  const sp = useSearchParams();

  const fileId = sp.get("fileId");
  const editUrlParam = sp.get("editUrl");

  const editUrl = useMemo(() => buildEditUrl(fileId, editUrlParam), [fileId, editUrlParam]);
  const embedUrl = useMemo(() => buildEmbedUrl(fileId, editUrlParam), [fileId, editUrlParam]);

  const [draft, setDraft] = useState<ManualDraft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(safeGetDraft());
  }, []);

  const canSave = !!draft?.title && !!editUrl;

  const saveAndBack = async () => {
    if (!draft) {
      alert("下書き（draft）が見つかりません。/admin/manuals に戻ってやり直してください。");
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
        // ✅ ここが肝：編集URLを embedUrl として保存
        embedUrl: editUrl,
        tags: draft.tags || [],
      };

      // ✅ 新規としてPOST（manualIdはサーバ側が採番する想定）
      // 既存仕様が「M200-」判定なら manualId をそのまま送ってもOK
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

      // サーバが採番したIDが返る想定
      const newManualId = json.manualId || payload.manualId;

      safeClearDraft();

      // ✅ 管理画面へ戻って自動選択
      router.push(`/admin/manuals?select=${encodeURIComponent(newManualId)}`);
    } catch (e) {
      console.error(e);
      alert("保存中にエラーが発生しました。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 18, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>テンプレート作成完了：編集 → 登録</div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/manuals">
            <button style={btnSecondary}>← 管理画面へ戻る</button>
          </Link>

          {editUrl ? (
            <button
              style={btnPrimary}
              onClick={() => window.open(editUrl, "_blank", "noopener,noreferrer")}
            >
              Googleスライドで編集（新しいタブ）
            </button>
          ) : (
            <button style={{ ...btnPrimary, opacity: 0.5 }} disabled>
              編集URLがありません
            </button>
          )}
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
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>登録内容（下書き）</div>

            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, fontSize: 13 }}>
              <div style={{ color: "#6b7280" }}>タイトル</div>
              <div style={{ fontWeight: 700 }}>{draft.title}</div>

              <div style={{ color: "#6b7280" }}>manualId</div>
              <div>{draft.manualId}</div>

              <div style={{ color: "#6b7280" }}>embedUrl（保存するURL）</div>
              <div style={{ wordBreak: "break-all" }}>{editUrl || "(取得できません)"}</div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button
                style={{ ...btnPrimary, opacity: canSave && !saving ? 1 : 0.5, cursor: canSave && !saving ? "pointer" : "not-allowed" }}
                onClick={saveAndBack}
                disabled={!canSave || saving}
              >
                {saving ? "保存中..." : "この編集URLでマニュアル登録して戻る"}
              </button>

              <button
                style={btnSecondary}
                onClick={() => {
                  safeClearDraft();
                  alert("下書きを破棄しました。/admin/manuals に戻ります。");
                  router.push("/admin/manuals");
                }}
              >
                下書きを破棄して戻る
              </button>
            </div>

            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
              ※「登録して戻る」を押すまで、DB（DynamoDB）には保存されません。
            </div>
          </div>

          {embedUrl && (
            <div style={{ ...card, marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>プレビュー（閲覧用）</div>

              <div
                style={{
                  width: "100%",
                  paddingTop: "56.25%",
                  position: "relative",
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "1px solid #e5e7eb",
                  background: "#0b1220",
                }}
              >
                <iframe
                  src={embedUrl}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                  allowFullScreen
                  loading="lazy"
                />
              </div>

              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
                ※ここは編集不可です（表示確認用）。編集は上のボタンから。
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: "#0ea5e9",
  color: "#fff",
  border: "1px solid #0ea5e9",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 800,
  fontSize: 13,
};

const btnSecondary: React.CSSProperties = {
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 800,
  fontSize: 13,
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 10px 20px rgba(15,23,42,0.04)",
};

const noteDanger: React.CSSProperties = {
  background: "#fff1f2",
  border: "1px solid #fecdd3",
  color: "#9f1239",
  borderRadius: 12,
  padding: 12,
  fontSize: 13,
  fontWeight: 800,
};