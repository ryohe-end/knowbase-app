// app/store-settings/push/[id]/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import type { PushNotification } from "@/types/pushNotification";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const formatDate = (iso: string) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
};

// ブランド(app_type) → プレビューテーマ
function brandTheme(appType?: string): { color: string; appName: string } {
  return appType === "joyfit"
    ? { color: "#1F2C5C", appName: "JOYFITアプリ" }
    : { color: "#E26E9D", appName: "FIT365アプリ" };
}

export default function PushDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [n, setN] = useState<(PushNotification & { appType?: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/store-settings/push?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = await res.json();
        // openTimeline はトップレベル返却なので notification にマージ
        setN(data.notification ? { ...data.notification, openTimeline: data.openTimeline ?? [] } : null);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const stats = n?.stats;
  const openRate = stats && stats.sentCount > 0 ? Math.round((stats.openCount / stats.sentCount) * 100) : 0;
  const theme = brandTheme(n?.appType);

  return (
    <div className="push-root">
      <AdminLoadingOverlay visible={loading} />

      <header className="push-header">
        <div className="push-header-inner">
          <div className="push-header-left">
            <Link href="/store-settings/push" className="push-back-btn" title="戻る">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
            <h1 className="push-header-title">配信詳細</h1>
          </div>
        </div>
      </header>

      <main className="push-detail-main">
        {!n && !loading && <div className="push-empty-state">配信が見つかりません</div>}
        {n && (
          <div className="push-detail-grid">
            {/* 左: メタ情報 + プレビュー */}
            <aside className="push-detail-side">
              <div className="push-detail-card">
                <div className="push-detail-card-title">配信情報</div>
                <div className="push-detail-row">
                  <span>送信日時</span>
                  <span>{formatDate(n.scheduledAt)}</span>
                </div>
                <div className="push-detail-row">
                  <span>ステータス</span>
                  <span className={`status-pill ${n.status.toLowerCase()}`}>{n.status === "SENT" ? "完了" : n.status === "SCHEDULED" ? "予約中" : "下書き"}</span>
                </div>
                <div className="push-detail-row">
                  <span>作成日時</span>
                  <span>{formatDate(n.createdAt)}</span>
                </div>
              </div>

              <div className="push-detail-card">
                <div className="push-detail-card-title">配信内容</div>
                <div className="push-detail-block">
                  <div className="push-detail-label">タイトル</div>
                  <div className="push-detail-val">{n.title}</div>
                </div>
                <div className="push-detail-block">
                  <div className="push-detail-label">本文</div>
                  <div className="push-detail-val multiline">{n.body}</div>
                </div>
              </div>

              <div className="push-detail-card">
                <div className="push-detail-card-title">スマホ通知プレビュー</div>
                <div className="push-preview-frame">
                  <div className="push-phone-mockup">
                    <div className="push-notch" />
                    <div className="push-screen">
                      <div className="push-time">10:41</div>
                      <div className="push-notification-bubble">
                        <div className="push-bubble-header">
                          <div className="push-app-info">
                            <div className="push-app-icon" style={{ background: theme.color }} />
                            <span className="push-app-name">{theme.appName}</span>
                          </div>
                          <span className="push-now">たった今</span>
                        </div>
                        <div className="push-bubble-content">
                          <div className="push-bubble-title">{n.title}</div>
                          <div className="push-bubble-body">{n.body}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            {/* 右: KPI + チャート */}
            <section className="push-detail-main-col">
              <div className="push-detail-card">
                <div className="push-detail-card-title">配信結果レポート</div>
                {stats ? (
                  <>
                    <div className="push-report-grid">
                      <div className="kpi-item">
                        <label>配信対象</label>
                        <div className="kpi-val">{stats.targetCount}</div>
                      </div>
                      <div className="kpi-item">
                        <label>成功数</label>
                        <div className="kpi-val text-blue">{stats.sentCount}</div>
                      </div>
                      <div className="kpi-item">
                        <label>開封数</label>
                        <div className="kpi-val text-green">{stats.openCount}</div>
                      </div>
                      <div className="kpi-item">
                        <label>開封率</label>
                        <div className="kpi-val">{openRate}<small>%</small></div>
                      </div>
                    </div>
                    <div className="error-bar">
                      <span className="err-label">配信エラー</span>
                      <span className="err-val">{stats.errorCount}件</span>
                    </div>
                  </>
                ) : (
                  <div className="push-empty-state">未配信のため統計はありません</div>
                )}
              </div>

              {n.openTimeline && n.openTimeline.length > 0 && (
                <div className="push-detail-card">
                  <div className="push-detail-card-title">送信後の時間別開封数</div>
                  <div className="push-chart-wrap">
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={n.openTimeline} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="openGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="hourOffset" tickFormatter={(h) => `+${h}h`} fontSize={11} />
                        <YAxis fontSize={11} />
                        <Tooltip formatter={(v: any) => [`${v} 件`, "開封"]} labelFormatter={(h) => `送信から ${h} 時間後`} />
                        <Area type="monotone" dataKey="opens" stroke="#0ea5e9" fill="url(#openGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
