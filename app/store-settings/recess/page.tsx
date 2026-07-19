"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";

type MonthCount = { month: string; count: number };
type ClubCount = { clubCode: string; clubName: string; count: number };
type Member = { memberno: string; name: string; clubCode: string; clubName: string; brand: string; tempFlag: boolean; appliedAt: string | null };

const fmtMonth = (m: string) => (/^\d{6}$/.test(m) ? `${m.slice(0, 4)}/${m.slice(4, 6)}` : m);
const fmtDt = (s: string | null) => (s ? new Date(s).toLocaleString("ja-JP", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-");

export default function RecessPage() {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [months, setMonths] = useState<MonthCount[]>([]);
  const [byBrand, setByBrand] = useState<Record<string, number>>({});
  const [byClub, setByClub] = useState<ClubCount[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [month, setMonth] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [search, setSearch] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/store-settings/recess", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "取得に失敗しました");
      setReady(d.ready !== false);
      setMonths(d.months || []); setByBrand(d.byBrand || {}); setByClub(d.byClub || []); setUpdatedAt(d.updatedAt || null);
      const latest = (d.months || []).slice(-1)[0]?.month || (d.months || [])[0]?.month || "";
      if (latest) setMonth(latest);
    } catch (e: any) { setError(e?.message || "取得に失敗しました"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const loadMonth = useCallback(async (m: string) => {
    if (!m) return;
    setListLoading(true);
    try {
      const res = await fetch(`/api/store-settings/recess?month=${m}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "取得に失敗しました");
      setMembers(d.members || []);
    } catch (e: any) { setError(e?.message || "取得に失敗しました"); }
    finally { setListLoading(false); }
  }, []);
  useEffect(() => { if (month) loadMonth(month); }, [month, loadMonth]);

  const maxMonth = useMemo(() => Math.max(1, ...months.map((m) => m.count)), [months]);
  const totalMemberMonths = useMemo(() => months.reduce((a, m) => a + m.count, 0), [months]);
  const filtered = useMemo(() => {
    const q = search.trim();
    return members.filter((m) => !q || m.name.includes(q) || m.memberno.includes(q) || m.clubName.includes(q));
  }, [members, search]);

  return (
    <div className="rc-root">
      <AdminLoadingOverlay visible={loading} text="休会データを読み込み中..." />
      <header className="rc-header">
        <div className="rc-header-inner">
          <Link href="/store-settings" className="rc-back">← メニューへ戻る</Link>
          <h1>休会申請 一覧・分析</h1>
          <span className="rc-src">更新: {fmtDt(updatedAt)}</span>
        </div>
      </header>

      <main className="rc-main">
        {error && <div className="rc-error">{error}</div>}
        {!ready && !loading && (
          <div className="rc-notready">休会ロスターがまだ集計されていません（夜間バッチ `knowbie-recess-roster` の初回実行待ち）。</div>
        )}

        {/* 分析: サマリー + 月別推移 */}
        <section className="rc-cards">
          <div className="rc-card"><div className="rc-card-label">休会（延べ 月×人）</div><div className="rc-card-value">{totalMemberMonths.toLocaleString("ja-JP")}</div></div>
          <div className="rc-card"><div className="rc-card-label">対象月数</div><div className="rc-card-value">{months.length}</div></div>
          <div className="rc-card"><div className="rc-card-label">FIT365 / JOYFIT</div><div className="rc-card-value sm">{(byBrand.FIT365 || 0).toLocaleString("ja-JP")} / {(byBrand.JOYFIT || 0).toLocaleString("ja-JP")}</div></div>
        </section>

        <section className="rc-panel">
          <div className="rc-panel-title">月別 休会件数</div>
          <div className="rc-bars">
            {months.map((m) => (
              <button key={m.month} className={`rc-bar ${month === m.month ? "on" : ""}`} onClick={() => setMonth(m.month)} title={`${fmtMonth(m.month)}: ${m.count}件`}>
                <span className="rc-bar-fill" style={{ height: `${Math.round((m.count / maxMonth) * 100)}%` }} />
                <span className="rc-bar-cnt">{m.count}</span>
                <span className="rc-bar-lbl">{fmtMonth(m.month)}</span>
              </button>
            ))}
            {months.length === 0 && <div className="rc-empty">データなし</div>}
          </div>
        </section>

        <div className="rc-grid">
          {/* 月別一覧 */}
          <section className="rc-panel">
            <div className="rc-panel-title">
              {fmtMonth(month)} の休会者 <span className="rc-badge">{filtered.length}人</span>
              <input className="rc-search" placeholder="氏名・会員番号・店舗" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="rc-table-wrap">
              <table className="rc-table">
                <thead><tr><th>会員番号</th><th>氏名</th><th>店舗</th><th>ブランド</th><th>申請日時</th></tr></thead>
                <tbody>
                  {filtered.map((m, i) => (
                    <tr key={`${m.memberno}-${i}`}>
                      <td><code className="rc-code">{m.memberno}</code></td>
                      <td>{m.name || "—"}{m.tempFlag && <span className="rc-temp">仮</span>}</td>
                      <td>{m.clubName || m.clubCode}</td>
                      <td><span className={`rc-brand ${m.brand === "JOYFIT" ? "j" : "f"}`}>{m.brand}</span></td>
                      <td className="rc-nowrap">{fmtDt(m.appliedAt)}</td>
                    </tr>
                  ))}
                  {!listLoading && filtered.length === 0 && <tr><td colSpan={5} className="rc-empty">該当なし</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* 店舗別ランキング */}
          <section className="rc-panel">
            <div className="rc-panel-title">店舗別 休会（全期間・上位）</div>
            <div className="rc-table-wrap">
              <table className="rc-table">
                <thead><tr><th>店舗</th><th className="r">件数</th></tr></thead>
                <tbody>
                  {byClub.map((c) => (
                    <tr key={c.clubCode}><td>{c.clubName}<code className="rc-code">{c.clubCode}</code></td><td className="r">{c.count}</td></tr>
                  ))}
                  {byClub.length === 0 && <tr><td colSpan={2} className="rc-empty">データなし</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <p className="rc-note">※ 休会マスタは外部API管理のため、DBの休会API参照ログ(rw='a')から「現在の休会状態」を夜間集計しています。申請日時はFIT365(申請ログ)のみ付与されます。件数は「対象月×会員」の延べです。</p>
      </main>

      <style jsx global>{`
        .rc-root { background: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; }
        .rc-header { background: #fff; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 50; }
        .rc-header-inner { max-width: 1200px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 16px; }
        .rc-back { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .rc-header h1 { font-size: 18px; font-weight: 800; margin: 0; }
        .rc-src { margin-left: auto; font-size: 11px; color: #94a3b8; }
        .rc-main { max-width: 1200px; margin: 0 auto; padding: 20px 24px; }
        .rc-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; font-size: 13px; }
        .rc-notready { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; padding: 14px; margin-bottom: 16px; font-size: 13px; }
        .rc-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
        .rc-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; }
        .rc-card-label { font-size: 11px; font-weight: 700; color: #94a3b8; }
        .rc-card-value { font-size: 26px; font-weight: 800; margin-top: 6px; }
        .rc-card-value.sm { font-size: 20px; }
        .rc-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
        .rc-panel-title { font-size: 13px; font-weight: 800; color: #1e293b; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
        .rc-badge { font-size: 11px; font-weight: 800; color: #6d28d9; background: #f5f3ff; border-radius: 99px; padding: 2px 10px; }
        .rc-search { margin-left: auto; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; width: 220px; }
        .rc-bars { display: flex; align-items: flex-end; gap: 8px; height: 160px; overflow-x: auto; padding-top: 8px; }
        .rc-bar { flex: 0 0 60px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; background: none; border: none; cursor: pointer; position: relative; }
        .rc-bar-fill { width: 60%; background: linear-gradient(#a78bfa, #7c3aed); border-radius: 4px 4px 0 0; min-height: 3px; transition: 0.2s; }
        .rc-bar.on .rc-bar-fill { background: linear-gradient(#f59e0b, #d97706); }
        .rc-bar-cnt { font-size: 12px; font-weight: 800; color: #334155; }
        .rc-bar-lbl { font-size: 10px; color: #64748b; }
        .rc-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; }
        @media (max-width: 900px) { .rc-grid { grid-template-columns: 1fr; } .rc-cards { grid-template-columns: 1fr 1fr; } }
        .rc-table-wrap { overflow: auto; max-height: 60vh; }
        .rc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .rc-table th { position: sticky; top: 0; text-align: left; padding: 9px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 800; color: #64748b; white-space: nowrap; }
        .rc-table td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; }
        .rc-table th.r, .rc-table td.r { text-align: right; }
        .rc-nowrap { white-space: nowrap; }
        .rc-code { font-family: monospace; font-size: 11px; color: #64748b; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
        .rc-brand { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 99px; }
        .rc-brand.f { color: #be185d; background: #fce7f3; } .rc-brand.j { color: #1d4ed8; background: #dbeafe; }
        .rc-temp { font-size: 10px; font-weight: 800; color: #b45309; background: #fef3c7; border-radius: 4px; padding: 1px 6px; margin-left: 6px; }
        .rc-empty { text-align: center; color: #94a3b8; padding: 22px; }
        .rc-note { font-size: 11px; color: #94a3b8; margin-top: 12px; line-height: 1.6; }
      `}</style>
    </div>
  );
}
