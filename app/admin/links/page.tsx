"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ExternalLink = {
  linkId: string;
  title: string;
  url: string;
  description?: string;
  sortOrder?: number;
  isActive: boolean;
  createdAt?: string;
};

export default function ExternalLinksAdminPage() {
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLink, setSelectedLink] = useState<Partial<ExternalLink> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 一覧取得
  const fetchLinks = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/external-links");
      const data = await res.json();
      setLinks(data.links || []);
    } catch (err) {
      alert("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  // 新規作成ボタン
  const handleCreateNew = () => {
    setSelectedLink({
      title: "",
      url: "",
      description: "",
      sortOrder: 0,
      isActive: true,
    });
  };

  // 保存
  const handleSave = async () => {
    if (!selectedLink?.title || !selectedLink?.url) {
      alert("タイトルとURLは必須です");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/external-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedLink),
      });
      if (res.ok) {
        alert("保存しました");
        setSelectedLink(null);
        fetchLinks();
      }
    } catch (err) {
      alert("保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  // 削除
  const handleDelete = async (linkId: string) => {
    if (!confirm("本当に削除しますか？")) return;
    try {
      const res = await fetch(`/api/external-links/${linkId}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedLink(null);
        fetchLinks();
      }
    } catch (err) {
      alert("削除に失敗しました");
    }
  };

  return (
    <div className="kb-admin-wrap" style={{ display: "flex", height: "100vh", background: "#f8fafc" }}>
      {/* 左：リストパネル */}
      <div style={{ width: 350, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#fff" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
            <h1 style={{ fontSize: 18, fontWeight: "bold", margin: 0 }}>外部リンク管理</h1>
            <Link href="/admin" className="kb-secondary-btn" style={{ fontSize: 12, textDecoration: "none" }}>戻る</Link>
          </div>
          <button onClick={handleCreateNew} className="kb-primary-btn" style={{ width: "100%", padding: "10px" }}>
            + 新規リンク追加
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 20, color: "#64748b" }}>読み込み中...</div>
          ) : (
            links.map((link) => (
              <div
                key={link.linkId}
                onClick={() => setSelectedLink(link)}
                style={{
                  padding: "15px 20px",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  background: selectedLink?.linkId === link.linkId ? "#f0f9ff" : "transparent",
                  borderLeft: selectedLink?.linkId === link.linkId ? "4px solid #0ea5e9" : "4px solid transparent",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{link.title}</div>
                <div style={{ fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {link.url}
                </div>
                {!link.isActive && (
                  <span style={{ fontSize: 10, background: "#e2e8f0", padding: "2px 6px", borderRadius: 4, marginTop: 5, display: "inline-block" }}>
                    非表示
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右：詳細編集パネル */}
      <div style={{ flex: 1, padding: 40, overflowY: "auto" }}>
        {selectedLink ? (
          <div style={{ maxWidth: 600, background: "#fff", padding: 30, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
            <h2 style={{ marginTop: 0, marginBottom: 25, fontSize: 20 }}>
              {selectedLink.linkId ? "リンクの編集" : "新規リンク登録"}
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>タイトル</label>
                <input
                  type="text"
                  className="kb-admin-input"
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  value={selectedLink.title || ""}
                  onChange={(e) => setSelectedLink({ ...selectedLink, title: e.target.value })}
                  placeholder="例：勤怠管理システム"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>URL</label>
                <input
                  type="text"
                  className="kb-admin-input"
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  value={selectedLink.url || ""}
                  onChange={(e) => setSelectedLink({ ...selectedLink, url: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>説明文（任意）</label>
                <textarea
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", minHeight: 80 }}
                  value={selectedLink.description || ""}
                  onChange={(e) => setSelectedLink({ ...selectedLink, description: e.target.value })}
                  placeholder="サイドバーに表示される補足説明です"
                />
              </div>

              <div style={{ display: "flex", gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>並び順</label>
                  <input
                    type="number"
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    value={selectedLink.sortOrder || 0}
                    onChange={(e) => setSelectedLink({ ...selectedLink, sortOrder: parseInt(e.target.value) })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>表示状態</label>
                  <select
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    value={selectedLink.isActive ? "true" : "false"}
                    onChange={(e) => setSelectedLink({ ...selectedLink, isActive: e.target.value === "true" })}
                  >
                    <option value="true">表示</option>
                    <option value="false">非表示</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {selectedLink.linkId && (
                  <button
                    onClick={() => handleDelete(selectedLink.linkId!)}
                    style={{ background: "transparent", color: "#ef4444", border: "none", cursor: "pointer", fontSize: 13 }}
                  >
                    このリンクを削除する
                  </button>
                )}
                <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
                  <button onClick={() => setSelectedLink(null)} className="kb-secondary-btn">キャンセル</button>
                  <button onClick={handleSave} disabled={isSaving} className="kb-primary-btn">
                    {isSaving ? "保存中..." : "変更を保存"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyItems: "center", color: "#94a3b8", textAlign: "center", width: "100%" }}>
            <div style={{ width: "100%" }}>左側のリストから選択するか、新規作成してください</div>
          </div>
        )}
      </div>
    </div>
  );
}