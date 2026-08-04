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

const ROLE_OPTIONS = ["all", "admin", "sv", "editor", "store", "finance", "viewer"];
const ROLE_LABEL: Record<string, string> = { all: "すべてのロール", admin: "admin(管理者)", sv: "sv(SV)", editor: "editor(編集)", store: "store(店舗)", finance: "finance(経理)", viewer: "viewer(閲覧)" };

// 掘り下げ用の詳細データ型
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
    contactsCount: number;
    activityRate: number;
    totalUsers: number;
    activeUsers: number;
    totalManualViews: number; // ✅ 追加
    totalManuals: number;
  };
  uniqueLoginUsers: UserData[];
  newsViewsDetail: NewsDetail[]; // ✅ 閲覧者リストを含むように変更
  contactsDetail: { name: string; email: string; createdAt: string }[];
  allManuals: { manualId: string; title: string; views: number; viewsByRole?: Record<string, number> }[];
  searchRanking: { keyword: string; count: number }[];
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

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserData[]>([]);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [filterDays, setFilterDays] = useState<number>(30);
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // モーダル管理
  const [activeModal, setActiveModal] = useState<"uniqueLogins" | "news" | "contacts" | "allManuals" | null>(null);
  // ✅ お知らせの掘り下げ状態管理（選択されたお知らせ）
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
      if (sData.error || !sData.summary) {
        setSummaryData(null);
      } else {
        setSummaryData(sData);
      }
    } catch (e) {
      console.error("Analytics load error:", e);
      setSummaryData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshData(); }, [filterDays]);

  // モーダルを閉じる時に掘り下げ状態もリセット
  const closeModal = () => {
    setActiveModal(null);
    setSelectedNews(null);
  };

  const handleDeactivate = async (user: UserData) => {
    if (!window.confirm(`${user.name} さんのアカウントを「停止」にしますか？`)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "update", user: { ...user, isActive: false } }),
      });
      if (res.ok) {
        alert("アカウントを停止しました。");
        refreshData(); 
      } else {
        alert("停止に失敗しました。");
      }
    } catch (e) {
      alert("通信エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  // yamauchi-Users.lastLoginAt を基準に休眠判定。
  // lastLoginAt が null/未設定（＝一度もログインしていない）のアクティブユーザーも休眠に含める。
  const dormantUsers = users.filter(
    (u) => u.isActive && (!u.lastLoginAt || !isWithinDays(u.lastLoginAt, 90))
  );
  // ロール別切替: すべて以外は該当ロールに絞る
  const byRole = (list: UserData[]) => (roleFilter === "all" ? list : list.filter((u) => (u.role || "viewer") === roleFilter));
  const dormantFiltered = byRole(dormantUsers);
  const roleUsers = byRole(users);
  const roleActiveCount = roleUsers.filter((u) => u.isActive).length;

  // ロール別切替を全集計に反映
  const loginCounts = (summaryData?.userLoginCounts || []).filter((u) => roleFilter === "all" || (u.role || "viewer") === roleFilter);
  const manualsRanked = (roleFilter === "all"
    ? (summaryData?.allManuals || [])
    : (summaryData?.allManuals || []).map((m) => ({ ...m, views: (m.viewsByRole?.[roleFilter]) || 0 }))
  ).slice().sort((a, b) => b.views - a.views);
  const newsViewsFiltered = (summaryData?.newsViewsDetail || []).map((n) => {
    if (roleFilter === "all") return n;
    const vs = n.viewers.filter((v) => (v.role || "viewer") === roleFilter);
    return { ...n, viewers: vs, views: vs.length };
  }).filter((n) => roleFilter === "all" || n.views > 0).sort((a, b) => b.views - a.views);

  // 休眠アカウントCSV出力（名前・ロール・アドレス）
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

  const chartDataUsers = summaryData?.summary ? [
    { name: filterDays === 0 ? "ログインあり" : `${filterDays}日以内`, value: summaryData.summary.uniqueLogins },
    { name: "ログインなし", value: summaryData.summary.activeUsers - summaryData.summary.uniqueLogins },
    { name: "無効アカウント", value: summaryData.summary.totalUsers - summaryData.summary.activeUsers },
  ] : [];

  return (
    <div className="kb-admin-root">
      <AdminLoadingOverlay visible={loading} text="データを集計中..." />

      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/admin" className="kb-back-link">← メニューへ戻る</Link>
          <div style={{ fontWeight: 700 }}>分析ダッシュボード</div>
          
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <select className="kb-period-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} title="ロール別に切り替え">
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <select className="kb-period-select" value={filterDays} onChange={(e) => setFilterDays(Number(e.target.value))}>
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
        {/* === 1. 上部KPIカード群 === */}
        <section className="kb-kpi-grid">
          {/* ロール別切替に連動するユーザー内訳 */}
          <div className="kb-kpi-card" style={{ borderTop: "3px solid #6366f1" }}>
            <div className="kb-kpi-label">{roleFilter === "all" ? "全ユーザー" : ROLE_LABEL[roleFilter]}</div>
            <div className="kb-kpi-value" style={{ color: "#4f46e5" }}>{roleUsers.length}</div>
            <div className="kb-kpi-sub">有効 {roleActiveCount} ／ 休眠 {dormantFiltered.length}</div>
          </div>
          {/* ✅ 追加: マニュアル総閲覧数 */}
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">マニュアル総閲覧数</div>
            <div className="kb-kpi-value text-blue">{summaryData?.summary?.totalManualViews || 0}</div>
            <div className="kb-kpi-sub">全マニュアルの合算</div>
          </div>
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">ユニークログイン数</div>
            <button className="kb-kpi-value kb-clickable-number" onClick={() => setActiveModal("uniqueLogins")}>
              {summaryData?.summary?.uniqueLogins || 0}
            </button>
            <div className="kb-kpi-sub">クリックで詳細を表示</div>
          </div>
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">お知らせ閲覧数</div>
            <button className="kb-kpi-value kb-clickable-number text-orange" onClick={() => setActiveModal("news")}>
              {summaryData?.summary?.newsViewCount || 0}
            </button>
            <div className="kb-kpi-sub">クリックで詳細を表示</div>
          </div>
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">お問い合わせ数</div>
            <button className="kb-kpi-value kb-clickable-number text-purple" onClick={() => setActiveModal("contacts")}>
              {summaryData?.summary?.contactsCount || 0}
            </button>
            <div className="kb-kpi-sub">クリックで詳細を表示</div>
          </div>
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">
              {filterDays === 0 ? "全期間アクティブ率" : `アクティブ率 (${filterDays}日間)`}
            </div>
            <div className="kb-kpi-value text-green">{summaryData?.summary?.activityRate || 0}%</div>
            <div className="kb-kpi-sub">有効ユーザー比率</div>
          </div>
        </section>

        {/* === 2. グラフ・ランキング群 === */}
        <section className="kb-charts-grid">
          <div className="kb-panel chart-panel">
            <div className="kb-panel-head">
              <h3>👥 ユーザー利用状況 ({filterDays === 0 ? "全期間" : `過去${filterDays}日`})</h3>
            </div>
            <div className="kb-chart-container">
              {chartDataUsers.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartDataUsers} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                      {chartDataUsers.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="kb-empty" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>データがありません</div>
              )}
            </div>
          </div>

          <div className="kb-panel chart-panel">
            <div className="kb-panel-head">
              <h3>🔍 検索ワード ランキング</h3>
            </div>
            <div className="kb-list-compact scrollable" style={{ height: "100%", overflowY: "auto" }}>
              {(summaryData?.searchRanking || []).map((s, i) => (
                <div key={i} className="kb-list-row">
                  <div className="kb-rank-badge" style={{ background: i < 3 ? '#f59e0b' : '#94a3b8' }}>{i + 1}</div>
                  <div className="kb-list-content">
                    <div className="kb-list-title">{s.keyword}</div>
                  </div>
                  <div className="kb-view-count">{s.count} 回</div>
                </div>
              ))}
              {(summaryData?.searchRanking || []).length === 0 && <div className="kb-empty">検索履歴がありません</div>}
            </div>
          </div>
        </section>

        {/* === 3. 下部パネル群 === */}
        <div className="kb-analytics-layout">
          <div className="kb-col">
            <div className="kb-panel">
              <div className="kb-panel-head">
                <h3>📚 マニュアル閲覧ランキング</h3>
                <button className="kb-sm-btn" onClick={() => setActiveModal("allManuals")}>
                  全て見る →
                </button>
              </div>
              <div className="kb-list-compact">
                {manualsRanked.slice(0, 5).map((m, i) => (
                  <div key={m.manualId} className="kb-list-row">
                    <div className="kb-rank-badge" style={{ background: i < 3 ? '#3b82f6' : '#94a3b8' }}>{i + 1}</div>
                    <div className="kb-list-content">
                      <div className="kb-list-title">{m.title}</div>
                    </div>
                    <div className="kb-view-count">{m.views} views</div>
                  </div>
                ))}
                {manualsRanked.length === 0 && <div className="kb-empty">データがありません</div>}
              </div>
            </div>

            <div className="kb-panel">
              <div className="kb-panel-head">
                <h3>👤 ユーザー別 ログイン回数</h3>
              </div>
              <div className="kb-list-compact scrollable" style={{ maxHeight: "300px" }}>
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
                        <td style={{ textAlign: "right", fontWeight: "bold", color: "#3b82f6" }}>{u.count} 回</td>
                      </tr>
                    ))}
                    {loginCounts.length === 0 && <tr><td colSpan={2} className="kb-empty">データがありません</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="kb-col">
            <div className="kb-panel">
              <div className="kb-panel-head danger">
                <h3>💤 休眠アカウント (90日以上アクセスなし)</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="kb-head-badge">{dormantFiltered.length}件{roleFilter !== "all" ? `（${roleFilter}）` : ""}</span>
                  <button className="kb-sm-btn" style={{ background: "#0f766e", color: "#fff", border: "none" }} onClick={downloadDormantCsv} disabled={dormantFiltered.length === 0} title="名前・ロール・アドレスをCSV出力">⬇ CSV出力</button>
                </div>
              </div>
              <div className="kb-list-compact scrollable" style={{ maxHeight: "400px" }}>
                {dormantFiltered.map((u) => (
                  <div key={u.userId} className="kb-list-row">
                    <div className="kb-list-content">
                      <div className="kb-list-title">{u.name} <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", background: "#f1f5f9", padding: "1px 7px", borderRadius: 6, marginLeft: 4 }}>{u.role || "viewer"}</span></div>
                      <div className="kb-list-meta text-warning">{u.email}ー最終: {u.lastLoginAt ? formatDate(u.lastLoginAt) : "履歴なし"}</div>
                    </div>
                    <button className="kb-sm-btn kb-btn-danger" onClick={() => handleDeactivate(u)}>
                      停止する
                    </button>
                  </div>
                ))}
                {dormantFiltered.length === 0 && <div className="kb-empty">該当する休眠ユーザーはいません</div>}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* === 4. モーダル群 (Click for Details) === */}
      {activeModal && (
        <div className="kb-modal-overlay" onClick={closeModal}>
          <div className="kb-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="kb-modal-header">
              <div>
                {activeModal === "uniqueLogins" && "👥 ユニークログインユーザー詳細"}
                {activeModal === "contacts" && "✉️ お問い合わせ履歴"}
                {activeModal === "allManuals" && "📚 全マニュアル閲覧数一覧"}
                
                {/* ✅ お知らせの場合、掘り下げ状態によってタイトルを切り替え */}
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
              {/* ユニークログイン詳細 */}
              {activeModal === "uniqueLogins" && (
                <table className="kb-table">
                  <thead><tr><th>ユーザー名</th><th>最終アクセス</th></tr></thead>
                  <tbody>
                    {(summaryData?.uniqueLoginUsers || []).map((u, i) => (
                      <tr key={i}>
                        <td>
                          <div className="kb-list-title" style={{ fontSize: "13px" }}>{u.name}</div>
                          <div className="kb-list-meta">{u.email}</div>
                        </td>
                        <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("ja-JP") : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ✅ お知らせ閲覧内訳 ＆ 掘り下げ */}
              {activeModal === "news" && !selectedNews && (
                <table className="kb-table kb-interactive-table">
                  <thead><tr><th>お知らせタイトル</th><th style={{textAlign: "right"}}>閲覧数</th></tr></thead>
                  <tbody>
                    {newsViewsFiltered.map((n, i) => (
                      <tr key={i} onClick={() => setSelectedNews(n)}>
                        <td>
                          <div style={{ color: "#3b82f6", cursor: "pointer", fontWeight: "600" }}>{n.title}</div>
                          <div className="kb-list-meta">クリックして閲覧者を見る</div>
                        </td>
                        <td style={{textAlign: "right", fontWeight: "bold"}}>{n.views}</td>
                      </tr>
                    ))}
                    {newsViewsFiltered.length === 0 && <tr><td colSpan={2} className="kb-empty">データがありません</td></tr>}
                  </tbody>
                </table>
              )}

              {/* ✅ お知らせ閲覧者リスト (掘り下げ後) */}
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

              {/* お問い合わせ詳細 */}
              {activeModal === "contacts" && (
                <table className="kb-table">
                  <thead><tr><th>送信日時</th><th>ユーザー</th></tr></thead>
                  <tbody>
                    {(summaryData?.contactsDetail || []).map((c, i) => (
                      <tr key={i}>
                        <td>{new Date(c.createdAt).toLocaleString("ja-JP")}</td>
                        <td>
                          <div className="kb-list-title" style={{ fontSize: "13px" }}>{c.name}</div>
                          <div className="kb-list-meta">{c.email}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* 全マニュアル閲覧数 */}
              {activeModal === "allManuals" && (
                <table className="kb-table">
                  <thead><tr><th>ランキング</th><th>マニュアルタイトル</th><th style={{textAlign: "right"}}>閲覧数</th></tr></thead>
                  <tbody>
                    {manualsRanked.map((m, i) => (
                      <tr key={m.manualId}>
                        <td style={{width: "50px", textAlign: "center", color: "#94a3b8", fontWeight: "bold"}}>{i + 1}</td>
                        <td>{m.title}</td>
                        <td style={{textAlign: "right", fontWeight: "bold", color: "#3b82f6"}}>{m.views}</td>
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
        .kb-admin-root { background-color: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .kb-period-select { font-size: 13px; padding: 6px 32px 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1; background-color: #f8fafc; color: #334155; outline: none; cursor: pointer; appearance: none; background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e"); background-repeat: no-repeat; background-position: right 8px center; background-size: 16px; }
        .kb-period-select:hover { border-color: #94a3b8; }
        .kb-refresh-btn { font-size: 12px; padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
        .kb-refresh-btn:hover { background: #f1f5f9; }
        .kb-analytics-container { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }
        
        .kb-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .kb-charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
        .kb-analytics-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 768px) { .kb-charts-grid, .kb-analytics-layout { grid-template-columns: 1fr; } }
        
        .kb-kpi-card { background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .kb-kpi-label { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 8px; }
        .kb-kpi-value { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1.2; }
        .kb-kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 6px; }
        
        .kb-clickable-number { background: none; border: none; font-family: inherit; font-size: 28px; font-weight: 800; color: #3b82f6; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; cursor: pointer; padding: 0; transition: 0.2s; }
        .kb-clickable-number:hover { opacity: 0.7; }
        .kb-clickable-number.text-orange { color: #f59e0b; }
        .kb-clickable-number.text-purple { color: #8b5cf6; }
        .text-green { color: #10b981; }
        .text-blue { color: #3b82f6; }
        
        .kb-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
        .chart-panel { height: 350px; display: flex; flex-direction: column; }
        .kb-chart-container { flex: 1; padding: 16px; min-height: 0; }
        .kb-panel-head { padding: 16px 20px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; background: #fcfdfe; }
        .kb-panel-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: #334155; }
        .kb-panel-head.danger h3 { color: #ef4444; }
        .kb-head-badge { background: #f1f5f9; font-size: 11px; padding: 2px 8px; border-radius: 99px; color: #64748b; font-weight: 600; }
        .kb-desc-box { padding: 12px 20px; background: #fff7ed; font-size: 12px; color: #9a3412; line-height: 1.5; }
        
        .kb-list-compact { padding: 0; }
        .kb-list-compact.scrollable { overflow-y: auto; }
        .kb-list-row { display: flex; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f8fafc; }
        .kb-list-row:last-child { border-bottom: none; }
        .kb-rank-badge { width: 24px; height: 24px; color: #fff; font-size: 11px; font-weight: 700; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; flex-shrink: 0; }
        .kb-list-content { flex: 1; min-width: 0; }
        .kb-list-title { font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .kb-list-meta { font-size: 11px; color: #94a3b8; }
        .kb-list-meta.text-warning { color: #d97706; }
        .kb-view-count { font-size: 13px; font-weight: 700; color: #64748b; }
        
        .kb-sm-btn { font-size: 11px; padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 6px; color: #64748b; background: #fff; cursor: pointer; transition: 0.2s; }
        .kb-sm-btn:hover { border-color: #3b82f6; color: #3b82f6; }
        .kb-btn-danger { color: #ef4444; border-color: #fca5a5; }
        .kb-btn-danger:hover { background: #fef2f2; border-color: #ef4444; color: #b91c1c; }

        .kb-empty { padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; }
        .kb-table { width: 100%; border-collapse: collapse; }
        .kb-table th { text-align: left; padding: 10px 20px; font-size: 11px; color: #64748b; border-bottom: 1px solid #e2e8f0; background: #fcfdfe; }
        .kb-table td { padding: 10px 20px; border-bottom: 1px solid #f8fafc; vertical-align: middle; }
        
        .kb-interactive-table tbody tr:hover { background-color: #f1f5f9; cursor: pointer; }

        .kb-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15,23,42,0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.2s ease-out; }
        .kb-modal-content { background: #fff; border-radius: 12px; width: 100%; max-width: 600px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); }
        .kb-modal-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 16px; color: #0f172a; }
        .kb-modal-body { overflow-y: auto; flex: 1; }
        .kb-modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #94a3b8; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; }
        .kb-modal-close:hover { background: #f1f5f9; color: #0f172a; }
        
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}