// app/store-settings/push/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import type { PushNotification } from "@/types/pushNotification";

const formatDate = (iso: string) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
};

export default function PushSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<PushNotification[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/store-settings/push", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // KPI 計算
  const kpis = useMemo(() => {
    const sent = notifications.filter((n) => n.status === "SENT" && n.stats);
    const totalSent = sent.length;
    const avgOpenRate = sent.length === 0 ? 0
      : sent.reduce((sum, n) => {
          const s = n.stats!;
          return sum + (s.sentCount > 0 ? s.openCount / s.sentCount : 0);
        }, 0) / sent.length * 100;
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const thisWeek = sent.filter((n) => new Date(n.scheduledAt).getTime() >= weekStart.getTime()).length;
    const errorRate = sent.length === 0 ? 0
      : sent.reduce((sum, n) => {
          const s = n.stats!;
          return sum + (s.targetCount > 0 ? s.errorCount / s.targetCount : 0);
        }, 0) / sent.length * 100;
    return {
      totalSent,
      avgOpenRate: Math.round(avgOpenRate * 10) / 10,
      thisWeek,
      errorRate: Math.round(errorRate * 10) / 10,
    };
  }, [notifications]);

  return (
    <div className="push-root">
      <AdminLoadingOverlay visible={loading} />

      <header className="push-header">
        <div className="push-header-inner">
          <div className="push-header-left">
            <Link href="/store-settings" className="push-back-btn" title="戻る">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
            <h1 className="push-header-title">PUSH通知管理</h1>
          </div>
          <Link href="/store-settings/push/new" className="push-primary-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>新規配信作成</span>
          </Link>
        </div>
      </header>

      <main className="push-main-content">
        {/* KPI dashboard */}
        <section className="push-kpi-section">
          <div className="push-kpi-tile">
            <div className="push-kpi-label">総送信数</div>
            <div className="push-kpi-value">{kpis.totalSent}</div>
            <div className="push-kpi-sub">SENT 累計</div>
          </div>
          <div className="push-kpi-tile">
            <div className="push-kpi-label">平均開封率</div>
            <div className="push-kpi-value">{kpis.avgOpenRate}<small>%</small></div>
            <div className="push-kpi-sub">配信成功者あたり</div>
          </div>
          <div className="push-kpi-tile">
            <div className="push-kpi-label">今週送信数</div>
            <div className="push-kpi-value">{kpis.thisWeek}</div>
            <div className="push-kpi-sub">今週開始以降</div>
          </div>
          <div className="push-kpi-tile">
            <div className="push-kpi-label">エラー率</div>
            <div className="push-kpi-value">{kpis.errorRate}<small>%</small></div>
            <div className="push-kpi-sub">対象比 (端末未登録等)</div>
          </div>
        </section>

        <section className="push-history-section">
          <div className="push-table-container">
            <table className="push-history-table">
              <thead>
                <tr>
                  <th>送信日時</th>
                  <th>タイトル</th>
                  <th>ステータス</th>
                  <th>対象件数</th>
                  <th>成功数</th>
                  <th>開封率</th>
                </tr>
              </thead>
              <tbody>
                {notifications.length === 0 ? (
                  <tr><td colSpan={6} className="empty-row">配信履歴はありません</td></tr>
                ) : (
                  notifications.map((n) => (
                    <tr
                      key={n.id}
                      onClick={() => router.push(`/store-settings/push/${encodeURIComponent(n.id)}`)}
                      className="clickable-row"
                    >
                      <td className="date-cell">{formatDate(n.scheduledAt)}</td>
                      <td className="subj-cell">{n.title}</td>
                      <td>
                        <span className={`status-pill ${n.status.toLowerCase()}`}>
                          {n.status === "SENT" ? "完了" : n.status === "SCHEDULED" ? "予約中" : "下書き"}
                        </span>
                      </td>
                      <td>{n.stats?.targetCount || 0}</td>
                      <td>{n.stats?.sentCount || 0}</td>
                      <td>{n.stats && n.stats.sentCount > 0 ? `${Math.round((n.stats.openCount / n.stats.sentCount) * 100)}%` : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

    </div>
  );
}
