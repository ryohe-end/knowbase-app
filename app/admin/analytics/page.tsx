// app/admin/analytics/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import { PieChart, Pie, Cell, Legend, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

/* --- 型定義 --- */
type UserData = {
  userId: string;
  name: string;
  email: string;
  role?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt?: string;
};

const ROLE_LABEL: Record<string, string> = { all: "すべてのロール", admin: "admin(管理者)", sv: "sv(SV)", editor: "editor(編集)", store: "store(店舗)", finance: "finance(経理)", viewer: "viewer(閲覧)" };

type NewsDetail = {
  title: string;
  views: number;
  viewers: { name: string; email: string; role?: string; viewedAt: string }[];
};

type SummaryData = {
  summary: {
    totalLogins: number;
    uniqueLogins: number;
    newsViewCount: number;
    activityRate: number;
    totalUsers: number;
    activeUsers: number;
    totalManualViews: number;
    totalManuals: number;
  };
  uniqueLoginUsers: UserData[];
  newsViewsDetail: NewsDetail[];
  allManuals: { manualId: string; title: string; views: number; viewsByRole?: Record<string, number> }[];
  searchRanking: { keyword: string; count: number }[];
  searchRankingByRole?: Record<string, { keyword: string; count: number }[]>;
  userLoginCounts: { name: string; email: string; role?: string; count: number }[];
};

const formatDate = (isoStr?: string) => {
  if (!isoStr) return "-";
  return new Date(isoStr).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
};

const isWithinDays = (isoStr: string | undefined, days: number) => {
  if (!isoStr) return false;
  return new Date(isoStr).getTime() >= (Date.now() - days * 24 * 60 * 60 * 1000);
};

const num = (n: number) => (n || 0).toLocaleString("ja-JP");

