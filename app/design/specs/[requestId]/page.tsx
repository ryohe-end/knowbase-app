"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type DesignChangeRequest, type DesignStatus } from "@/types/designChange";

const NEXT: Record<DesignStatus, DesignStatus[]> = {
  "依頼": ["検討中", "差戻し"], "検討中": ["承認待ち", "差戻し"], "承認待ち": ["承認済", "差戻し"],
  "承認済": ["検証中", "差戻し"], "検証中": ["完了", "差戻し"], "差戻し": ["依頼", "検討中"], "完了": [],
};
const SC: Record<DesignStatus, string> = {
  "依頼": "#64748b", "検討中": "#d97706", "承認待ち": "#ea580c", "承認済": "#059669", "検証中": "#0891b2", "完了": "#334155", "差戻し": "#dc2626",
};
const FLOW: DesignStatus[] = ["依頼", "検討中", "承認待ち", "承認済", "検証中", "完了"];
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default function DesignRequestPage() {
  const params = useParams();
  const requestId = String(params?.requestId || "");
  const [req, setReq] = useState<DesignChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<{ userId: string; name: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/design/requests?id=${encodeURIComponent(requestId)}`, { cache: "no-store" });
      const d = await res.json();
      if (res.ok && d.ok) setReq(d.request); else setErr(d?.error || "取得に失敗しました");
    } catch { setErr("取得に失敗しました"); } finally { setLoading(false); }
  }, [requestId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/me", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((d) => { if (d?.ok) setMe({ userId: String(d.user?.userId || ""), name: String(d.user?.name || "") }); }).catch(() => {}); }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [req?.messages?.length]);

  const send = async () => {
    const t = text.trim(); if (!t || !req) return;
    setBusy(true);
    try {
      const res = await fetch("/api/design/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", requestId, text: t }) });
      const d = await res.json();
      if (res.ok && d.ok) { setReq(d.request); setText(""); }
    } finally { setBusy(false); }
  };

  const transition = async (to: DesignStatus) => {
    if (!req) return;
    let comment = ""; let applyFrom: string | undefined;
    if (to === "差戻し") { comment = window.prompt("差戻し理由") || ""; if (!comment.trim()) return; }
    if (to === "承認済") { applyFrom = window.prompt("新仕様の適用開始日 (YYYY-MM-DD、任意)") || undefined; }
    setBusy(true);
    try {
      const res = await fetch("/api/design/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "transition", requestId, to, comment: comment || undefined, applyFrom }) });
      const d = await res.json();
      if (res.ok && d.ok) setReq(d.request); else alert(d?.error || "更新に失敗しました");
    } finally { setBusy(false); }
  };

  return (
    <div className="dq-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/design/specs" className="kb-back-link">← 変更依頼一覧</Link>
          <div style={{ fontWeight: 700 }}>{requestId}</div>
          <span style={{ width: 88 }} />
        </div>
      </div>

      {loading ? <div className="dq-muted">読み込み中…</div> : err ? <div className="dq-err">{err}</div> : req && (
        <div className="dq-grid">
          {/* 左: 依頼内容・進行・履歴 */}
          <aside className="dq-side">
            <div className="dq-side-head">
              <span className="dq-status" style={{ color: SC[req.status], background: `${SC[req.status]}15` }}>{req.status}</span>
              <div className="dq-scale-brand"><span>{req.category}</span><span>{req.brand}</span><span className={`dq-scale s-${req.scale}`}>{req.scale}</span></div>
            </div>
            <h1 className="dq-title">{req.title}</h1>
            {req.applyFrom && <div className="dq-apply">適用開始 {req.applyFrom}</div>}

            <div className="dq-stepper">
              {FLOW.map((s, i) => {
                const done = FLOW.indexOf(req.status) >= i && req.status !== "差戻し"; const now = req.status === s;
                return <div key={s} className={`dq-step${done ? " done" : ""}${now ? " now" : ""}`}><i /><span>{s}</span></div>;
              })}
            </div>

            <div className="dq-actions">
              {(NEXT[req.status] || []).length === 0 ? <span className="dq-muted-s">完了しています</span> :
                (NEXT[req.status] || []).map((to) => (
                  <button key={to} className={`dq-act${to === "差戻し" ? " danger" : ""}`} style={to !== "差戻し" ? { background: SC[to] } : undefined} disabled={busy} onClick={() => transition(to)}>
                    {to === "差戻し" ? "差戻し" : `${to}へ`}
                  </button>
                ))}
            </div>

            <div className="dq-sec"><div className="dq-sec-t">変更理由（なぜ）</div><p>{req.reason}</p></div>
            <div className="dq-sec"><div className="dq-sec-t">変更内容（何を）</div><p>{req.detail}</p></div>
            <div className="dq-sec"><div className="dq-sec-t">依頼者</div><p>{req.requestedByName}{req.requestedByDept ? `（${req.requestedByDept}）` : ""}・{fmt(req.createdAt)}</p></div>
            {req.attachments && req.attachments.length > 0 && (
              <div className="dq-sec"><div className="dq-sec-t">資料</div>{req.attachments.map((a, i) => <a key={i} href={a.url} target="_blank" rel="noreferrer" className="dq-att">📎 {a.name}</a>)}</div>
            )}
            <div className="dq-sec"><div className="dq-sec-t">ステータス履歴</div>
              {[...req.events].reverse().map((e, i) => (
                <div key={i} className="dq-ev"><i style={{ background: e.toStatus ? SC[e.toStatus] : "#cbd5e1" }} /><div><div className="dq-ev-t">{e.fromStatus ? `${e.fromStatus} → ` : ""}<b>{e.toStatus || e.action}</b></div><div className="dq-ev-m">{e.byUserName}・{fmt(e.at)}{e.comment ? `・${e.comment}` : ""}</div></div></div>
              ))}
            </div>
          </aside>

          {/* 右: 壁打ちチャット */}
          <section className="dq-chat">
            <div className="dq-chat-head">壁打ち（この依頼のやり取り）</div>
            <div className="dq-chat-body">
              {(!req.messages || req.messages.length === 0) && <div className="dq-chat-empty">まだメッセージはありません。運営・設計・本部でここでやり取りできます。</div>}
              {(req.messages || []).map((m) => {
                const mine = me && m.byUserId === me.userId;
                return (
                  <div key={m.id} className={`dq-msg${mine ? " mine" : ""}`}>
                    {!mine && <div className="dq-msg-who">{m.byUserName}{m.byDept ? `・${m.byDept}` : ""}</div>}
                    <div className="dq-bubble">{m.text}</div>
                    <div className="dq-msg-time">{fmt(m.at)}</div>
                  </div>
                );
              })}
              <div ref={chatEnd} />
            </div>
            <div className="dq-chat-input">
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="メッセージを入力（Enterで送信 / Shift+Enterで改行）" rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="dq-send" disabled={busy || !text.trim()} onClick={send}>送信</button>
            </div>
          </section>
        </div>
      )}

      <style jsx global>{`
        .dq-root { background: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .dq-muted, .dq-err { padding: 40px; text-align: center; color: #64748b; } .dq-err { color: #dc2626; }
        .dq-grid { max-width: 1200px; margin: 0 auto; padding: 20px 24px; display: grid; grid-template-columns: 400px 1fr; gap: 18px; align-items: start; }
        .dq-side { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; }
        .dq-side-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .dq-status { font-size: 12px; font-weight: 800; padding: 4px 12px; border-radius: 99px; }
        .dq-scale-brand { display: flex; gap: 6px; align-items: center; } .dq-scale-brand > span:not(.dq-scale) { font-size: 11px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 6px; font-weight: 700; }
        .dq-scale { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; } .dq-scale.s-微修正 { color: #475569; background: #f1f5f9; } .dq-scale.s-軽微 { color: #b45309; background: #fffbeb; } .dq-scale.s-大 { color: #b91c1c; background: #fef2f2; }
        .dq-title { font-size: 18px; font-weight: 800; margin: 4px 0 8px; }
        .dq-apply { display: inline-block; color: #059669; background: #ecfdf5; padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 800; margin-bottom: 12px; }
        .dq-stepper { display: flex; gap: 3px; margin: 14px 0; }
        .dq-step { flex: 1; text-align: center; } .dq-step i { display: block; height: 4px; border-radius: 2px; background: #e2e8f0; margin-bottom: 5px; } .dq-step span { font-size: 9px; color: #94a3b8; font-weight: 700; }
        .dq-step.done i { background: #93c5fd; } .dq-step.now i { background: #2563eb; } .dq-step.now span { color: #2563eb; }
        .dq-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
        .dq-act { border: none; color: #fff; font-size: 12px; font-weight: 800; padding: 7px 14px; border-radius: 8px; cursor: pointer; } .dq-act.danger { background: #fff; color: #dc2626; border: 1px solid #fecaca; } .dq-act:disabled { opacity: 0.5; }
        .dq-muted-s { font-size: 12px; color: #94a3b8; }
        .dq-sec { margin-top: 14px; padding-top: 14px; border-top: 1px solid #f1f5f9; } .dq-sec-t { font-size: 11px; font-weight: 800; color: #475569; margin-bottom: 6px; } .dq-sec p { margin: 0; font-size: 13px; color: #334155; line-height: 1.7; white-space: pre-wrap; }
        .dq-att { display: block; font-size: 12px; color: #2563eb; text-decoration: none; margin: 2px 0; }
        .dq-ev { display: flex; gap: 8px; margin-bottom: 8px; } .dq-ev i { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; } .dq-ev-t { font-size: 12px; color: #334155; } .dq-ev-m { font-size: 10.5px; color: #94a3b8; }
        .dq-chat { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; display: flex; flex-direction: column; height: calc(100vh - 100px); position: sticky; top: 80px; }
        .dq-chat-head { padding: 14px 20px; border-bottom: 1px solid #e2e8f0; font-weight: 800; font-size: 13px; color: #334155; }
        .dq-chat-body { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
        .dq-chat-empty { color: #94a3b8; font-size: 13px; text-align: center; margin: auto; }
        .dq-msg { max-width: 78%; align-self: flex-start; } .dq-msg.mine { align-self: flex-end; text-align: right; }
        .dq-msg-who { font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 3px; }
        .dq-bubble { display: inline-block; background: #f1f5f9; color: #0f172a; padding: 9px 13px; border-radius: 12px; font-size: 13px; line-height: 1.6; text-align: left; white-space: pre-wrap; word-break: break-word; }
        .dq-msg.mine .dq-bubble { background: #2563eb; color: #fff; }
        .dq-msg-time { font-size: 10px; color: #cbd5e1; margin-top: 3px; }
        .dq-chat-input { border-top: 1px solid #e2e8f0; padding: 12px 16px; display: flex; gap: 10px; align-items: flex-end; }
        .dq-chat-input textarea { flex: 1; resize: none; border: 1px solid #cbd5e1; border-radius: 10px; padding: 9px 12px; font-size: 13px; font-family: inherit; }
        .dq-send { border: none; background: #2563eb; color: #fff; font-weight: 800; font-size: 13px; padding: 10px 18px; border-radius: 10px; cursor: pointer; } .dq-send:disabled { opacity: 0.5; cursor: not-allowed; }
        @media (max-width: 860px) { .dq-grid { grid-template-columns: 1fr; } .dq-chat { height: 70vh; position: static; } }
      `}</style>
    </div>
  );
}
