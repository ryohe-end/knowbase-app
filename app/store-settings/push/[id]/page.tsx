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

// n.body は information2.content(お知らせHTML)。ロック画面バナー/本文はテキストのみ表示するため
// タグを除去してプレーンテキスト化する(お知らせ欄は HTML のまま描画)。
function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
  const [peopleTab, setPeopleTab] = useState<"opened" | "unopened">("opened");

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
  // お知らせHTML(n.body) からロック画面/本文用のプレーンテキストを作る
  const bannerText = n ? stripHtml(n.body) : "";
  const hasNoticeHtml = !!n?.body && /<[a-z][\s\S]*>/i.test(n.body); // HTMLタグを含む=お知らせ欄デザインあり

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
          {n && (
            <Link href="/store-settings/push/new" className="push-primary-btn"
              onClick={() => { try { sessionStorage.setItem("push_reuse", JSON.stringify({ title: n.title, body: bannerText, html: hasNoticeHtml ? n.body : "" })); } catch {} }}
              title="この配信の内容を引き継いで編集・再送信します">
              編集して再送信
            </Link>
          )}
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
                  <div className="push-detail-val multiline">{bannerText}</div>
                </div>
              </div>

              <div className="push-detail-card">
                <div className="push-detail-card-title">スマホ通知プレビュー</div>
                <div className="push-preview-frame push-preview-dual">
                  {/* ① ロック画面に出る PUSH 通知バナー(テキストのみ) */}
                  <div className="push-preview-item">
                    <div className="push-preview-caption">
                      <span className="push-preview-badge lock">ロック画面</span>
                      PUSH通知バナー
                    </div>
                    <div className="push-phone-mockup lock">
                      <div className="push-notch" />
                      <div className="push-screen lock-screen">
                        <div className="push-lock-time">
                          <div className="push-lock-clock">10:41</div>
                          <div className="push-lock-date">配信済み</div>
                        </div>
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
                            <div className="push-bubble-body">{bannerText}</div>
                          </div>
                        </div>
                        <div className="push-lock-hint">※ ロック画面・通知センターにはテキストのみ表示されます</div>
                      </div>
                    </div>
                  </div>

                  {/* ② アプリを開くと「お知らせ」欄に出る詳細(HTML) */}
                  <div className="push-preview-item">
                    <div className="push-preview-caption">
                      <span className="push-preview-badge app" style={{ background: theme.color }}>アプリ内</span>
                      お知らせ画面
                    </div>
                    <div className="push-phone-mockup app">
                      <div className="push-notch" />
                      <div className="push-screen app-screen">
                        <div className="push-app-bar" style={{ background: theme.color }}>
                          <span className="push-app-bar-back">‹</span>
                          <span className="push-app-bar-title">お知らせ</span>
                          <span />
                        </div>
                        <div className="push-app-notice">
                          <div className="push-app-notice-title">{n.title}</div>
                          <div className="push-app-notice-date">{formatDate(n.scheduledAt)}</div>
                          {hasNoticeHtml ? (
                            <div className="push-app-notice-body" dangerouslySetInnerHTML={{ __html: n.body }} />
                          ) : (
                            <div className="push-app-notice-body multiline">{bannerText}</div>
                          )}
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

              {/* 会員別の開封状況 (個人宛=CONDITION のみ。店舗トピック配信は対象外) */}
              {n.people && (n.people.opened.length + n.people.unopened.length) > 0 && (
                <div className="push-detail-card">
                  <div className="push-detail-card-title">会員別の開封状況</div>
                  <div className="push-people-tabs">
                    <button className={`push-people-tab ${peopleTab === "opened" ? "active" : ""}`} onClick={() => setPeopleTab("opened")}>
                      開いた人 <span className="push-people-badge open">{n.people.opened.length}</span>
                    </button>
                    <button className={`push-people-tab ${peopleTab === "unopened" ? "active" : ""}`} onClick={() => setPeopleTab("unopened")}>
                      開いてない人 <span className="push-people-badge">{n.people.unopened.length}</span>
                    </button>
                  </div>
                  <div className="push-people-list">
                    {(peopleTab === "opened" ? n.people.opened : n.people.unopened).map((p, i) => (
                      <div className="push-person-row" key={`${p.memberNo || p.name}-${i}`}>
                        <span className="push-person-name">{p.name}</span>
                        <span className="push-person-meta">
                          {p.memberNo ? <span className="push-person-no">No.{p.memberNo}</span> : null}
                          {p.clubName ? <span className="push-person-club">{p.clubName}</span> : null}
                        </span>
                        <span className="push-person-time">{p.readAt ? formatDate(p.readAt) : "未開封"}</span>
                      </div>
                    ))}
                    {(peopleTab === "opened" ? n.people.opened : n.people.unopened).length === 0 && (
                      <div className="push-empty-state">{peopleTab === "opened" ? "まだ開封した会員はいません" : "未開封の会員はいません"}</div>
                    )}
                  </div>
                  <div className="push-people-note">※ 個人指定(会員抽出)で配信した分のみ会員単位で表示されます。店舗全体(トピック)配信は集計のみ。</div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
