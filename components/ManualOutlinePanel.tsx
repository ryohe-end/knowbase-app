"use client";

// マニュアルプレビュー用の共通アウトラインパネル。
//   動画 → チャプター(時刻付き) / ドキュメント → 目次(スライド番号付き)
// プレビューを開くと未生成分は自動生成される(ボタン操作不要)。前処理未実施のものは前処理を自動起動。
// クリックで頭出し: onSeek(動画/YouTube) / onJump(Slidesのスライド番号)。
import React, { useEffect, useRef, useState } from "react";

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
  onJump?: (page: number) => void;  // ドキュメントのスライドジャンプ(Slides等。渡されたらpage付き目次がクリック可)
}) {
  const isVideo = type === "video";
  const endpoint = isVideo ? "chapters" : "toc";
  const label = isVideo ? "チャプター" : "目次";
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [toc, setToc] = useState<TocItem[]>([]);
  // status: loading(取得中) | generating(自動生成中) | ready | none(対象外) | preprocessing(前処理中) | error
  const [status, setStatus] = useState<"loading" | "generating" | "ready" | "none" | "preprocessing" | "error">("loading");
  const genGuard = useRef<string>("");

  useEffect(() => {
    let alive = true;
    setStatus("loading"); setChapters([]); setToc([]);

    const applyItems = (d: any): number => {
      if (isVideo) { const c = d.chapters || []; setChapters(c); return c.length; }
      const t = d.toc || []; setToc(t); return t.length;
    };

    const autoGenerate = async () => {
      if (genGuard.current === manualId) return; // 同一マニュアルで多重生成しない
      genGuard.current = manualId;
      if (alive) setStatus("generating");
      try {
        const res = await fetch(`/api/manuals/${encodeURIComponent(manualId)}/${endpoint}`, { method: "POST", cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.status === 202) { setStatus("preprocessing"); return; } // 前処理起動(未MD)
        if (d.ok) { const n = applyItems(d); setStatus(n > 0 ? "ready" : "none"); }
        else setStatus("error");
      } catch { if (alive) setStatus("error"); }
    };

    fetch(`/api/manuals/${encodeURIComponent(manualId)}/${endpoint}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (d?.ok && applyItems(d) > 0) { setStatus("ready"); return; }
        if (d?.outlineNone) { setStatus("none"); return; }
        autoGenerate(); // 未生成 → 自動生成
      })
      .catch(() => { if (alive) setStatus("error"); });

    return () => { alive = false; };
  }, [manualId, endpoint, isVideo]);

  const items = isVideo ? chapters : toc;
  const msg = status === "loading" ? "読み込み中…"
    : status === "generating" ? `${label}を自動生成中…（初回のみ数秒）`
    : status === "preprocessing" ? "前処理(Markdown化)を開始しました。数分後にもう一度開くと表示されます。"
    : status === "none" ? `この資料は${label}に対応していません。`
    : status === "error" ? `${label}を準備できませんでした。`
    : `${label}はまだありません。`;

  return (
    <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", minHeight: 0 }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>{label}</span>
        {(status === "generating" || status === "loading") && <span style={{ fontSize: 11, color: "#94a3b8" }}>準備中…</span>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8", padding: "16px 8px", textAlign: "center", lineHeight: 1.7 }}>{msg}</div>
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
