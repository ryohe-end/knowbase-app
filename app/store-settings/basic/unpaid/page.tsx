"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, RefreshCw, AlertTriangle, Wallet, CheckCircle2, Users } from "lucide-react";

// ---- 型 ----
interface Club { clubCode: string; clubName: string; companyGroup?: string; businessType?: string }
interface MonthRow { month: string; unpaidCount: number; unpaidAmount: number; collectedCount: number; collectedAmount: number; writeoffCount: number; writeoffAmount: number }
interface Summary {
  unpaidCount: number; unpaidAmount: number;
  collectedCount: number; collectedAmount: number; collectionRate: number;
  writeoffCount: number; writeoffAmount: number;
  byMonth: MonthRow[];
}
interface Member {
  memberNo: string; memberName: string | null; kana: string | null;
  email: string | null; phone: string | null; plan: string | null;
  status: string; outstanding: number; unpaidCount: number; unpaidMonths: number;
  monthlyBreakdown: { month: string; amount: number }[];
  annualFeeTotal: number; hasSecurityFee: boolean;
}

const yen = (n: number) => "¥" + (n || 0).toLocaleString();

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function UnpaidManager() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [mode, setMode] = useState<"club" | "group" | "brand">("club");
  const [clubCode, setClubCode] = useState("");
  const [group, setGroup] = useState("");
  const [brand, setBrand] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [clubCount, setClubCount] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [bucket, setBucket] = useState<"current" | "writeoff">("current");
  const [tab, setTab] = useState<"dashboard" | "list" | "csv">("dashboard");
  const [loadingSum, setLoadingSum] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [err, setErr] = useState("");

  // クラブ辞書
  useEffect(() => {
    fetch("/api/clubs", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setClubs(d.clubs || []); })
      .catch(() => {});
  }, []);

  const groups = useMemo(() => [...new Set(clubs.map((c) => c.companyGroup).filter(Boolean))].sort() as string[], [clubs]);
  const brands = useMemo(() => [...new Set(clubs.map((c) => c.businessType).filter(Boolean))].sort() as string[], [clubs]);

  const filterQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (mode === "club" && clubCode) p.set("clubCode", clubCode);
    if (mode === "group" && group) p.set("group", group);
    if (mode === "brand" && brand) p.set("brand", brand);
    return p;
  }, [mode, clubCode, group, brand]);

  const hasSelection = (mode === "club" && !!clubCode) || (mode === "group" && !!group) || (mode === "brand" && !!brand);

  // ダッシュボード数値
  const loadSummary = useCallback(async () => {
    if (!hasSelection) { setSummary(null); return; }
    setLoadingSum(true); setErr("");
    try {
      const res = await fetch(`/api/store-settings/unpaid/summary?${filterQuery()}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "取得失敗");
      setSummary(d.summary || null);
      setClubCount(d.clubCount || 0);
    } catch (e: any) { setErr(e?.message || "エラー"); setSummary(null); }
    finally { setLoadingSum(false); }
  }, [filterQuery, hasSelection]);

  // 一覧 (店舗単位のみ)
  const loadList = useCallback(async () => {
    if (mode !== "club" || !clubCode) { setMembers([]); return; }
    setLoadingList(true);
    try {
      const res = await fetch(`/api/store-settings/unpaid/list?clubCode=${clubCode}&bucket=${bucket}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "取得失敗");
      setMembers(d.members || []);
    } catch (e: any) { setErr(e?.message || "エラー"); setMembers([]); }
    finally { setLoadingList(false); }
  }, [mode, clubCode, bucket]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { if (tab === "list" || tab === "csv") loadList(); }, [tab, loadList]);

  // CSV出力
  const downloadCsv = async () => {
    if (mode !== "club" || !clubCode) { alert("CSVは店舗を選択して出力してください"); return; }
    let rows = members;
    if (rows.length === 0) {
      const res = await fetch(`/api/store-settings/unpaid/list?clubCode=${clubCode}&bucket=${bucket}`, { cache: "no-store" });
      const d = await res.json();
      rows = d.members || [];
    }
    const header = ["会員区分", "ステータス", "会員番号", "名前", "未納金額", "1ヶ月目", "2ヶ月目", "3ヶ月目", "4ヶ月目以降", "電話番号", "メールアドレス", "セキュリティ費(年管理費)"];
    const lines = rows.map((m) => {
      const b = m.monthlyBreakdown || [];
      const m1 = b[0]?.amount ?? 0;
      const m2 = b[1]?.amount ?? 0;
      const m3 = b[2]?.amount ?? 0;
      const rest = b.slice(3).reduce((s, x) => s + x.amount, 0);
      return [
        m.plan ?? "", m.status, m.memberNo, m.memberName ?? "",
        m.outstanding, m1, m2, m3, rest,
        m.phone ?? "", m.email ?? "", m.annualFeeTotal,
      ].map(csvEscape).join(",");
    });
    const csv = "﻿" + [header.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = bucket === "writeoff" ? "貸倒予定" : "未納者";
    a.href = url; a.download = `${label}_${clubCode}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const clubName = clubs.find((c) => c.clubCode === clubCode)?.clubName;

  return (
    <div className="up-root">
      <header className="up-header">
        <div className="up-header-inner">
          <Link href="/store-settings" className="up-back"><ArrowLeft size={20} /></Link>
          <div>
            <h1 className="up-title">未納金管理</h1>
            <p className="up-sub">振替結果ベースの実データ（貸倒予定＝過去強制退会 は除外集計）</p>
          </div>
          <button className="up-reload" onClick={() => { loadSummary(); if (tab !== "dashboard") loadList(); }}>
            <RefreshCw size={14} /> 更新
          </button>
        </div>
      </header>

      <div className="up-body">
        {/* フィルタ */}
        <div className="up-filter">
          <div className="up-modes">
            {(["club", "group", "brand"] as const).map((mo) => (
              <button key={mo} className={`up-mode ${mode === mo ? "active" : ""}`} onClick={() => setMode(mo)}>
                {mo === "club" ? "店舗" : mo === "group" ? "エリア" : "ブランド"}
              </button>
            ))}
          </div>
          {mode === "club" && (
            <select className="up-select" value={clubCode} onChange={(e) => setClubCode(e.target.value)}>
              <option value="">店舗を選択…</option>
              {clubs.map((c) => <option key={c.clubCode} value={c.clubCode}>{c.clubCode} {c.clubName}</option>)}
            </select>
          )}
          {mode === "group" && (
            <select className="up-select" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">エリアを選択…</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          {mode === "brand" && (
            <select className="up-select" value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">ブランドを選択…</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {clubCount > 1 && <span className="up-badge">{clubCount}店舗 合算</span>}
        </div>

        {err && <div className="up-err"><AlertTriangle size={14} /> {err}</div>}
        {!hasSelection && <div className="up-empty">店舗・エリア・ブランドのいずれかを選択してください。</div>}

        {hasSelection && (
          <>
            {/* タブ */}
            <div className="up-tabs">
              <button className={`up-tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>ダッシュボード</button>
              <button className={`up-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>一覧</button>
              <button className={`up-tab ${tab === "csv" ? "active" : ""}`} onClick={() => setTab("csv")}>CSV出力</button>
            </div>

            {/* ダッシュボード */}
            {tab === "dashboard" && (
              <div className="up-dash">
                {loadingSum ? <div className="up-empty">読み込み中…</div> : summary ? (
                  <>
                    <div className="up-cards">
                      <Card icon={<Users size={18} />} label="未納件数" value={summary.unpaidCount.toLocaleString()} tone="red" />
                      <Card icon={<Wallet size={18} />} label="未納金額" value={yen(summary.unpaidAmount)} tone="red" />
                      <Card icon={<CheckCircle2 size={18} />} label="回収件数" value={summary.collectedCount.toLocaleString()} tone="green" />
                      <Card icon={<Wallet size={18} />} label="回収金額" value={yen(summary.collectedAmount)} tone="green" sub={`回収率 ${summary.collectionRate}%`} />
                      <Card icon={<AlertTriangle size={18} />} label="貸倒予定 件数" value={summary.writeoffCount.toLocaleString()} tone="amber" />
                      <Card icon={<AlertTriangle size={18} />} label="貸倒予定 金額" value={yen(summary.writeoffAmount)} tone="amber" />
                    </div>
                    <div className="up-panel">
                      <div className="up-panel-h">月次内訳（直近12ヶ月）</div>
                      <table className="up-table">
                        <thead><tr><th>振替年月</th><th>未納件数</th><th>未納金額</th><th>回収件数</th><th>回収金額</th><th>貸倒予定金額</th></tr></thead>
                        <tbody>
                          {[...summary.byMonth].reverse().map((r) => (
                            <tr key={r.month}>
                              <td>{r.month}</td>
                              <td>{r.unpaidCount.toLocaleString()}</td>
                              <td className="up-red">{yen(r.unpaidAmount)}</td>
                              <td>{r.collectedCount.toLocaleString()}</td>
                              <td className="up-green">{yen(r.collectedAmount)}</td>
                              <td className="up-amber">{yen(r.writeoffAmount)}</td>
                            </tr>
                          ))}
                          {summary.byMonth.length === 0 && <tr><td colSpan={6} className="up-muted">データがありません</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : <div className="up-empty">データがありません</div>}
              </div>
            )}

            {/* 一覧 / CSV */}
            {(tab === "list" || tab === "csv") && (
              <div className="up-list">
                <div className="up-list-bar">
                  <div className="up-bucket">
                    <button className={`up-bkt ${bucket === "current" ? "active" : ""}`} onClick={() => setBucket("current")}>未納者（貸倒予定を除く）</button>
                    <button className={`up-bkt ${bucket === "writeoff" ? "active" : ""}`} onClick={() => setBucket("writeoff")}>貸倒予定（強制退会）</button>
                  </div>
                  {mode === "club" ? (
                    <button className="up-csv-btn" onClick={downloadCsv}><Download size={15} /> CSV出力</button>
                  ) : <span className="up-muted">CSV/一覧は店舗モードで利用できます</span>}
                </div>

                {mode !== "club" ? (
                  <div className="up-empty">一覧・CSVは「店舗」を選択して表示してください（エリア/ブランドはダッシュボード合算のみ）。</div>
                ) : loadingList ? <div className="up-empty">読み込み中…</div> : (
                  <div className="up-panel">
                    <div className="up-panel-h">{clubName}（{members.length}名） {tab === "csv" && <span className="up-muted">— CSV出力ボタンで上記条件のCSVをダウンロード</span>}</div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="up-table">
                        <thead><tr><th>会員区分</th><th>ステータス</th><th>会員番号</th><th>名前</th><th>未納金額</th><th>月別内訳</th><th>電話</th><th>メール</th><th>ｾｷｭﾘﾃｨ費</th></tr></thead>
                        <tbody>
                          {members.map((m) => (
                            <tr key={m.memberNo}>
                              <td>{m.plan}</td>
                              <td><span className={`up-status ${m.status === "貸倒予定" ? "wo" : m.status.startsWith("1") ? "s1" : m.status.startsWith("2") ? "s2" : "sn"}`}>{m.status}</span></td>
                              <td><code>{m.memberNo}</code></td>
                              <td>{m.memberName}</td>
                              <td className="up-red">{yen(m.outstanding)}</td>
                              <td className="up-bd">{(m.monthlyBreakdown || []).slice(0, 4).map((x) => `${x.month}:${yen(x.amount)}`).join(" / ")}{(m.monthlyBreakdown?.length || 0) > 4 ? " …" : ""}</td>
                              <td>{m.phone}</td>
                              <td className="up-mail">{m.email}</td>
                              <td>{m.hasSecurityFee ? yen(m.annualFeeTotal) : "—"}</td>
                            </tr>
                          ))}
                          {members.length === 0 && <tr><td colSpan={9} className="up-muted">該当者がいません</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <style jsx global>{`
        .up-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .up-header { background: #fff; border-bottom: 2px solid #0ea5e9; position: sticky; top: 0; z-index: 40; }
        .up-header-inner { max-width: 1240px; margin: 0 auto; height: 68px; padding: 0 24px; display: flex; align-items: center; gap: 16px; }
        .up-back { color: #94a3b8; display: flex; } .up-back:hover { color: #0ea5e9; }
        .up-title { font-size: 18px; font-weight: 800; margin: 0; }
        .up-sub { font-size: 12px; color: #64748b; margin: 0; }
        .up-reload { margin-left: auto; display: flex; align-items: center; gap: 6px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .up-body { max-width: 1240px; margin: 0 auto; padding: 20px 24px 60px; }
        .up-filter { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; flex-wrap: wrap; }
        .up-modes { display: flex; gap: 4px; background: #f1f5f9; padding: 3px; border-radius: 8px; }
        .up-mode { border: none; background: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
        .up-mode.active { background: #fff; color: #0ea5e9; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
        .up-select { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-weight: 600; min-width: 260px; background: #fff; }
        .up-badge { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 20px; padding: 4px 12px; font-size: 11px; font-weight: 800; }
        .up-err { margin-top: 12px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .up-empty { margin-top: 16px; background: #fff; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; }
        .up-tabs { display: flex; gap: 4px; margin: 18px 0 14px; }
        .up-tab { background: #fff; border: 1px solid #e2e8f0; padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
        .up-tab.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
        .up-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 18px; }
        .up-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; }
        .up-card-top { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 12px; font-weight: 700; }
        .up-card-val { font-size: 24px; font-weight: 800; margin-top: 8px; }
        .up-card-sub { font-size: 12px; color: #64748b; font-weight: 700; margin-top: 2px; }
        .up-card.red .up-card-top, .up-card.red .up-card-val { color: #dc2626; }
        .up-card.green .up-card-top, .up-card.green .up-card-val { color: #059669; }
        .up-card.amber .up-card-top, .up-card.amber .up-card-val { color: #d97706; }
        .up-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
        .up-panel-h { padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 800; }
        .up-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .up-table th { background: #f8fafc; text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #64748b; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
        .up-table td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; white-space: nowrap; }
        .up-red { color: #dc2626; font-weight: 700; } .up-green { color: #059669; font-weight: 700; } .up-amber { color: #d97706; font-weight: 700; }
        .up-muted { color: #94a3b8; font-weight: 600; }
        .up-mail { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
        .up-bd { font-size: 11px; color: #475569; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
        .up-list-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .up-bucket { display: flex; gap: 4px; background: #f1f5f9; padding: 3px; border-radius: 8px; }
        .up-bkt { border: none; background: none; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; color: #64748b; cursor: pointer; }
        .up-bkt.active { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
        .up-csv-btn { margin-left: auto; display: flex; align-items: center; gap: 7px; background: #0f172a; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
        .up-csv-btn:hover { background: #1e293b; }
        .up-status { padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 800; }
        .up-status.s1 { background: #fef9c3; color: #a16207; }
        .up-status.s2 { background: #ffedd5; color: #c2410c; }
        .up-status.sn { background: #fee2e2; color: #b91c1c; }
        .up-status.wo { background: #e2e8f0; color: #475569; }
      `}</style>
    </div>
  );
}

function Card({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className={`up-card ${tone}`}>
      <div className="up-card-top">{icon} {label}</div>
      <div className="up-card-val">{value}</div>
      {sub && <div className="up-card-sub">{sub}</div>}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div style={{ padding: 40 }}>読み込み中…</div>}><UnpaidManager /></Suspense>;
}
