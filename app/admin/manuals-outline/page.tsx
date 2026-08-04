"use client";

// 管理者用: 全マニュアルの目次(doc)/チャプター(動画)を一括事前生成する。
// 生成が進む限りバッチを繰り返し、未MDのものは前処理(Markdown化)を起動する。
import React, { useState } from "react";
import Link from "next/link";

type Res = { manualId: string; kind: string; count: number; note?: string };

export default function ManualsOutlinePage() {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [sum, setSum] = useState({ generated: 0, triggered: 0, waiting: 0, none: 0 });

  const push = (s: string) => setLog((p) => [...p, s]);

  const run = async () => {
    setRunning(true); setLog([]); setSum({ generated: 0, triggered: 0, waiting: 0, none: 0 });
    let pass = 0;
    const acc = { generated: 0, triggered: 0, waiting: 0, none: 0 };
    try {
      // 生成が進む(generated>0)限りループ。前処理待ちだけになったら停止。
      // 安全のため最大60パス。
      for (pass = 1; pass <= 60; pass++) {
        const res = await fetch("/api/manuals/outline-backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 6 }) });
        const d = await res.json();
        if (!res.ok || !d.ok) { push(`エラー: ${d?.error || res.status}`); break; }
        acc.generated += d.generated || 0; acc.triggered += d.triggered || 0; acc.waiting += (d.results || []).filter((r: Res) => r.note === "前処理待ち").length;
        acc.none += (d.results || []).filter((r: Res) => (r.note || "").includes("スキップ")).length;
        setSum({ ...acc });
        const detail = (d.results || []).map((r: Res) => `${r.manualId}:${r.kind}${r.count ? `(${r.count})` : ""}${r.note ? `[${r.note}]` : ""}`).join(" / ");
        push(`パス${pass}: 生成${d.generated} 前処理起動${d.triggered} 残り${d.remaining} … ${detail}`);
        if ((d.generated || 0) === 0 && (d.triggered || 0) === 0) { push("進捗なし。停止します。"); break; }
        if ((d.remaining || 0) === 0) { push("完了。"); break; }
      }
    } catch (e: any) { push(`失敗: ${e?.message || e}`); }
    finally { setRunning(false); }
  };

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", fontFamily: "sans-serif", color: "#0f172a" }}>
      <div style={{ height: 60, background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", width: "100%", padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Link href="/admin" style={{ textDecoration: "none", fontSize: 13, fontWeight: 600, color: "#64748b" }}>← メニューへ戻る</Link>
          <div style={{ fontWeight: 700 }}>目次・チャプター 一括生成</div>
          <span style={{ width: 88 }} />
        </div>
      </div>
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px" }}>目次・チャプターの一括事前生成</h1>
        <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, margin: "0 0 20px" }}>
          全マニュアルの<b>目次（ドキュメント）</b>と<b>チャプター（動画）</b>をまとめて生成します。生成済みのものはスキップ。
          <b>前処理（Markdown化）されていない</b>マニュアルは前処理を起動します（動画の文字起こし等に数分かかるため、完了後に再度このボタンで生成してください）。
        </p>
        <button onClick={run} disabled={running}
          style={{ border: "none", background: running ? "#94a3b8" : "#2563eb", color: "#fff", fontSize: 14, fontWeight: 800, padding: "12px 22px", borderRadius: 10, cursor: running ? "default" : "pointer" }}>
          {running ? "実行中…" : "一括生成を実行"}
        </button>

        <div style={{ display: "flex", gap: 12, margin: "20px 0" }}>
          {[["生成", sum.generated, "#059669"], ["前処理起動", sum.triggered, "#d97706"], ["前処理待ち", sum.waiting, "#64748b"], ["対象外", sum.none, "#94a3b8"]].map(([l, v, c]) => (
            <div key={l as string} style={{ flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>{l as string}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: c as string }}>{v as number}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#0f172a", color: "#cbd5e1", borderRadius: 12, padding: 14, fontSize: 12, fontFamily: "monospace", maxHeight: 360, overflowY: "auto", lineHeight: 1.7 }}>
          {log.length === 0 ? <span style={{ color: "#64748b" }}>ここに進捗が表示されます。</span> : log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </main>
    </div>
  );
}
