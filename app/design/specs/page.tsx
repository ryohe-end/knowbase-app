"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type DesignChangeRequest, type DesignStatus,
  DESIGN_SCALES, DESIGN_CATEGORIES, DESIGN_BRANDS,
} from "@/types/designChange";

const STATUS_COLOR: Record<DesignStatus, string> = {
  "依頼": "#64748b", "検討中": "#d97706", "承認待ち": "#ea580c",
  "承認済": "#059669", "検証中": "#0891b2", "完了": "#334155", "差戻し": "#dc2626",
};
const FLOW: DesignStatus[] = ["依頼", "検討中", "承認待ち", "承認済", "検証中", "完了"];
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default function DesignSpecsPage() {
  const [list, setList] = useState<DesignChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusF, setStatusF] = useState("");
  const [toast, setToast] = useState<{ k: "ok" | "err"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // 新規依頼フォーム
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", category: "仕様書", brand: "共通", scale: "軽微", reason: "", detail: "", note: "", attUrl: "", attName: "" });
  const [atts, setAtts] = useState<{ name: string; url: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = statusF ? `?status=${encodeURIComponent(statusF)}` : "";
      const res = await fetch(`/api/design/requests${q}`, { cache: "no-store" });
      const d = await res.json();
      if (res.ok && d.ok) setList(d.requests || []);
    } finally { setLoading(false); }
  }, [statusF]);
  useEffect(() => { load(); }, [load]);

  const submitCreate = async () => {
    if (!form.title.trim() || !form.reason.trim() || !form.detail.trim()) { setToast({ k: "err", m: "対象・変更理由・変更内容は必須です" }); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/design/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", ...form, attachments: atts }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "登録失敗");
      setToast({ k: "ok", m: "変更依頼を登録しました" });
      setOpen(false); setForm({ title: "", category: "仕様書", brand: "共通", scale: "軽微", reason: "", detail: "", note: "", attUrl: "", attName: "" }); setAtts([]);
      await load();
    } catch (e: any) { setToast({ k: "err", m: e?.message || "登録に失敗しました" }); }
    finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of list) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [list]);

  return (
    <div className="kb-design-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/design" className="kb-back-link">← 設計業務トップ</Link>
          <div style={{ fontWeight: 700 }}>① 仕様書・標準図の整備</div>
          <button className="dz-new-btn" onClick={() => setOpen(true)}>＋ 変更依頼</button>
        </div>
      </div>

      <main className="kb-main-container">
        <header className="kb-page-header">
          <div className="kb-badge">DESIGN ①</div>
          <h1>仕様書・標準図の変更管理</h1>
          <p>変更依頼 → 検討 → 承認 → 周知 → 検証 → 完了 の進行と履歴を一元管理します。</p>
        </header>

        <div className="dz-filter">
          <button className={`dz-chip${statusF === "" ? " on" : ""}`} onClick={() => setStatusF("")}>すべて <span>{list.length}</span></button>
          {FLOW.concat("差戻し").map((s) => (
            <button key={s} className={`dz-chip${statusF === s ? " on" : ""}`} onClick={() => setStatusF(s)} style={statusF === s ? { borderColor: STATUS_COLOR[s as DesignStatus], color: STATUS_COLOR[s as DesignStatus] } : undefined}>
              {s} <span>{counts[s] || 0}</span>
            </button>
          ))}
        </div>

        {loading ? <div className="dz-muted">読み込み中…</div> : list.length === 0 ? (
          <div className="dz-empty">変更依頼はまだありません。右上の「＋ 変更依頼」から登録できます。</div>
        ) : (
          <div className="dz-table-wrap">
            <table className="dz-table">
              <thead><tr><th>状態</th><th>対象</th><th>区分/ブランド</th><th>規模</th><th>依頼者</th><th>更新</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.requestId} onClick={() => router.push(`/design/specs/${r.requestId}`)} className="dz-row">
                    <td><span className="dz-status" style={{ color: STATUS_COLOR[r.status], background: `${STATUS_COLOR[r.status]}15` }}>{r.status}</span></td>
                    <td className="dz-title">{r.title}<span className="dz-id">{r.requestId}</span></td>
                    <td className="dz-sub">{r.category} / {r.brand}</td>
                    <td><span className={`dz-scale s-${r.scale}`}>{r.scale}</span></td>
                    <td className="dz-sub">{r.requestedByName}</td>
                    <td className="dz-sub">{fmt(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>


      {/* 新規依頼フォーム */}
      {open && (
        <div className="dz-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="dz-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dz-drawer-head"><b>変更依頼を登録</b><button className="dz-x" onClick={() => setOpen(false)}>×</button></div>
            <div className="dz-drawer-body">
              <div className="dz-f"><label>対象（仕様書名・標準図名）<i>*</i></label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例) 受付カウンター標準図 / 更衣室仕様書" /></div>
              <div className="dz-f-row">
                <div className="dz-f"><label>区分</label><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{DESIGN_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                <div className="dz-f"><label>ブランド</label><select value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}>{DESIGN_BRANDS.map((b) => <option key={b}>{b}</option>)}</select></div>
                <div className="dz-f"><label>変更規模</label><select value={form.scale} onChange={(e) => setForm({ ...form, scale: e.target.value })}>{DESIGN_SCALES.map((s) => <option key={s}>{s}</option>)}</select></div>
              </div>
              <div className="dz-f"><label>変更理由（なぜ変えるか）<i>*</i></label><textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
              <div className="dz-f"><label>変更内容（何を変えるか）<i>*</i></label><textarea rows={3} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} /></div>
              <div className="dz-f"><label>資料リンク（任意 / Googleドライブ・SlidesのURL等）</label>
                <div className="dz-att-row">
                  <input value={form.attName} onChange={(e) => setForm({ ...form, attName: e.target.value })} placeholder="名称" style={{ maxWidth: 160 }} />
                  <input value={form.attUrl} onChange={(e) => setForm({ ...form, attUrl: e.target.value })} placeholder="https://..." />
                  <button type="button" className="dz-att-add" onClick={() => { if (form.attUrl.trim()) { setAtts([...atts, { name: form.attName.trim() || form.attUrl.trim(), url: form.attUrl.trim() }]); setForm({ ...form, attUrl: "", attName: "" }); } }}>追加</button>
                </div>
                {atts.map((a, i) => <div key={i} className="dz-att-chip">📎 {a.name} <button onClick={() => setAtts(atts.filter((_, j) => j !== i))}>×</button></div>)}
              </div>
            </div>
            <div className="dz-drawer-foot">
              <button className="dz-cancel" onClick={() => setOpen(false)} disabled={busy}>キャンセル</button>
              <button className="dz-act" style={{ background: "#2563eb" }} disabled={busy || !form.title || !form.reason || !form.detail} onClick={submitCreate}>{busy ? "登録中…" : "依頼を登録"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`dz-toast ${toast.k}`} onAnimationEnd={() => setToast(null)}>{toast.m}</div>}

      <style jsx global>{`
        .kb-design-root { background-color: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .kb-main-container { max-width: 1140px; margin: 0 auto; padding: 32px 24px 80px; }
        .kb-page-header { margin-bottom: 20px; }
        .kb-badge { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: #0f172a; background: #e2e8f0; padding: 4px 10px; border-radius: 4px; margin-bottom: 12px; }
        .kb-page-header h1 { font-size: 24px; font-weight: 800; margin: 0 0 6px 0; }
        .kb-page-header p { font-size: 13px; color: #64748b; margin: 0; }
        .dz-new-btn { border: none; background: #2563eb; color: #fff; font-size: 12px; font-weight: 800; padding: 8px 14px; border-radius: 8px; cursor: pointer; }
        .dz-filter { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
        .dz-chip { border: 1px solid #e2e8f0; background: #fff; color: #475569; font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 99px; cursor: pointer; }
        .dz-chip.on { border-color: #2563eb; color: #2563eb; }
        .dz-chip span { color: #94a3b8; font-weight: 800; margin-left: 4px; }
        .dz-muted { color: #64748b; font-size: 13px; padding: 20px; }
        .dz-empty { background: #fff; border: 1px dashed #cbd5e1; border-radius: 14px; padding: 40px; text-align: center; color: #64748b; font-size: 13px; }
        .dz-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
        .dz-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .dz-table th { background: #f8fafc; text-align: left; padding: 11px 14px; font-size: 11px; font-weight: 700; color: #64748b; border-bottom: 1px solid #e2e8f0; }
        .dz-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .dz-row { cursor: pointer; } .dz-row:hover { background: #f8fafc; }
        .dz-status { font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 99px; white-space: nowrap; }
        .dz-title { font-weight: 700; color: #1e293b; } .dz-id { margin-left: 8px; font-size: 10px; color: #94a3b8; font-family: monospace; }
        .dz-sub { color: #64748b; }
        .dz-scale { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; }
        .dz-scale.s-微修正 { color: #475569; background: #f1f5f9; } .dz-scale.s-軽微 { color: #b45309; background: #fffbeb; } .dz-scale.s-大 { color: #b91c1c; background: #fef2f2; }
        .dz-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.4); display: flex; justify-content: flex-end; z-index: 300; }
        .dz-drawer { width: 560px; max-width: 94vw; background: #fff; height: 100%; display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,0.1); }
        .dz-modal { width: 620px; max-width: 94vw; margin: auto; background: #fff; border-radius: 16px; max-height: 90vh; display: flex; flex-direction: column; }
        .dz-drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
        .dz-x { border: none; background: none; font-size: 22px; color: #94a3b8; cursor: pointer; line-height: 1; }
        .dz-drawer-body { padding: 20px; overflow-y: auto; flex: 1; }
        .dz-d-title { font-size: 18px; font-weight: 800; margin: 0 0 10px; }
        .dz-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; font-size: 12px; color: #64748b; align-items: center; }
        .dz-meta > span:not(.dz-scale):not(.dz-apply) { background: #f1f5f9; padding: 3px 10px; border-radius: 6px; font-weight: 700; }
        .dz-apply { color: #059669; background: #ecfdf5; padding: 3px 10px; border-radius: 6px; font-weight: 800; }
        .dz-stepper { display: flex; align-items: center; gap: 4px; margin-bottom: 20px; }
        .dz-step { flex: 1; text-align: center; } .dz-step i { display: block; height: 4px; border-radius: 2px; background: #e2e8f0; margin-bottom: 6px; } .dz-step span { font-size: 10px; color: #94a3b8; font-weight: 700; }
        .dz-step.done i { background: #93c5fd; } .dz-step.done span { color: #64748b; }
        .dz-step.now i { background: #2563eb; } .dz-step.now span { color: #2563eb; }
        .dz-sec { margin-bottom: 16px; } .dz-sec-t { font-size: 11px; font-weight: 800; color: #475569; margin-bottom: 6px; padding-left: 8px; border-left: 3px solid #cbd5e1; } .dz-sec p { margin: 0; font-size: 13px; color: #334155; line-height: 1.7; white-space: pre-wrap; }
        .dz-att { display: block; font-size: 12px; color: #2563eb; text-decoration: none; margin: 2px 0; } .dz-att:hover { text-decoration: underline; }
        .dz-timeline { display: flex; flex-direction: column; gap: 12px; }
        .dz-ev { display: flex; gap: 10px; } .dz-ev-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
        .dz-ev-t { font-size: 12.5px; color: #334155; } .dz-ev-m { font-size: 11px; color: #94a3b8; }
        .dz-drawer-foot { padding: 14px 20px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
        .dz-act { border: none; color: #fff; font-size: 12px; font-weight: 800; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
        .dz-act.danger { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
        .dz-act:disabled { opacity: 0.5; cursor: not-allowed; }
        .dz-cancel { border: 1px solid #e2e8f0; background: #fff; color: #64748b; font-size: 12px; font-weight: 700; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
        .dz-f { margin-bottom: 14px; } .dz-f label { display: block; font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 5px; } .dz-f label i { color: #ef4444; font-style: normal; margin-left: 3px; }
        .dz-f input, .dz-f select, .dz-f textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-family: inherit; }
        .dz-f-row { display: flex; gap: 10px; } .dz-f-row .dz-f { flex: 1; }
        .dz-att-row { display: flex; gap: 6px; } .dz-att-add { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 8px; padding: 0 12px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
        .dz-att-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; background: #f1f5f9; padding: 3px 8px; border-radius: 6px; margin: 6px 6px 0 0; } .dz-att-chip button { border: none; background: none; color: #94a3b8; cursor: pointer; }
        .dz-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); color: #fff; font-size: 13px; font-weight: 700; padding: 10px 20px; border-radius: 10px; z-index: 400; animation: dztoast 3s forwards; }
        .dz-toast.ok { background: #059669; } .dz-toast.err { background: #dc2626; }
        @keyframes dztoast { 0% { opacity: 0; transform: translate(-50%, 10px); } 10%, 80% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}
