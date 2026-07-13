"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download, RefreshCw, AlertTriangle, Wallet, CheckCircle2, Users, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, PieChart, Pie,
} from "recharts";
import { UNPAID_AREAS } from "@/lib/unpaidAreaMap";

// ---- 型 ----
interface Club { clubCode: string; clubName: string; companyGroup?: string; businessType?: string }
interface MonthRow { month: string; billedCount: number; billedAmount: number; unpaidCount: number; unpaidAmount: number; collectedCount: number; collectedAmount: number; recoveredAmount?: number; stillUnpaidAmount?: number }
interface MonthDetailMember { memberNo: string; name: string; phone: string; email: string; unpaidAmount: number; recoveredAmount: number }
interface FollowupBucket { kubun: number; label: string; count: number; billedAmount: number; paidAmount: number; amount: number }
interface Followup {
  paid: FollowupBucket; unpaid: FollowupBucket; writeoff: FollowupBucket;
  cancelled: FollowupBucket; noObligation: FollowupBucket; notBilled: FollowupBucket; pending: FollowupBucket;
}
interface Summary {
  billedCount: number; billedAmount: number;
  unpaidCount: number; unpaidAmount: number;
  collectedCount: number; collectedAmount: number; collectionRate: number;
  byMonth: MonthRow[];
  followup?: Followup; // ②未納(初回振替失敗)のその後
}
interface Member {
  memberNo: string; memberName: string | null; kana: string | null;
  email: string | null; phone: string | null; plan: string | null;
  status: string; outstanding: number; unpaidCount: number; unpaidMonths: number;
  monthlyBreakdown: { month: string; amount: number }[];
  annualFeeTotal: number; hasSecurityFee: boolean;
}
interface Schedule {
  totalAmount: number; totalCount: number;
  byFiscalYear: { fiscalYear: number; label: string; amount: number; count: number }[];
  byMonth: { month: string; amount: number; count: number }[];
}