// 円グラフ: 有効ログイン済 / 有効未ログイン / 無効 の3区分で固定配色。
const CHART_COLORS = ["#2563eb", "#f59e0b", "#cbd5e1"];

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserData[]>([]);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [filterDays, setFilterDays] = useState<number>(30);
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const [activeModal, setActiveModal] = useState<"uniqueLogins" | "news" | "allManuals" | null>(null);
  const [selectedNews, setSelectedNews] = useState<NewsDetail | null>(null);

  const refreshData = async () => {
    setLoading(true);
    try {
      const [uRes, sRes] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch(`/api/admin/analytics/summary?days=${filterDays}`, { cache: "no-store" }),
      ]);
      const uData = await uRes.json();
      const sData = await sRes.json();
      setUsers(uData.users || []);
      setSummaryData(sData.error || !sData.summary ? null : sData);
    } catch (e) {
      console.error("Analytics load error:", e);
      setSummaryData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshData(); }, [filterDays]);

  const closeModal = () => { setActiveModal(null); setSelectedNews(null); };

  const handleDeactivate = async (user: UserData) => {
    if (!window.confirm(`${user.name} さんのアカウントを「停止」にしますか？`)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "update", user: { ...user, isActive: false } }),
      });
      if (res.ok) { alert("アカウントを停止しました。"); refreshData(); }
      else alert("停止に失敗しました。");
    } catch (e) {
      alert("通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  /* --- ロール連動の集計（全KPI・グラフ・ランキングを選択ロールで再計算） --- */
  const inRole = (role?: string) => roleFilter === "all" || (role || "viewer") === roleFilter;
  const byRole = <T extends { role?: string }>(list: T[]) => list.filter((x) => inRole(x.role));

  const roleUsers = byRole(users);
  const roleTotalCount = roleUsers.length;
  const roleActiveCount = roleUsers.filter((u) => u.isActive).length;

  const dormantFiltered = byRole(
    users.filter((u) => u.isActive && (!u.lastLoginAt || !isWithinDays(u.lastLoginAt, 90)))
  );

  const uniqueLoginList = byRole(summaryData?.uniqueLoginUsers || []);
  const uniqueLoginsRole = uniqueLoginList.length;
  const uniqueActiveRole = uniqueLoginList.filter((u) => u.isActive).length; // 円グラフ・アクティブ率用（有効ユーザーのみ）

  const loginCounts = byRole(summaryData?.userLoginCounts || []);
  const totalLoginsRole = loginCounts.reduce((s, u) => s + (u.count || 0), 0);

  const manualsRanked = (roleFilter === "all"
    ? (summaryData?.allManuals || [])
    : (summaryData?.allManuals || []).map((m) => ({ ...m, views: (m.viewsByRole?.[roleFilter]) || 0 }))
  ).slice().sort((a, b) => b.views - a.views);
  const manualViewsRole = manualsRanked.reduce((s, m) => s + (m.views || 0), 0);

  const newsViewsFiltered = (summaryData?.newsViewsDetail || []).map((n) => {
    if (roleFilter === "all") return n;
    const vs = n.viewers.filter((v) => (v.role || "viewer") === roleFilter);
    return { ...n, viewers: vs, views: vs.length };
  }).filter((n) => roleFilter === "all" || n.views > 0).sort((a, b) => b.views - a.views);
  const newsViewsRole = newsViewsFiltered.reduce((s, n) => s + (n.views || 0), 0);

  const searchRanking = roleFilter === "all"
    ? (summaryData?.searchRanking || [])
    : (summaryData?.searchRankingByRole?.[roleFilter] || []);

  const activityRateRole = roleActiveCount > 0 ? Math.round((uniqueActiveRole / roleActiveCount) * 1000) / 10 : 0;

  // ロール選択肢は実データから動的生成（存在するロールのみ＋件数）。
  // editor/store 等の該当者0のロールを固定表示して「選ぶと全部0」になる混乱を防ぐ。
  const roleCounts = new Map<string, number>();
  for (const u of users) { const r = u.role || "viewer"; roleCounts.set(r, (roleCounts.get(r) || 0) + 1); }
  const availableRoles = ["all", ...Array.from(roleCounts.keys()).sort((a, b) => (roleCounts.get(b) || 0) - (roleCounts.get(a) || 0))];
  const roleOptionLabel = (r: string) => r === "all" ? ROLE_LABEL.all : `${ROLE_LABEL[r] || r}（${roleCounts.get(r) || 0}）`;

  const periodLabel = filterDays === 0 ? "全期間" : `過去 ${filterDays} 日間`;
  const roleLabel = roleFilter === "all" ? "全ロール" : (ROLE_LABEL[roleFilter] || roleFilter);

  const chartData = summaryData?.summary ? [
    { name: "有効・ログイン済", value: uniqueActiveRole },
    { name: "有効・未ログイン", value: Math.max(0, roleActiveCount - uniqueActiveRole) },
    { name: "無効アカウント", value: Math.max(0, roleTotalCount - roleActiveCount) },
  ] : [];
  const chartHasData = chartData.some((d) => d.value > 0);

  // KPI 定義。onClick 付き＝クリックで詳細（青・下線）、無し＝静的（濃grey）。数字は全てロール連動。
  const kpis: { label: string; value: string; sub: string; onClick?: () => void }[] = [
    { label: roleFilter === "all" ? "全ユーザー" : ROLE_LABEL[roleFilter], value: num(roleTotalCount), sub: `有効 ${roleActiveCount} ／ 休眠 ${dormantFiltered.length}` },
    { label: filterDays === 0 ? "アクティブ率（全期間）" : `アクティブ率（${filterDays}日）`, value: `${activityRateRole}%`, sub: "有効ユーザーのうち期間内ログイン" },
    { label: "ユニークログイン数", value: num(uniqueLoginsRole), sub: "クリックで詳細", onClick: () => setActiveModal("uniqueLogins") },
    { label: "総ログイン回数", value: num(totalLoginsRole), sub: "期間内の延べ回数" },
    { label: "マニュアル総閲覧数", value: num(manualViewsRole), sub: "期間内の合算" },
    { label: "お知らせ閲覧数", value: num(newsViewsRole), sub: "クリックで詳細", onClick: () => setActiveModal("news") },
  ];

  const downloadDormantCsv = () => {
    const header = ["名前", "ロール", "アドレス", "最終ログイン"];
    const rows = dormantFiltered.map((u) => [u.name || "", u.role || "viewer", u.email || "", u.lastLoginAt ? formatDate(u.lastLoginAt) : "未ログイン"]);
    const csv = "﻿" + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `休眠アカウント_${roleFilter === "all" ? "全ロール" : roleFilter}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="kb-admin-root">
      <AdminLoadingOverlay visible={loading} text="データを集計中..." />

      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/admin" className="kb-back-link">← メニューへ戻る</Link>
          <div className="kb-controls">
            <select className="kb-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} title="ロール別に切り替え（実在するロールのみ・カッコ内は人数）">
              {availableRoles.map((r) => <option key={r} value={r}>{roleOptionLabel(r)}</option>)}
            </select>
            <select className="kb-select" value={filterDays} onChange={(e) => setFilterDays(Number(e.target.value))}>
              <option value={7}>過去 7 日間</option>
              <option value={30}>過去 30 日間</option>
              <option value={90}>過去 90 日間</option>
              <option value={0}>全期間</option>
            </select>
            <button className="kb-refresh-btn" onClick={refreshData} disabled={loading}>↻ 更新</button>
          </div>
        </div>
      </div>

      <main className="kb-analytics-container">
        {/* ページ見出し */}
        <div className="kb-page-head">
          <div className="kb-eyebrow">ANALYTICS</div>
          <h1>分析ダッシュボード</h1>
          <p>knowbase の利用状況（<strong>{periodLabel}</strong> ／ <strong>{roleLabel}</strong>）。すべての数字は選択したロール・期間に連動します。</p>
        </div>

        {/* === 1. KPIカード群 === */}
        <section className="kb-kpi-grid">
          {kpis.map((k) => (
            <div className="kb-kpi-card" key={k.label}>
              <div className="kb-kpi-label">{k.label}</div>
              {k.onClick ? (
                <button className="kb-kpi-value kb-clickable-number" onClick={k.onClick}>{k.value}</button>
              ) : (
                <div className="kb-kpi-value">{k.value}</div>
              )}
              <div className="kb-kpi-sub">{k.sub}</div>
            </div>
          ))}
        </section>

        {/* === 2. グラフ・検索ランキング === */}
        <section className="kb-charts-grid">
          <div className="kb-panel chart-panel">
            <div className="kb-panel-head"><h3>👥 アカウント利用状況（{periodLabel}）</h3></div>
            <div className="kb-chart-container">
              {chartHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={4} dataKey="value">
                      {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip formatter={(v: any, n: any) => [`${num(Number(v))} 名`, n]} contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", fontSize: "12px" }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: "12px" }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="kb-empty" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>データがありません</div>
              )}
            </div>
          </div>

          <div className="kb-panel chart-panel">
            <div className="kb-panel-head"><h3>🔍 検索ワード ランキング</h3></div>
            <div className="kb-list-compact scrollable" style={{ height: "100%", overflowY: "auto" }}>
              {searchRanking.map((s, i) => (
                <div key={i} className="kb-list-row">
                  <div className="kb-rank-badge" style={{ background: i < 3 ? "#f59e0b" : "#cbd5e1" }}>{i + 1}</div>
                  <div className="kb-list-content"><div className="kb-list-title">{s.keyword}</div></div>
                  <div className="kb-view-count">{num(s.count)} 回</div>
                </div>
              ))}
              {searchRanking.length === 0 && <div className="kb-empty">検索履歴がありません</div>}
            </div>
          </div>
        </section>

        {/* === 3. ランキング2枚（左右均等） === */}
        <section className="kb-two-col">
          <div className="kb-panel">
            <div className="kb-panel-head">
              <h3>📚 マニュアル閲覧ランキング</h3>
              <button className="kb-sm-btn" onClick={() => setActiveModal("allManuals")}>全て見る →</button>
            </div>
            <div className="kb-list-compact">
              {manualsRanked.slice(0, 5).map((m, i) => (
                <div key={m.manualId} className="kb-list-row">
                  <div className="kb-rank-badge" style={{ background: i < 3 ? "#f59e0b" : "#cbd5e1" }}>{i + 1}</div>
                  <div className="kb-list-content"><div className="kb-list-title">{m.title}</div></div>
                  <div className="kb-view-count">{num(m.views)} 回</div>
                </div>
              ))}
              {manualsRanked.length === 0 && <div className="kb-empty">データがありません</div>}
            </div>
          </div>

          <div className="kb-panel">
            <div className="kb-panel-head"><h3>👤 ユーザー別 ログイン回数</h3></div>
            <div className="kb-list-compact scrollable" style={{ maxHeight: "320px" }}>
              <table className="kb-table" style={{ margin: 0 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr><th>ユーザー名</th><th style={{ textAlign: "right" }}>回数</th></tr>
                </thead>
                <tbody>
                  {loginCounts.map((u, i) => (
                    <tr key={i}>
                      <td>
                        <div className="kb-list-title" style={{ fontSize: "12px" }}>{u.name}</div>
                        <div className="kb-list-meta">{u.email}</div>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{num(u.count)} 回</td>
                    </tr>
                  ))}
                  {loginCounts.length === 0 && <tr><td colSpan={2} className="kb-empty">データがありません</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* === 4. 休眠アカウント（全幅） === */}
        <div className="kb-panel">
          <div className="kb-panel-head danger">
            <h3>💤 休眠アカウント（90日以上アクセスなし）</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="kb-head-badge">{dormantFiltered.length}件{roleFilter !== "all" ? `（${roleFilter}）` : ""}</span>
              <button className="kb-sm-btn kb-btn-primary" onClick={downloadDormantCsv} disabled={dormantFiltered.length === 0} title="名前・ロール・アドレスをCSV出力">⬇ CSV出力</button>
            </div>
          </div>
          <div className="kb-list-compact scrollable" style={{ maxHeight: "360px" }}>
            {dormantFiltered.map((u) => (
              <div key={u.userId} className="kb-list-row">
                <div className="kb-list-content">
                  <div className="kb-list-title">{u.name} <span className="kb-role-chip">{u.role || "viewer"}</span></div>
                  <div className="kb-list-meta text-warning">{u.email} ー 最終: {u.lastLoginAt ? formatDate(u.lastLoginAt) : "履歴なし"}</div>
                </div>
                <button className="kb-sm-btn kb-btn-danger" onClick={() => handleDeactivate(u)}>停止する</button>
              </div>
            ))}
            {dormantFiltered.length === 0 && <div className="kb-empty">該当する休眠ユーザーはいません</div>}
          </div>
        </div>
      </main>

      {/* === モーダル群 === */}
      {activeModal && (
        <div className="kb-modal-overlay" onClick={closeModal}>
          <div className="kb-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="kb-modal-header">
              <div>
                {activeModal === "uniqueLogins" && "👥 ユニークログインユーザー詳細"}
                {activeModal === "allManuals" && "📚 全マニュアル閲覧数一覧"}
                {activeModal === "news" && !selectedNews && "📢 お知らせ閲覧数の内訳"}
                {activeModal === "news" && selectedNews && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button className="kb-sm-btn" onClick={() => setSelectedNews(null)}>← 戻る</button>
                    <span>「{selectedNews.title}」の閲覧者</span>
                  </div>
                )}
              </div>
              <button className="kb-modal-close" onClick={closeModal}>×</button>
            </div>

            <div className="kb-modal-body">
              {activeModal === "uniqueLogins" && (
                <table className="kb-table">
                  <thead><tr><th>ユーザー名</th><th>最終アクセス</th></tr></thead>
                  <tbody>
                    {uniqueLoginList.map((u, i) => (
                      <tr key={i}>
                        <td>
                          <div className="kb-list-title" style={{ fontSize: "13px" }}>{u.name}</div>
                          <div className="kb-list-meta">{u.email}</div>
                        </td>
                        <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("ja-JP") : "-"}</td>
                      </tr>
                    ))}
                    {uniqueLoginList.length === 0 && <tr><td colSpan={2} className="kb-empty">データがありません</td></tr>}
                  </tbody>
                </table>
              )}

              {activeModal === "news" && !selectedNews && (
                <table className="kb-table kb-interactive-table">
                  <thead><tr><th>お知らせタイトル</th><th style={{ textAlign: "right" }}>閲覧数</th></tr></thead>
                  <tbody>
                    {newsViewsFiltered.map((n, i) => (
                      <tr key={i} onClick={() => setSelectedNews(n)}>
                        <td>
                          <div className="kb-link-title">{n.title}</div>
                          <div className="kb-list-meta">クリックして閲覧者を見る</div>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{num(n.views)} 回</td>
                      </tr>
                    ))}
                    {newsViewsFiltered.length === 0 && <tr><td colSpan={2} className="kb-empty">データがありません</td></tr>}
                  </tbody>
                </table>
              )}

              {activeModal === "news" && selectedNews && (
                <table className="kb-table">
                  <thead><tr><th>閲覧したユーザー</th><th>閲覧日時</th></tr></thead>
                  <tbody>
                    {selectedNews.viewers.map((v, i) => (
                      <tr key={i}>
                        <td>
                          <div className="kb-list-title" style={{ fontSize: "13px" }}>{v.name}</div>
                          <div className="kb-list-meta">{v.email}</div>
                        </td>
                        <td>{new Date(v.viewedAt).toLocaleString("ja-JP")}</td>
                      </tr>
                    ))}
                    {selectedNews.viewers.length === 0 && <tr><td colSpan={2} className="kb-empty">履歴がありません</td></tr>}
                  </tbody>
                </table>
              )}

              {activeModal === "allManuals" && (
                <table className="kb-table">
                  <thead><tr><th style={{ width: "56px", textAlign: "center" }}>順位</th><th>マニュアルタイトル</th><th style={{ textAlign: "right" }}>閲覧数</th></tr></thead>
                  <tbody>
                    {manualsRanked.map((m, i) => (
                      <tr key={m.manualId}>
                        <td style={{ textAlign: "center", color: "#94a3b8", fontWeight: 700 }}>{i + 1}</td>
                        <td>{m.title}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{num(m.views)} 回</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- スタイル定義 --- */}
      <style jsx global>{`
        .kb-admin-root { background-color: #f8fafc; min-height: 100vh; font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif; color: #0f172a; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .kb-controls { display: flex; gap: 12px; align-items: center; }
        .kb-select { font-size: 13px; padding: 7px 32px 7px 12px; border-radius: 8px; border: 1px solid #cbd5e1; background-color: #fff; color: #334155; outline: none; cursor: pointer; appearance: none; background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e"); background-repeat: no-repeat; background-position: right 8px center; background-size: 16px; }
        .kb-select:hover { border-color: #94a3b8; }
        .kb-refresh-btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #334155; cursor: pointer; }
        .kb-refresh-btn:hover { background: #f1f5f9; }

        .kb-analytics-container { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }

        .kb-page-head { margin-bottom: 24px; }
        .kb-eyebrow { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.15em; color: #2563eb; background: #eff6ff; padding: 4px 10px; border-radius: 4px; margin-bottom: 10px; }
        .kb-page-head h1 { font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 6px; }
        .kb-page-head p { font-size: 13px; color: #64748b; margin: 0; }

        .kb-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .kb-charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
        .kb-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
        @media (max-width: 860px) { .kb-charts-grid, .kb-two-col { grid-template-columns: 1fr; } }

        .kb-kpi-card { background: #fff; padding: 18px 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
        .kb-kpi-label { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 8px; }
        .kb-kpi-value { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1.2; }
        .kb-kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 6px; }
        /* クリックできる数字だけ青＋下線（＝ドリルダウン可の一貫サイン） */
        .kb-clickable-number { background: none; border: none; font-family: inherit; color: #2563eb; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; cursor: pointer; padding: 0; transition: 0.15s; }
        .kb-clickable-number:hover { color: #1d4ed8; }

        .kb-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
        .kb-panel:last-child { margin-bottom: 0; }
        .kb-two-col .kb-panel, .kb-charts-grid .kb-panel { margin-bottom: 0; }
        .chart-panel { height: 340px; display: flex; flex-direction: column; }
        .kb-chart-container { flex: 1; padding: 16px; min-height: 0; }
        .kb-panel-head { padding: 14px 18px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; background: #fcfdfe; }
        .kb-panel-head h3 { margin: 0; font-size: 14px; font-weight: 700; color: #334155; }
        .kb-panel-head.danger h3 { color: #dc2626; }
        .kb-head-badge { background: #f1f5f9; font-size: 11px; padding: 2px 8px; border-radius: 99px; color: #64748b; font-weight: 700; }

        .kb-list-compact { padding: 0; }
        .kb-list-compact.scrollable { overflow-y: auto; }
        .kb-list-row { display: flex; align-items: center; padding: 11px 18px; border-bottom: 1px solid #f8fafc; }
        .kb-list-row:last-child { border-bottom: none; }
        .kb-rank-badge { width: 24px; height: 24px; color: #fff; font-size: 11px; font-weight: 700; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; flex-shrink: 0; }
        .kb-list-content { flex: 1; min-width: 0; }
        .kb-list-title { font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .kb-link-title { font-size: 13px; font-weight: 600; color: #2563eb; }
        .kb-list-meta { font-size: 11px; color: #94a3b8; }
        .kb-list-meta.text-warning { color: #d97706; }
        .kb-view-count { font-size: 13px; font-weight: 700; color: #475569; white-space: nowrap; }
        .kb-role-chip { font-size: 11px; font-weight: 700; color: #64748b; background: #f1f5f9; padding: 1px 7px; border-radius: 6px; margin-left: 4px; }

        .kb-sm-btn { font-size: 11px; padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 6px; color: #64748b; background: #fff; cursor: pointer; transition: 0.15s; }
        .kb-sm-btn:hover { border-color: #2563eb; color: #2563eb; }
        .kb-sm-btn:disabled { opacity: 0.5; cursor: default; }
        .kb-btn-primary { color: #fff; background: #2563eb; border-color: #2563eb; }
        .kb-btn-primary:hover { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
        .kb-btn-danger { color: #dc2626; border-color: #fca5a5; }
        .kb-btn-danger:hover { background: #fef2f2; border-color: #dc2626; color: #b91c1c; }

        .kb-empty { padding: 24px; text-align: center; font-size: 12px; color: #94a3b8; }
        .kb-table { width: 100%; border-collapse: collapse; }
        .kb-table th { text-align: left; padding: 10px 18px; font-size: 11px; font-weight: 700; color: #64748b; border-bottom: 1px solid #e2e8f0; background: #f8fafc; white-space: nowrap; }
        .kb-table td { padding: 10px 18px; border-bottom: 1px solid #f8fafc; vertical-align: middle; font-size: 13px; }
        .kb-interactive-table tbody tr:hover { background-color: #f1f5f9; cursor: pointer; }

        .kb-modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.2s ease-out; }
        .kb-modal-content { background: #fff; border-radius: 12px; width: 100%; max-width: 600px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); }
        .kb-modal-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; color: #0f172a; }
        .kb-modal-body { overflow-y: auto; flex: 1; }
        .kb-modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #94a3b8; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; }
        .kb-modal-close:hover { background: #f1f5f9; color: #0f172a; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}
