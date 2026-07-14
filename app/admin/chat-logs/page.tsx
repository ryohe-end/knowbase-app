"use client";

// AIチャット会話ログ (管理者専用)。誰が・いつ・何を聞き・どう答えたかを一覧。
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type ChatLog = {
  userId: string;
  ts: string;
  day?: string;
  query: string;
  answer?: string;
  sourceIds?: string[];
};

function fmtJst(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}/${p(j.getUTCMonth() + 1)}/${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

export default function ChatLogsPage() {
  const [logs, setLogs] = useState<ChatLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState<ChatLog | null>(null);

  const [userId, setUserId] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (userId.trim()) p.set("userId", userId.trim());
      if (q.trim()) p.set("q", q.trim());
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      p.set("limit", "300");
      const res = await fetch(`/api/admin/chat-logs?${p}`, { cache: "no-store" });
      if (res.status === 403) { setError("この画面は管理者のみ閲覧できます。"); setLogs([]); return; }
      const data = await res.json();
      if (!data.ok) { setError(data.error || "取得に失敗しました"); setLogs([]); return; }
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTruncated(!!data.truncated);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [userId, q, from, to]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const exportCsv = useCallback(() => {
    const header = ["日時(JST)", "利用者", "質問", "回答", "出典"];
    const rows = logs.map((l) => [
      fmtJst(l.ts), l.userId, l.query, (l.answer || "").replace(/\s+/g, " "), (l.sourceIds || []).join(" "),
    ]);
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chat-logs.csv";
    a.click();
  }, [logs]);

  return (
    <div className="cl-root">
      <div className="cl-top">
        <Link href="/admin" className="cl-back">← 管理トップへ戻る</Link>
        <h1>AIチャット 会話ログ</h1>
        <p>誰が・いつ・何を質問し、どう回答したかを確認できます（管理者専用）。</p>
      </div>

      <div className="cl-filters">
        <label><span>利用者(メール)</span><input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user@example.com" /></label>
        <label><span>本文検索</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="質問・回答に含む語" /></label>
        <label><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="cl-actions">
          <button className="cl-btn primary" onClick={load} disabled={loading}>{loading ? "取得中…" : "絞り込み"}</button>
          <button className="cl-btn" onClick={exportCsv} disabled={logs.length === 0}>CSV出力</button>
        </div>
      </div>

      <div className="cl-summary">
        <span>{logs.length} 件</span>
        {truncated && <span className="cl-warn">※ 上限に達したため一部のみ。期間で絞ってください。</span>}
      </div>
      {error && <div className="cl-error">{error}</div>}

      <div className="cl-tablewrap">
        <table className="cl-table">
          <thead><tr><th>日時 (JST)</th><th>利用者</th><th>質問</th><th>出典</th><th></th></tr></thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={`${l.userId}-${l.ts}-${i}`}>
                <td className="nowrap">{fmtJst(l.ts)}</td>
                <td>{l.userId}</td>
                <td className="cl-q">{l.query}</td>
                <td className="cl-src">{(l.sourceIds || []).length}</td>
                <td><button className="cl-view" onClick={() => setOpen(l)}>詳細</button></td>
              </tr>
            ))}
            {logs.length === 0 && !loading && <tr><td colSpan={5} className="cl-empty">ログがありません。</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="cl-modal-bg" onClick={() => setOpen(null)}>
          <div className="cl-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cl-modal-head">
              <div><b>{open.userId}</b><span className="cl-modal-time">{fmtJst(open.ts)}</span></div>
              <button className="cl-modal-x" onClick={() => setOpen(null)}>×</button>
            </div>
            <div className="cl-modal-body">
              <div className="cl-modal-label">質問</div>
              <div className="cl-modal-q">{open.query}</div>
              <div className="cl-modal-label">回答</div>
              <div className="cl-modal-a">{open.answer || "(なし)"}</div>
              {(open.sourceIds || []).length > 0 && (
                <><div className="cl-modal-label">出典</div>
                <div className="cl-modal-src">{(open.sourceIds || []).map((s) => <span key={s} className="cl-chip">{s}</span>)}</div></>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .cl-root { max-width: 1200px; margin: 0 auto; padding: 28px 24px 80px; font-family: -apple-system, "Hiragino Sans", sans-serif; color: #0f172a; }
        .cl-back { font-size: 13px; color: #64748b; font-weight: 600; text-decoration: none; }
        .cl-top h1 { font-size: 22px; font-weight: 800; margin: 10px 0 4px; }
        .cl-top p { color: #64748b; font-size: 13px; margin: 0 0 20px; }
        .cl-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
        .cl-filters label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
        .cl-filters input { border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 10px; font-size: 13px; min-width: 150px; }
        .cl-actions { display: flex; gap: 8px; margin-left: auto; }
        .cl-btn { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
        .cl-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
        .cl-btn:disabled { opacity: .55; cursor: default; }
        .cl-summary { display: flex; gap: 12px; font-size: 12px; color: #64748b; margin-bottom: 8px; }
        .cl-warn { color: #b45309; }
        .cl-error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
        .cl-tablewrap { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
        .cl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .cl-table th { background: #f1f5f9; text-align: left; padding: 10px 14px; color: #475569; font-weight: 700; border-bottom: 1px solid #e2e8f0; }
        .cl-table td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
        .nowrap { white-space: nowrap; }
        .cl-q { max-width: 620px; }
        .cl-src { text-align: center; color: #64748b; }
        .cl-view { border: 1px solid #e2e8f0; background: #fff; border-radius: 7px; padding: 4px 12px; font-size: 12px; font-weight: 700; color: #2563eb; cursor: pointer; }
        .cl-empty { text-align: center; color: #94a3b8; padding: 30px; }
        .cl-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,.5); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 20px; }
        .cl-modal { background: #fff; border-radius: 16px; width: 100%; max-width: 680px; max-height: 86vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 60px -15px rgba(0,0,0,.4); }
        .cl-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
        .cl-modal-time { color: #94a3b8; font-size: 12px; margin-left: 10px; }
        .cl-modal-x { border: none; background: #f1f5f9; width: 30px; height: 30px; border-radius: 50%; font-size: 18px; cursor: pointer; color: #64748b; }
        .cl-modal-body { padding: 18px 20px; overflow-y: auto; }
        .cl-modal-label { font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; margin: 14px 0 5px; }
        .cl-modal-label:first-child { margin-top: 0; }
        .cl-modal-q { font-size: 14px; font-weight: 600; color: #1e293b; background: #eff6ff; border-radius: 10px; padding: 10px 14px; }
        .cl-modal-a { font-size: 13.5px; line-height: 1.7; color: #334155; white-space: pre-wrap; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 10px; padding: 12px 14px; }
        .cl-modal-src { display: flex; flex-wrap: wrap; gap: 6px; }
        .cl-chip { background: #eef2ff; color: #4338ca; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      `}</style>
    </div>
  );
}
