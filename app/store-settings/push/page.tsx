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

// クラブ名一覧を表示用に整形 (多い場合は "先頭 他N件")
const clubLabel = (names?: string[]) => {
  if (!names || names.length === 0) return "-";
  if (names.length === 1) return names[0];
  return `${names[0]} 他${names.length - 1}件`;
};

export default function PushSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<PushNotification[]>([]);
  const [histSearch, setHistSearch] = useState("");
  const [histStatus, setHistStatus] = useState<"all" | "SENT" | "SCHEDULED" | "DRAFT">("all");
  const filteredNotifications = useMemo(() => {
    const q = histSearch.trim().toLowerCase();
    return notifications.filter((n) => {
      if (histStatus !== "all" && n.status !== histStatus) return false;
      if (!q) return true;
      return [n.title, n.senderName, ...(n.clubNames || [])].some((s) => String(s || "").toLowerCase().includes(q));
    });
  }, [notifications, histSearch, histStatus]);

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

  // 予約(未送信)の取り消し
  const cancelScheduled = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("この予約配信を削除（取り消し）しますか？\n送信前のため取り消せます。")) return;
    try {
      const res = await fetch(`/api/store-settings/push?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "取り消しに失敗しました");
      fetchData();
    } catch (err: any) { alert(err?.message || "取り消しに失敗しました"); }
  };
  // 予約の編集: 内容を引き継いで新規作成へ + 元の予約を取り消し
  const editScheduled = async (n: PushNotification, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("この予約配信を編集します。\n元の予約は取り消され、編集画面へ移動します。")) return;
    try { sessionStorage.setItem("push_reuse", JSON.stringify({ title: n.title, body: n.body })); } catch {}
    await fetch(`/api/store-settings/push?id=${encodeURIComponent(n.id)}`, { method: "DELETE" }).catch(() => {});
    router.push("/store-settings/push/new");
  };

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
          <div className="push-hist-toolbar">
            <input className="push-hist-search" placeholder="タイトル・クラブ・配信者で検索" value={histSearch} onChange={(e) => setHistSearch(e.target.value)} />
            <div className="push-hist-tabs">
              {([["all","すべて"],["SENT","完了"],["SCHEDULED","予約中"],["DRAFT","下書き"]] as const).map(([k, label]) => (
                <button key={k} className={histStatus === k ? "on" : ""} onClick={() => setHistStatus(k)}>{label}</button>
              ))}
            </div>
            <span className="push-hist-count">{filteredNotifications.length}件</span>
          </div>
          <div className="push-table-container">
            <table className="push-history-table">
              <thead>
                <tr>
                  <th>送信日時</th>
                  <th>タイトル</th>
                  <th>クラブ</th>
                  <th>配信者</th>
                  <th>ステータス</th>
                  <th>対象件数</th>
                  <th>成功数</th>
                  <th>開封率</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredNotifications.length === 0 ? (
                  <tr><td colSpan={9} className="empty-row">{notifications.length === 0 ? "配信履歴はありません" : "該当する配信はありません"}</td></tr>
                ) : (
                  filteredNotifications.map((n) => (
                    <tr
                      key={n.id}
                      onClick={() => router.push(`/store-settings/push/${encodeURIComponent(n.id)}`)}
                      className="clickable-row"
                    >
                      <td className="date-cell">{formatDate(n.scheduledAt)}</td>
                      <td className="subj-cell">{n.title}</td>
                      <td className="club-cell" title={(n.clubNames || []).join("、")}>{clubLabel(n.clubNames)}</td>
                      <td className="sender-cell">{n.senderName || "-"}</td>
                      <td>
                        <span className={`status-pill ${n.status.toLowerCase()}`}>
                          {n.status === "SENT" ? "完了" : n.status === "SCHEDULED" ? "予約中" : "下書き"}
                        </span>
                      </td>
                      <td>{n.stats?.targetCount || 0}</td>
                      <td>{n.stats?.sentCount || 0}</td>
                      <td>{n.stats && n.stats.sentCount > 0 ? `${Math.round((n.stats.openCount / n.stats.sentCount) * 100)}%` : "-"}</td>
                      <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                        {(n.status === "SCHEDULED" || n.status === "DRAFT") && (
                          <>
                            <button type="button" className="row-act edit" onClick={(e) => editScheduled(n, e)}>編集</button>
                            <button type="button" className="row-act del" onClick={(e) => cancelScheduled(n.id, e)}>削除</button>
                          </>
                        )}
                      </td>
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
