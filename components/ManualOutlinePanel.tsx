"use client";

// マニュアルプレビュー用の共通アウトラインパネル。
//   動画 → チャプター(時刻付き) / ドキュメント → 目次(番号付き)
// 表示専用(頭出しは非対応。動画は現状非YouTubeのため)。管理者は「AIで生成」可。
import React, { useEffect, useState } from "react";

type Chapter = { t: number; title: string };
type TocItem = { title: string; page?: number };

const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};

export default function ManualOutlinePanel({ manualId, type, onSeek, onJump }: {
  manualId: string;
  type?: string;
  onSeek?: (sec: number) => void;   // 動画の頭出し(可能な埋め込みのみ。渡されたらチャプターがクリック可)
  onJump?: (page: number) => void;  // ドキュメントのページ/スライドジャンプ(Slides等。渡されたらpage付き目次がクリック可)
}) {
  const isVideo = type === "video";
  const endpoint = isVideo ? "chapters" : "toc";
  const label = isVideo ? "チャプター" : "目次";
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [gen, setGen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setChapters([]); setToc([]);
    fetch(`/api/manuals/${encodeURIComponent(manualId)}/${endpoint}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive || !d?.ok) return; if (isVideo) setChapters(d.chapters || []); else setToc(d.toc || []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    fetch("/api/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.ok) setIsAdmin(["admin", "sv"].includes(String(d.user?.role || ""))); }).catch(() => {});
    return () => { alive = false; };
  }, [manualId, endpoint, isVideo]);

  const generate = async () => {
    setGen(true);
    try {
      const res = await fetch(`/api/manuals/${encodeURIComponent(manualId)}/${endpoint}`, { method: "POST" });
      const d = await res.json();
      if (d.ok) { if (isVideo) setChapters(d.chapters || []); else setToc(d.toc || []); }
      else alert(d.error || "生成に失敗しました");
    } catch { alert("生成に失敗しました"); }
    finally { setGen(false); }
  };

  const items = isVideo ? chapters : toc;

  return (
    <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", minHeight: 0 }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #eef2f7", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>{label}</span>
        {isAdmin && (
          <button onClick={generate} disabled={gen}
            style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 8, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", cursor: gen ? "default" : "pointer" }}>
            {gen ? "生成中…" : items.length ? "再生成" : "AIで生成"}
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8", padding: "16px 8px", textAlign: "center", lineHeight: 1.7 }}>
            {loading || gen ? "読み込み中…" : `${label}はまだありません。` + (isAdmin ? "「AIで生成」で作成できます。" : "")}
          </div>
        ) : isVideo ? (
          chapters.map((c, i) => {
            const clickable = !!onSeek;
            return (
              <button key={i} type="button" onClick={() => onSeek?.(c.t)} disabled={!clickable}
                title={clickable ? "ここから再生" : "この動画は頭出し非対応（時刻は参考表示）"}
                style={{ display: "flex", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", marginBottom: 2, cursor: clickable ? "pointer" : "default" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#4338ca", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 38 }}>{fmtTime(c.t)}</span>
                <span style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>{c.title}</span>
              </button>
            );
          })
        ) : (
          toc.map((c, i) => {
            const clickable = !!onJump && !!c.page;
            return (
              <button key={i} type="button" onClick={() => c.page && onJump?.(c.page)} disabled={!clickable}
                title={clickable ? `スライド ${c.page} へ` : undefined}
                style={{ display: "flex", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", marginBottom: 2, cursor: clickable ? "pointer" : "default" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#4338ca", flexShrink: 0, minWidth: 24 }}>{c.page ? `P${c.page}` : i + 1}</span>
                <span style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>{c.title}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