const yen = (n: number) => "¥" + (n || 0).toLocaleString();
// カード用コンパクト表示 (億/万まで)。枠からのはみ出し防止。
const yenC = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e8) return "¥" + (v / 1e8).toFixed(2).replace(/\.?0+$/, "") + "億";
  if (Math.abs(v) >= 1e4) return "¥" + (v / 1e4).toFixed(1).replace(/\.0$/, "") + "万";
  return "¥" + v.toLocaleString();
};
// 年度(4月始まり)。ym(YYYYMM) の年度と、年度→期間(YYYYMM)。
const currentFiscalYear = () => {
  const d = new Date();
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
};
const fyRange = (fy: number) => ({ fromYm: `${fy}04`, toYm: `${fy + 1}03` });

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function UnpaidManager() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [mode, setMode] = useState<"club" | "area" | "brand">("club");
  const [clubCode, setClubCode] = useState("");
  const [area, setArea] = useState("");        // エリア(課別人員表 セクション4)
  const [territory, setTerritory] = useState(""); // テリトリー(セクション5)
  const [brand, setBrand] = useState("");
  const [fiscalYear, setFiscalYear] = useState<number>(currentFiscalYear()); // 年度(4月始まり)
  const [summary, setSummary] = useState<Summary | null>(null);
  const [clubCount, setClubCount] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [bucket, setBucket] = useState<"current" | "writeoff">("current");
  const [statusFilter, setStatusFilter] = useState<"all" | "1" | "2" | "3plus">("all");
  const [tab, setTab] = useState<"dashboard" | "list" | "csv" | "schedule">("dashboard");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loadingSum, setLoadingSum] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingSched, setLoadingSched] = useState(false);
  const [err, setErr] = useState("");
  const [monthDetail, setMonthDetail] = useState<{ ym: string; unpaid: MonthDetailMember[]; recovered: MonthDetailMember[] } | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const searchParams = useSearchParams();

  // 基本設定で選択したクラブを引き継ぐ (URL ?clubCode=)。再選択不要にする。
  useEffect(() => {
    const c = searchParams.get("clubCode");
    if (c) { setMode("club"); setClubCode(c); }
  }, [searchParams]);

  // クラブ辞書
  useEffect(() => {
    fetch("/api/clubs", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setClubs(d.clubs || []); })
      .catch(() => {});
  }, []);

  const brands = useMemo(() => [...new Set(clubs.map((c) => c.businessType).filter(Boolean))].sort() as string[], [clubs]);

  // 選択エリア/テリトリーから対象クラブコードを解決 (スコープはサーバ側で交差)
  const selectedAreaDef = useMemo(() => UNPAID_AREAS.find((a) => a.area === area) ?? null, [area]);
  const territoriesOfArea = selectedAreaDef?.territories ?? [];
  const areaClubCodes = useMemo(() => {
    if (!selectedAreaDef) return [];
    if (territory) return selectedAreaDef.territories.find((t) => t.territory === territory)?.clubCodes ?? [];
    return selectedAreaDef.clubCodes;
  }, [selectedAreaDef, territory]);

  const filterQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (mode === "club" && clubCode) p.set("clubCode", clubCode);
    if (mode === "area" && areaClubCodes.length > 0) p.set("clubCodes", areaClubCodes.join(","));
    if (mode === "brand" && brand) p.set("brand", brand);
    const { fromYm, toYm } = fyRange(fiscalYear);
    p.set("fromYm", fromYm); p.set("toYm", toYm); // 年度(4月始まり)で期間指定
    return p;
  }, [mode, clubCode, areaClubCodes, brand, fiscalYear]);

  const hasSelection = (mode === "club" && !!clubCode) || (mode === "area" && areaClubCodes.length > 0) || (mode === "brand" && !!brand);

  // 月次ドリルダウン (未納者/回収者)
  const openMonthDetail = async (month: string) => {
    const ym = month.replace("-", "");
    setMonthDetail({ ym: month, unpaid: [], recovered: [] });
    setMonthLoading(true);
    try {
      const q = filterQuery(); q.set("ym", ym);
      const res = await fetch(`/api/store-settings/unpaid/month-detail?${q}`, { cache: "no-store" });
      const d = await res.json();
      if (d.ok) setMonthDetail({ ym: month, unpaid: d.unpaid || [], recovered: d.recovered || [] });
    } catch { /* noop */ } finally { setMonthLoading(false); }
  };

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

  // 対象クラブコード群 (店舗/エリア/ブランド)
  const listClubCodes = useMemo(() => {
    if (mode === "club") return clubCode ? [clubCode] : [];
    if (mode === "area") return areaClubCodes;
    if (mode === "brand" && brand) return clubs.filter((c) => c.businessType === brand).map((c) => c.clubCode);
    return [];
  }, [mode, clubCode, areaClubCodes, brand, clubs]);

  // 一覧 (店舗/エリア/ブランド)
  const loadList = useCallback(async () => {
    if (listClubCodes.length === 0) { setMembers([]); return; }
    setLoadingList(true);
    try {
      const res = await fetch(`/api/store-settings/unpaid/list?clubCodes=${listClubCodes.join(",")}&bucket=${bucket}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "取得失敗");
      setMembers(d.members || []);
    } catch (e: any) { setErr(e?.message || "エラー"); setMembers([]); }
    finally { setLoadingList(false); }
  }, [listClubCodes, bucket]);

  // 貸倒償却予定
  const loadSchedule = useCallback(async () => {
    if (!hasSelection) { setSchedule(null); return; }
    setLoadingSched(true);
    try {
      const res = await fetch(`/api/store-settings/unpaid/writeoff-schedule?${filterQuery()}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "取得失敗");
      setSchedule(d.schedule || null);
    } catch (e: any) { setErr(e?.message || "エラー"); setSchedule(null); }
    finally { setLoadingSched(false); }
  }, [filterQuery, hasSelection]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { if (tab === "list" || tab === "csv") loadList(); }, [tab, loadList]);
  useEffect(() => { if (tab === "schedule") loadSchedule(); }, [tab, loadSchedule]);

  // CSV出力 (店舗 / エリア / ブランド)。列順: 会員番号, 名前, 未納金額, 電話番号, メールアドレス …
  const downloadCsv = async () => {
    let codes: string[] = [];
    let tag = "";
    if (mode === "club" && clubCode) { codes = [clubCode]; tag = clubCode; }
    else if (mode === "area" && areaClubCodes.length > 0) { codes = areaClubCodes; tag = (territory || area).replace(/\s/g, ""); }
    else if (mode === "brand" && brand) { codes = clubs.filter((c) => c.businessType === brand).map((c) => c.clubCode); tag = brand; }
    if (codes.length === 0) { alert("店舗・エリア・ブランドのいずれかを選択してください"); return; }
    const res = await fetch(`/api/store-settings/unpaid/list?clubCodes=${codes.join(",")}&bucket=${bucket}`, { cache: "no-store" });
    const d = await res.json();
    let rows: Member[] = d.members || [];
    if (bucket === "current" && statusFilter !== "all") rows = rows.filter((m) => statusCat(m.status) === statusFilter);
    const header = ["会員番号", "名前", "未納金額", "電話番号", "メールアドレス", "会員区分", "ステータス", "セキュリティ費(年管理費)"];
    const lines = rows.map((m) => [
      m.memberNo, m.memberName ?? "", m.outstanding, m.phone ?? "", m.email ?? "",
      m.plan ?? "", m.status, m.annualFeeTotal,
    ].map(csvEscape).join(","));
    const csv = "﻿" + [header.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = bucket === "writeoff" ? "貸倒予定" : "未納者";
    a.href = url; a.download = `${label}_${tag}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const clubName = clubs.find((c) => c.clubCode === clubCode)?.clubName;

  // ステータス分類 (Nか月目 → 1/2/3plus)。SMS文面の出し分け用。
  const statusCat = (status: string): "1" | "2" | "3plus" | "wo" => {
    if (status === "貸倒予定") return "wo";
    const n = parseInt(status, 10);
    return n === 1 ? "1" : n === 2 ? "2" : "3plus";
  };
  const statusCounts = useMemo(() => {
    const c = { all: members.length, "1": 0, "2": 0, "3plus": 0 } as Record<string, number>;
    for (const m of members) { const k = statusCat(m.status); if (k !== "wo") c[k]++; }
    return c;
  }, [members]);
  const filteredMembers = useMemo(
    () => (bucket === "writeoff" || statusFilter === "all" ? members : members.filter((m) => statusCat(m.status) === statusFilter)),
    [members, statusFilter, bucket]
  );

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
            {(["club", "area", "brand"] as const).map((mo) => (
              <button key={mo} className={`up-mode ${mode === mo ? "active" : ""}`} onClick={() => setMode(mo)}>
                {mo === "club" ? "店舗" : mo === "area" ? "エリア" : "ブランド"}
              </button>
            ))}
          </div>
          {mode === "club" && (
            <select className="up-select" value={clubCode} onChange={(e) => setClubCode(e.target.value)}>
              <option value="">店舗を選択…</option>
              {clubCode && !clubs.some((c) => c.clubCode === clubCode) && <option value={clubCode}>{clubCode}</option>}
              {clubs.map((c) => <option key={c.clubCode} value={c.clubCode}>{c.clubCode} {c.clubName}</option>)}
            </select>
          )}
          {mode === "area" && (
            <>
              <select className="up-select" value={area} onChange={(e) => { setArea(e.target.value); setTerritory(""); }}>
                <option value="">エリアを選択…</option>
                {UNPAID_AREAS.map((a) => <option key={a.area} value={a.area}>{a.area}（{a.clubCodes.length}店）</option>)}
              </select>
              <select className="up-select" value={territory} onChange={(e) => setTerritory(e.target.value)} disabled={!selectedAreaDef}>
                <option value="">テリトリー：すべて</option>
                {territoriesOfArea.map((t) => <option key={t.territory} value={t.territory}>{t.territory}（{t.clubCodes.length}店）</option>)}
              </select>
            </>
          )}
          {mode === "brand" && (
            <select className="up-select" value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">ブランドを選択…</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <select className="up-select" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} title="年度(4月〜翌3月)">
            {Array.from({ length: currentFiscalYear() - 2025 + 1 }, (_, i) => currentFiscalYear() - i).map((fy) => (
              <option key={fy} value={fy}>{fy}年度（{fy}/4〜{fy + 1}/3）</option>
            ))}
          </select>
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
              <button className={`up-tab ${tab === "schedule" ? "active" : ""}`} onClick={() => setTab("schedule")}>貸倒償却予定</button>
            </div>

            {/* ダッシュボード */}
            {tab === "dashboard" && (
              <div className="up-dash">
                {loadingSum ? <div className="up-empty">読み込み中…</div> : summary ? (
                  <>
                    <div className="up-section-h">① 初回振替の結果<span>振替系テーブル（振替契約別）／件数は契約者SEQ単位</span></div>
                    <div className="up-cards">
                      <Card icon={<Users size={18} />} label="請求件数" value={summary.billedCount.toLocaleString()} tone="blue" sub="契約者SEQ単位" />
                      <Card icon={<Wallet size={18} />} label="請求金額" value={yenC(summary.billedAmount)} tone="blue" sub={yen(summary.billedAmount)} />
                      <Card icon={<CheckCircle2 size={18} />} label="振替成功（回収）件数" value={summary.collectedCount.toLocaleString()} tone="green" sub="契約者SEQ単位" />
                      <Card icon={<Wallet size={18} />} label="振替成功（回収）金額" value={yenC(summary.collectedAmount)} tone="green" sub={`振替成功率 ${summary.collectionRate}%`} />
                      <Card icon={<Users size={18} />} label="振替不成立（未納）件数" value={summary.unpaidCount.toLocaleString()} tone="red" sub="契約者SEQ単位" />
                      <Card icon={<Wallet size={18} />} label="振替不成立（未納）金額" value={yenC(summary.unpaidAmount)} tone="red" sub={yen(summary.unpaidAmount)} />
                    </div>

                    {summary.followup && (() => {
                      const fu = summary.followup!;
                      const rows = [
                        { ...fu.paid, tone: "green" as const, note: "初回振替失敗後に回収できた" },
                        { ...fu.unpaid, tone: "red" as const, note: "現在も未回収（現行未納）" },
                        { ...fu.pending, tone: "blue" as const, note: "入金歴なし（処理待ち）" },
                        { ...fu.writeoff, tone: "amber" as const, note: "貸倒れ処理済" },
                        { ...fu.cancelled, tone: "gray" as const, note: "売上取消" },
                      ].filter((r) => r.count > 0 || r.amount !== 0);
                      const totalCnt = rows.reduce((s, r) => s + r.count, 0) || 1;
                      return (
                        <>
                          <div className="up-section-h" style={{ marginTop: 22 }}>② 未納になった人のその後<span>入金系テーブル（会員入金歴・入金区分コード）</span></div>
                          <div className="up-panel">
                            <table className="up-table">
                              <thead><tr><th>入金区分</th><th>内容</th><th>件数（契約者SEQ）</th><th>金額</th><th>構成比</th></tr></thead>
                              <tbody>
                                {rows.map((r) => (
                                  <tr key={r.kubun}>
                                    <td><span className={`up-pill ${r.tone}`}>{r.label}</span></td>
                                    <td className="up-muted2">{r.note}</td>
                                    <td>{r.count.toLocaleString()}名</td>
                                    <td className={r.tone === "red" ? "up-red" : r.tone === "green" ? "up-green" : ""}>{yen(r.amount)}</td>
                                    <td>{Math.round((r.count / totalCnt) * 100)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      );
                    })()}

                    <div className="up-section-h" style={{ marginTop: 22 }}>推移・内訳</div>
                    <div className="up-charts">
                      <div className="up-panel">
                        <div className="up-panel-h"><TrendingUp size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />請求 / 回収 / 未納 推移と回収率（{fiscalYear}年度）</div>
                        <div style={{ padding: "14px 10px 6px" }}>
                          <ResponsiveContainer width="100%" height={260}>
                            <ComposedChart data={summary.byMonth.map((m) => ({
                              month: m.month.slice(2),
                              請求: m.billedAmount, 回収: m.collectedAmount, 未納: m.unpaidAmount,
                              回収率: m.collectedAmount + m.unpaidAmount > 0 ? Math.round((m.collectedAmount / (m.collectedAmount + m.unpaidAmount)) * 100) : 0,
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis dataKey="month" fontSize={11} />
                              <YAxis yAxisId="l" fontSize={10} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
                              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} fontSize={10} tickFormatter={(v) => `${v}%`} />
                              <Tooltip formatter={(v: any, n: any) => (n === "回収率" ? `${v}%` : `¥${Number(v).toLocaleString()}`)} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                              <Bar yAxisId="l" dataKey="請求" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                              <Bar yAxisId="l" dataKey="回収" fill="#34d399" radius={[3, 3, 0, 0]} />
                              <Bar yAxisId="l" dataKey="未納" fill="#f87171" radius={[3, 3, 0, 0]} />
                              <Line yAxisId="r" dataKey="回収率" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2 }} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className="up-panel">
                        <div className="up-panel-h">請求金額の内訳（回収 / 未納）</div>
                        <div style={{ padding: 10 }}>
                          <ResponsiveContainer width="100%" height={230}>
                            <PieChart>
                              <Pie
                                data={[
                                  { name: "回収", value: summary.collectedAmount },
                                  { name: "未納", value: summary.unpaidAmount },
                                ]}
                                dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}
                              >
                                <Cell fill="#34d399" />
                                <Cell fill="#f87171" />
                              </Pie>
                              <Tooltip formatter={(v: any) => `¥${Number(v).toLocaleString()}`} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                    <div className="up-panel">
                      <div className="up-panel-h">月次内訳（{fiscalYear}年度）　<span style={{ fontWeight: 600, color: "#94a3b8", fontSize: 11 }}>行をクリックで未納者・回収者を表示</span></div>
                      <table className="up-table">
                        <thead><tr><th>振替年月</th><th>請求金額</th><th>回収金額</th><th>未納（初回不成立）</th><th>うち後日回収</th><th>現未納</th><th></th></tr></thead>
                        <tbody>
                          {[...summary.byMonth].reverse().map((r) => (
                            <tr key={r.month} className="up-row-click" onClick={() => openMonthDetail(r.month)}>
                              <td>{r.month}</td>
                              <td className="up-blue">{yen(r.billedAmount)}</td>
                              <td className="up-green">{yen(r.collectedAmount)}</td>
                              <td className="up-red">{yen(r.unpaidAmount)}</td>
                              <td className="up-green">{yen(r.recoveredAmount || 0)}</td>
                              <td className="up-red">{yen(r.stillUnpaidAmount || 0)}</td>
                              <td style={{ color: "#94a3b8" }}>›</td>
                            </tr>
                          ))}
                          {summary.byMonth.length === 0 && <tr><td colSpan={7} className="up-muted">データがありません</td></tr>}
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
                    <button className="up-csv-btn" onClick={downloadCsv}><Download size={15} /> CSV出力{bucket === "current" && statusFilter !== "all" ? `（${statusFilter === "3plus" ? "3か月目以上" : statusFilter + "か月目"}）` : ""}</button>
                  ) : <span className="up-muted">CSV/一覧は店舗モードで利用できます</span>}
                </div>

                {mode === "club" && bucket === "current" && (
                  <div className="up-statusfilter">
                    <span className="up-sf-label">ステータス:</span>
                    {([["all", "全て"], ["1", "1か月目"], ["2", "2か月目"], ["3plus", "3か月目以上"]] as const).map(([k, lbl]) => (
                      <button key={k} className={`up-sf ${statusFilter === k ? "active" : ""}`} onClick={() => setStatusFilter(k)}>
                        {lbl} <b>{statusCounts[k] ?? 0}</b>
                      </button>
                    ))}
                    <span className="up-muted" style={{ marginLeft: "auto", fontSize: 11 }}>SMS文面をステータス別に出し分けるための絞り込み</span>
                  </div>
                )}

                {listClubCodes.length === 0 ? (
                  <div className="up-empty">店舗・エリア・ブランドのいずれかを選択してください。</div>
                ) : loadingList ? <div className="up-empty">読み込み中…</div> : (
                  <div className="up-panel">
                    <div className="up-panel-h">{mode === "club" ? clubName : mode === "area" ? (territory || area) : brand}（{filteredMembers.length}名{filteredMembers.length !== members.length ? ` / 全${members.length}名` : ""} ／ {listClubCodes.length}店舗） {tab === "csv" && <span className="up-muted">— CSV出力ボタンで上記条件のCSVをダウンロード</span>}</div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="up-table">
                        <thead><tr><th>会員区分</th><th>ステータス</th><th>会員番号</th><th>名前</th><th>未納金額</th><th>月別内訳</th><th>電話</th><th>メール</th><th>ｾｷｭﾘﾃｨ費</th></tr></thead>
                        <tbody>
                          {filteredMembers.map((m) => (
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
                          {filteredMembers.length === 0 && <tr><td colSpan={9} className="up-muted">該当者がいません</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 貸倒償却予定 */}
            {tab === "schedule" && (
              <div className="up-sched">
                {loadingSched ? <div className="up-empty">読み込み中…</div> : schedule ? (
                  <>
                    <div className="up-cards">
                      <Card icon={<AlertTriangle size={18} />} label="貸倒償却予定 総額" value={yen(schedule.totalAmount)} tone="amber" sub={`${schedule.totalCount.toLocaleString()}件`} />
                    </div>
                    <div className="up-panel" style={{ marginBottom: 16 }}>
                      <div className="up-panel-h">年度別 償却予定額（償却予定＝振替年月+12ヶ月・年度は4月始まり）</div>
                      <table className="up-table">
                        <thead><tr><th>年度</th><th>償却予定件数</th><th>償却予定金額</th></tr></thead>
                        <tbody>
                          {schedule.byFiscalYear.map((f) => (
                            <tr key={f.fiscalYear}><td>{f.label}</td><td>{f.count.toLocaleString()}</td><td className="up-amber">{yen(f.amount)}</td></tr>
                          ))}
                          {schedule.byFiscalYear.length === 0 && <tr><td colSpan={3} className="up-muted">データがありません</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div className="up-panel">
                      <div className="up-panel-h">月別 償却予定額</div>
                      <table className="up-table">
                        <thead><tr><th>償却予定月</th><th>件数</th><th>金額</th></tr></thead>
                        <tbody>
                          {[...schedule.byMonth].reverse().map((m) => (
                            <tr key={m.month}><td>{m.month}</td><td>{m.count.toLocaleString()}</td><td className="up-amber">{yen(m.amount)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : <div className="up-empty">データがありません</div>}
              </div>
            )}
          </>
        )}
      </div>

      {/* 月次ドリルダウン: 未納者 / 後日回収者 */}
      {monthDetail && (
        <div className="up-modal-ov" onClick={() => setMonthDetail(null)}>
          <div className="up-modal" onClick={(e) => e.stopPropagation()}>
            <div className="up-modal-h">
              <span>{monthDetail.ym} の内訳</span>
              <button onClick={() => setMonthDetail(null)}>✕</button>
            </div>
            {monthLoading ? <div className="up-empty">読み込み中…</div> : (
              <div className="up-modal-body">
                <div className="up-modal-col">
                  <div className="up-modal-col-h red">現未納者（{monthDetail.unpaid.length}名）</div>
                  <div className="up-modal-list">
                    {monthDetail.unpaid.map((m) => (
                      <div className="up-mrow" key={m.memberNo}>
                        <div><code>{m.memberNo}</code> {m.name}</div>
                        <div className="up-red">{yen(m.unpaidAmount)}</div>
                        <div className="up-mrow-sub">{m.phone} {m.email}</div>
                      </div>
                    ))}
                    {monthDetail.unpaid.length === 0 && <div className="up-muted" style={{ padding: 12 }}>なし</div>}
                  </div>
                </div>
                <div className="up-modal-col">
                  <div className="up-modal-col-h green">後日回収できた人（{monthDetail.recovered.length}名）</div>
                  <div className="up-modal-list">
                    {monthDetail.recovered.map((m) => (
                      <div className="up-mrow" key={m.memberNo}>
                        <div><code>{m.memberNo}</code> {m.name}</div>
                        <div className="up-green">{yen(m.recoveredAmount)}</div>
                        <div className="up-mrow-sub">{m.phone} {m.email}</div>
                      </div>
                    ))}
                    {monthDetail.recovered.length === 0 && <div className="up-muted" style={{ padding: 12 }}>なし</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        .up-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .up-row-click { cursor: pointer; } .up-row-click:hover { background: #f8fafc; }
        .up-modal-ov { position: fixed; inset: 0; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
        .up-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 860px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; }
        .up-modal-h { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #e2e8f0; font-weight: 800; }
        .up-modal-h button { border: none; background: #f1f5f9; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; font-weight: 700; }
        .up-modal-body { display: grid; grid-template-columns: 1fr 1fr; gap: 0; overflow: hidden; }
        .up-modal-col { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid #e2e8f0; }
        .up-modal-col:last-child { border-right: none; }
        .up-modal-col-h { padding: 10px 16px; font-weight: 800; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
        .up-modal-col-h.red { color: #dc2626; } .up-modal-col-h.green { color: #059669; }
        .up-modal-list { overflow-y: auto; max-height: 62vh; }
        .up-mrow { padding: 8px 16px; border-bottom: 1px solid #f8fafc; font-size: 13px; display: grid; grid-template-columns: 1fr auto; gap: 4px; }
        .up-mrow code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
        .up-mrow-sub { grid-column: 1 / -1; font-size: 11px; color: #94a3b8; }
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
        .up-charts { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 18px; }
        @media (max-width: 900px) { .up-charts { grid-template-columns: 1fr; } }
        .up-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; }
        .up-card-top { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 12px; font-weight: 700; }
        .up-card-val { font-size: 24px; font-weight: 800; margin-top: 8px; }
        .up-card-sub { font-size: 12px; color: #64748b; font-weight: 700; margin-top: 2px; }
        .up-card.red .up-card-top, .up-card.red .up-card-val { color: #dc2626; }
        .up-card.green .up-card-top, .up-card.green .up-card-val { color: #059669; }
        .up-card.amber .up-card-top, .up-card.amber .up-card-val { color: #d97706; }
        .up-card.blue .up-card-top, .up-card.blue .up-card-val { color: #2563eb; }
        .up-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
        .up-panel-h { padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 800; }
        .up-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .up-table th { background: #f8fafc; text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #64748b; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
        .up-table td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; white-space: nowrap; }
        .up-red { color: #dc2626; font-weight: 700; } .up-green { color: #059669; font-weight: 700; } .up-amber { color: #d97706; font-weight: 700; } .up-blue { color: #2563eb; font-weight: 700; }
        .up-muted { color: #94a3b8; font-weight: 600; }
        .up-muted2 { color: #64748b; font-size: 12px; }
        .up-section-h { font-size: 14px; font-weight: 800; color: #0f172a; margin: 4px 0 12px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .up-section-h span { font-size: 11px; font-weight: 600; color: #94a3b8; }
        .up-pill { display: inline-block; font-size: 11px; font-weight: 800; border-radius: 999px; padding: 2px 10px; }
        .up-pill.green { background: #ecfdf5; color: #059669; } .up-pill.red { background: #fef2f2; color: #dc2626; }
        .up-pill.blue { background: #eff6ff; color: #2563eb; } .up-pill.amber { background: #fffbeb; color: #d97706; }
        .up-pill.gray { background: #f1f5f9; color: #64748b; }
        .up-mail { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
        .up-bd { font-size: 11px; color: #475569; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
        .up-list-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .up-bucket { display: flex; gap: 4px; background: #f1f5f9; padding: 3px; border-radius: 8px; }
        .up-statusfilter { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
        .up-sf-label { font-size: 12px; font-weight: 700; color: #64748b; }
        .up-sf { border: 1px solid #e2e8f0; background: #fff; border-radius: 20px; padding: 5px 14px; font-size: 12px; font-weight: 700; color: #475569; cursor: pointer; }
        .up-sf.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
        .up-sf b { margin-left: 4px; }
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
