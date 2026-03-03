// app/admin/analytics/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";

/* --- 型定義 --- */
type UserData = {
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string; // API実装済み
  createdAt: string;
};

type ManualData = {
  manualId: string;
  title: string;
  readCount: number; // API実装済み
  updatedAt: string;
  brandId?: string;
  biz?: string;
};

// 日付フォーマッター
const formatDate = (isoStr?: string) => {
  if (!isoStr) return "-";
  return new Date(isoStr).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

// 過去N日以内かどうか
const isWithinDays = (isoStr: string | undefined, days: number) => {
  if (!isoStr) return false;
  const target = new Date(isoStr).getTime();
  const limit = Date.now() - days * 24 * 60 * 60 * 1000;
  return target >= limit;
};

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserData[]>([]);
  const [manuals, setManuals] = useState<ManualData[]>([]);

  // データロード
  const refreshData = async () => {
    setLoading(true);
    try {
      const [uRes, mRes] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/manuals?onlyActive=0", { cache: "no-store" }), // 全件取得
      ]);
      const uData = await uRes.json();
      const mData = await mRes.json();

      setUsers(uData.users || []);
      setManuals(mData.manuals || []);
    } catch (e) {
      console.error("Analytics load error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  /* --- 集計ロジック --- */

  // 1. 基本KPI
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.isActive).length;
  // 30日以内にログインしたユーザー数
  const monthlyActiveUsers = users.filter((u) => isWithinDays(u.lastLoginAt, 30)).length;
  // アクティブ率 (有効ユーザーに対するMAU)
  const activityRate = activeUsers > 0 ? Math.round((monthlyActiveUsers / activeUsers) * 100) : 0;

  const totalManuals = manuals.length;
  const totalViews = manuals.reduce((sum, m) => sum + (m.readCount || 0), 0);

  // 2. マニュアル分析
  const sortedByViews = [...manuals].sort((a, b) => (b.readCount || 0) - (a.readCount || 0));
  const topManuals = sortedByViews.slice(0, 5);
  const zeroViewManuals = sortedByViews.filter((m) => !m.readCount || m.readCount === 0);

  // 最終更新が半年(180日)以上前のマニュアル
  const staleManuals = manuals.filter((m) => !isWithinDays(m.updatedAt, 180));

  // 3. ユーザー分析
  // 最近ログインした順
  const recentLogins = [...users]
    .filter((u) => u.lastLoginAt)
    .sort((a, b) => new Date(b.lastLoginAt!).getTime() - new Date(a.lastLoginAt!).getTime())
    .slice(0, 5);

  // 休眠ユーザー（有効だが90日以上ログインなし）
  const dormantUsers = users.filter(
    (u) => u.isActive && (!u.lastLoginAt || !isWithinDays(u.lastLoginAt, 90))
  );

  return (
    <div className="kb-admin-root">
      <AdminLoadingOverlay visible={loading} text="データを分析中..." />

      {/* Topbar (共通デザイン) */}
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/admin" className="kb-back-link">
            ← メニューへ戻る
          </Link>
          <div style={{ fontWeight: 700 }}>分析ダッシュボード</div>
          <button className="kb-refresh-btn" onClick={refreshData} disabled={loading}>
            ↻ 更新
          </button>
        </div>
      </div>

      <main className="kb-analytics-container">
        {/* === KPI Cards === */}
        <section className="kb-kpi-grid">
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">総閲覧数 (Total Views)</div>
            <div className="kb-kpi-value text-blue">{totalViews.toLocaleString()}</div>
            <div className="kb-kpi-sub">全マニュアルの累計</div>
          </div>
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">公開マニュアル数</div>
            <div className="kb-kpi-value">{totalManuals.toLocaleString()}</div>
            <div className="kb-kpi-sub">本数</div>
          </div>
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">有効ユーザー数</div>
            <div className="kb-kpi-value">{activeUsers.toLocaleString()}</div>
            <div className="kb-kpi-sub">総登録数: {totalUsers}</div>
          </div>
          <div className="kb-kpi-card">
            <div className="kb-kpi-label">月間アクティブ率</div>
            <div className="kb-kpi-value text-green">{activityRate}%</div>
            <div className="kb-kpi-sub">{monthlyActiveUsers}人が30日以内に利用</div>
          </div>
        </section>

        <div className="kb-analytics-layout">
          {/* === 左カラム: コンテンツ分析 === */}
          <div className="kb-col">
            {/* 1. 人気ランキング */}
            <div className="kb-panel">
              <div className="kb-panel-head">
                <h3>👑 よく読まれているマニュアル</h3>
              </div>
              <div className="kb-list-compact">
                {topManuals.map((m, i) => (
                  <div key={m.manualId} className="kb-list-row">
                    <div className="kb-rank-badge">{i + 1}</div>
                    <div className="kb-list-content">
                      <div className="kb-list-title">{m.title}</div>
                      <div className="kb-list-meta">
                        {m.biz || "共通"} • 最終更新: {formatDate(m.updatedAt)}
                      </div>
                    </div>
                    <div className="kb-view-count">{m.readCount || 0} views</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. 更新が必要かもしれないマニュアル */}
            <div className="kb-panel">
              <div className="kb-panel-head warning">
                <h3>⚠️ 長期間更新されていない (半年以上)</h3>
                <span className="kb-head-badge">{staleManuals.length}件</span>
              </div>
              <div className="kb-list-compact scrollable">
                {staleManuals.slice(0, 5).map((m) => (
                  <div key={m.manualId} className="kb-list-row">
                    <div className="kb-list-content">
                      <div className="kb-list-title">{m.title}</div>
                      <div className="kb-list-meta text-warning">
                        最終更新: {formatDate(m.updatedAt)}
                      </div>
                    </div>
                    <Link href={`/admin/manuals/edit?manualId=${m.manualId}`} className="kb-sm-btn">
                      編集
                    </Link>
                  </div>
                ))}
                {staleManuals.length === 0 && <div className="kb-empty">該当なし（優秀です！）</div>}
              </div>
            </div>

            {/* 3. 閲覧ゼロ */}
            <div className="kb-panel">
              <div className="kb-panel-head">
                <h3>unread まだ読まれていないマニュアル</h3>
                <span className="kb-head-badge">{zeroViewManuals.length}件</span>
              </div>
              <div className="kb-list-compact scrollable">
                {zeroViewManuals.slice(0, 5).map((m) => (
                  <div key={m.manualId} className="kb-list-row">
                    <div className="kb-list-content">
                      <div className="kb-list-title">{m.title}</div>
                      <div className="kb-list-meta">公開日: {formatDate((m as any).createdAt)}</div>
                    </div>
                  </div>
                ))}
                {zeroViewManuals.length === 0 && <div className="kb-empty">すべてのマニュアルが読まれています</div>}
              </div>
            </div>
          </div>

          {/* === 右カラム: ユーザー分析 === */}
          <div className="kb-col">
            {/* 4. 最近のログイン */}
            <div className="kb-panel">
              <div className="kb-panel-head">
                <h3>🟢 最近ログインしたユーザー</h3>
              </div>
              <table className="kb-table">
                <thead>
                  <tr>
                    <th>氏名</th>
                    <th>最終ログイン</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLogins.map((u) => (
                    <tr key={u.userId}>
                      <td>
                        <div className="kb-user-cell">
                          <div className="kb-user-name">{u.name}</div>
                          <div className="kb-user-email">{u.email}</div>
                        </div>
                      </td>
                      <td style={{ fontSize: "12px" }}>
                         {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("ja-JP") : "-"}
                      </td>
                    </tr>
                  ))}
                  {recentLogins.length === 0 && (
                    <tr><td colSpan={2} className="kb-empty">データなし</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 5. 休眠アカウント */}
            <div className="kb-panel">
              <div className="kb-panel-head danger">
                <h3>💤 休眠アカウント (90日以上アクセスなし)</h3>
                <span className="kb-head-badge">{dormantUsers.length}件</span>
              </div>
              <div className="kb-desc-box">
                セキュリティリスク軽減のため、長期間利用のないアカウントは棚卸しを検討してください。
              </div>
              <div className="kb-list-compact scrollable" style={{ maxHeight: "300px" }}>
                {dormantUsers.map((u) => (
                  <div key={u.userId} className="kb-list-row">
                    <div className="kb-list-content">
                      <div className="kb-list-title">{u.name}</div>
                      <div className="kb-list-meta">{u.email}</div>
                    </div>
                    <div className="kb-status-label danger">
                      {u.lastLoginAt ? formatDate(u.lastLoginAt) : "履歴なし"}
                    </div>
                  </div>
                ))}
                {dormantUsers.length === 0 && <div className="kb-empty">休眠ユーザーはいません</div>}
              </div>
            </div>
          </div>
        </div>
      </main>

      <style jsx global>{`
        .kb-admin-root {
          background-color: #f8fafc;
          min-height: 100vh;
          font-family: sans-serif;
          color: #0f172a;
        }
        /* Topbar */
        .kb-topbar {
          height: 60px;
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .kb-topbar-inner {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .kb-back-link {
          text-decoration: none;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
        }
        .kb-refresh-btn {
          font-size: 12px;
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid #cbd5e1;
          background: #fff;
          cursor: pointer;
        }
        .kb-refresh-btn:hover { background: #f1f5f9; }

        /* Layout */
        .kb-analytics-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 32px 24px;
        }
        .kb-analytics-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }
        @media (max-width: 768px) {
          .kb-analytics-layout { grid-template-columns: 1fr; }
        }

        /* KPI Cards */
        .kb-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        .kb-kpi-card {
          background: #fff;
          padding: 20px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .kb-kpi-label { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 8px; }
        .kb-kpi-value { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1.2; }
        .kb-kpi-value.text-blue { color: #3b82f6; }
        .kb-kpi-value.text-green { color: #10b981; }
        .kb-kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 6px; }

        /* Panels */
        .kb-panel {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          margin-bottom: 24px;
          overflow: hidden;
          box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .kb-panel-head {
          padding: 16px 20px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #fcfdfe;
        }
        .kb-panel-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: #334155; }
        .kb-panel-head.warning h3 { color: #d97706; }
        .kb-panel-head.danger h3 { color: #ef4444; }

        .kb-head-badge {
          background: #f1f5f9;
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 99px;
          color: #64748b;
          font-weight: 600;
        }

        .kb-desc-box {
          padding: 12px 20px;
          background: #fff7ed;
          font-size: 12px;
          color: #9a3412;
          line-height: 1.5;
        }

        /* Lists */
        .kb-list-compact {
          padding: 0;
        }
        .kb-list-compact.scrollable {
          max-height: 320px;
          overflow-y: auto;
        }
        .kb-list-row {
          display: flex;
          align-items: center;
          padding: 12px 20px;
          border-bottom: 1px solid #f8fafc;
        }
        .kb-list-row:last-child { border-bottom: none; }
        
        .kb-rank-badge {
          width: 24px;
          height: 24px;
          background: #3b82f6;
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 12px;
          flex-shrink: 0;
        }
        .kb-list-content { flex: 1; min-width: 0; }
        .kb-list-title { font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 2px; truncate; }
        .kb-list-meta { font-size: 11px; color: #94a3b8; }
        .kb-list-meta.text-warning { color: #d97706; }

        .kb-view-count { font-size: 13px; font-weight: 700; color: #64748b; }
        
        .kb-sm-btn {
          font-size: 11px;
          padding: 4px 10px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          color: #64748b;
          text-decoration: none;
        }
        .kb-sm-btn:hover { border-color: #3b82f6; color: #3b82f6; }

        .kb-status-label { font-size: 11px; font-weight: 600; }
        .kb-status-label.danger { color: #ef4444; }

        .kb-empty { padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; }

        /* Table */
        .kb-table { width: 100%; border-collapse: collapse; }
        .kb-table th {
          text-align: left;
          padding: 10px 20px;
          font-size: 11px;
          color: #64748b;
          border-bottom: 1px solid #e2e8f0;
          background: #fcfdfe;
        }
        .kb-table td {
          padding: 10px 20px;
          border-bottom: 1px solid #f8fafc;
          vertical-align: middle;
        }
        .kb-user-cell { display: flex; flex-direction: column; }
        .kb-user-name { font-size: 13px; font-weight: 600; color: #1e293b; }
        .kb-user-email { font-size: 11px; color: #94a3b8; }
      `}</style>
    </div>
  );
}