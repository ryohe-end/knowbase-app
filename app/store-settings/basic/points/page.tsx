"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StoreSelector from "@/components/StoreSelector";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import { ToastProvider, useToast } from "@/components/Toast";

// --- 型 ---
type PointTxType = "earned" | "used" | "expired" | "adjusted" | "refunded";

type PointTransaction = {
  id: string;
  occurredAt: string;
  type: PointTxType;
  points: number;
  balanceAfter: number;
  source: string;
  reference?: string;
  note?: string;
  operatorName?: string;
};

type MemberPointInfo = {
  memberCode: string;
  memberName: string;
  email: string | null;
  phone: string | null;
  joinedAt: string;
  status: "active" | "dormant" | "withdrawn";
  currentBalance: number;
  lifetimeEarned: number;
  lifetimeUsed: number;
  lifetimeExpired: number;
  expiringNextMonth: number;
  expiringIn3Months: number;
  transactions: PointTransaction[];
};

type StoreSummary = {
  clubCode: string;
  clubName: string;
  brand: string;
  businessType: string;
  prefecture: string;
};

type RecentTransaction = {
  id: string;
  memberCode: string;
  memberName: string;
  type: PointTxType;
  points: number;
  occurredAt: string;
  source: string;
};

type PointsSummary = {
  totalMembers: number;
  totalActiveBalance: number;
  expiringNextMonth: number;
  thisMonthEarned: number;
  thisMonthUsed: number;
  thisMonthExpired: number;
  todayTransactions: number;
  todayEarned: number;
  todayUsed: number;
  byType: { type: PointTxType; count: number; total: number }[];
  dailyTrend: { date: string; earned: number; used: number }[];
  topMembers: { memberCode: string; memberName: string; balance: number }[];
  recentTransactions: RecentTransaction[];
};

type TabKey = "member" | "dashboard";

// --- 定数 ---
const TX_META: Record<PointTxType, { label: string; color: string; bg: string; sign: string }> = {
  earned: { label: "付与", color: "#047857", bg: "#d1fae5", sign: "+" },
  used: { label: "利用", color: "#1d4ed8", bg: "#dbeafe", sign: "" },
  expired: { label: "失効", color: "#64748b", bg: "#e2e8f0", sign: "" },
  adjusted: { label: "調整", color: "#b45309", bg: "#fef3c7", sign: "" },
  refunded: { label: "返還", color: "#7c3aed", bg: "#ede9fe", sign: "+" },
};

// --- ヘルパー ---
function formatPoints(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("ja-JP")}pt`;
}
function formatBalance(n: number): string {
  return `${n.toLocaleString("ja-JP")} pt`;
}
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}
function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

// --- 会員検索タブ ---
function MemberSearchTab({ clubCode }: { clubCode: string }) {
  const { showToast } = useToast();
  const [memberCodeInput, setMemberCodeInput] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [member, setMember] = useState<MemberPointInfo | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | PointTxType>("all");

  const doSearch = useCallback(
    async (code: string, demo: boolean) => {
      const trimmed = code.trim();
      if (!trimmed) {
        showToast("会員番号を入力してください。", "error");
        return;
      }
      setLoading(true);
      setSearched(true);
      try {
        const q = new URLSearchParams({ clubCode, memberCode: trimmed });
        if (demo) q.set("demo", "1");
        const res = await fetch(`/api/store-settings/points/member?${q}`);
        if (res.ok) {
          const data = await res.json();
          setMember(data.member);
          setIsDemo(!!data.isDemo);
        }
      } catch (e) {
        console.error(e);
        showToast("検索に失敗しました。", "error");
      } finally {
        setLoading(false);
      }
    },
    [clubCode, showToast]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(memberCodeInput, false);
  };

  const filteredTx = useMemo(() => {
    if (!member) return [];
    if (typeFilter === "all") return member.transactions;
    return member.transactions.filter((t) => t.type === typeFilter);
  }, [member, typeFilter]);

  return (
    <>
      <section className="pt-search-card">
        <form className="pt-search-form" onSubmit={handleSubmit}>
          <div className="pt-search-label">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 18, height: 18 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span>会員番号で検索</span>
          </div>
          <input
            type="text"
            className="pt-search-input"
            placeholder="例: M012345"
            value={memberCodeInput}
            onChange={(e) => setMemberCodeInput(e.target.value)}
            autoFocus
          />
          <button type="submit" className="pt-search-btn" disabled={loading}>
            {loading ? "検索中..." : "検索"}
          </button>
          <button
            type="button"
            className="pt-search-demo"
            onClick={() => doSearch(memberCodeInput || "M012345", true)}
          >
            サンプル表示
          </button>
        </form>
        <div className="pt-search-hint">
          会員番号を入力して、その会員のポイント変動履歴を確認できます。
        </div>
      </section>

      {!searched && (
        <section className="pt-empty-state">
          <div className="pt-empty-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 64, height: 64 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <div className="pt-empty-text">
            会員番号を検索すると、ここにポイント変動履歴が表示されます。
          </div>
        </section>
      )}

      {searched && loading && !member && (
        <section className="pt-empty-state">
          <div className="pt-empty-text">検索中...</div>
        </section>
      )}

      {searched && !loading && !member && (
        <section className="pt-empty-state">
          <div className="pt-empty-icon error">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 64, height: 64 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div className="pt-empty-text">
            会員番号「<strong>{memberCodeInput}</strong>」の情報は見つかりませんでした。
          </div>
          <button
            type="button"
            className="pt-empty-btn"
            onClick={() => doSearch(memberCodeInput || "M012345", true)}
          >
            サンプルデータで表示
          </button>
        </section>
      )}

      {member && (
        <>
          {/* 会員情報サマリー */}
          <section className="pt-member-card">
            {isDemo && <div className="pt-demo-banner">サンプルデータを表示中</div>}
            <div className="pt-member-top">
              <div className="pt-member-id">
                <div className="pt-member-avatar">{member.memberName.charAt(0)}</div>
                <div>
                  <div className="pt-member-name">{member.memberName}</div>
                  <div className="pt-member-meta">
                    <code className="pt-member-code">{member.memberCode}</code>
                    <span className={`pt-member-status status-${member.status}`}>
                      {member.status === "active" ? "稼働中" : member.status === "dormant" ? "休会中" : "退会済"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="pt-balance-big">
                <span className="pt-balance-label">現在残高</span>
                <span className="pt-balance-value">{formatBalance(member.currentBalance)}</span>
              </div>
            </div>

            <div className="pt-member-stats">
              <div className="pt-stat">
                <div className="pt-stat-label">累計付与</div>
                <div className="pt-stat-value earned">{formatBalance(member.lifetimeEarned)}</div>
              </div>
              <div className="pt-stat">
                <div className="pt-stat-label">累計利用</div>
                <div className="pt-stat-value used">{formatBalance(member.lifetimeUsed)}</div>
              </div>
              <div className="pt-stat">
                <div className="pt-stat-label">累計失効</div>
                <div className="pt-stat-value expired">{formatBalance(member.lifetimeExpired)}</div>
              </div>
              <div className="pt-stat">
                <div className="pt-stat-label">来月失効予定</div>
                <div className="pt-stat-value warn">{formatBalance(member.expiringNextMonth)}</div>
              </div>
            </div>

            <div className="pt-member-contact">
              {member.email && (
                <div className="pt-contact-item">
                  <span className="pt-contact-label">メール:</span>
                  <span>{member.email}</span>
                </div>
              )}
              {member.phone && (
                <div className="pt-contact-item">
                  <span className="pt-contact-label">電話:</span>
                  <span>{member.phone}</span>
                </div>
              )}
              <div className="pt-contact-item">
                <span className="pt-contact-label">入会日:</span>
                <span>{formatDate(member.joinedAt)}</span>
              </div>
            </div>
          </section>

          {/* トランザクション履歴 */}
          <section className="pt-list-card">
            <div className="pt-list-header">
              <h2 className="pt-list-title">
                ポイント変動履歴
                <span className="pt-count">{filteredTx.length}</span>
              </h2>
              <div className="pt-tx-filters">
                <button
                  type="button"
                  className={`pt-filter-chip ${typeFilter === "all" ? "active" : ""}`}
                  onClick={() => setTypeFilter("all")}
                >
                  すべて
                </button>
                {(["earned", "used", "expired", "adjusted"] as PointTxType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`pt-filter-chip ${typeFilter === t ? "active" : ""}`}
                    onClick={() => setTypeFilter(t)}
                  >
                    {TX_META[t].label}
                  </button>
                ))}
              </div>
            </div>

            {filteredTx.length === 0 ? (
              <div className="pt-empty-inline">該当する履歴はありません。</div>
            ) : (
              <div className="pt-table-wrap">
                <table className="pt-table">
                  <thead>
                    <tr>
                      <th>日時</th>
                      <th>種別</th>
                      <th style={{ textAlign: "right" }}>変動</th>
                      <th style={{ textAlign: "right" }}>残高</th>
                      <th>取得元</th>
                      <th>参照ID</th>
                      <th>担当</th>
                      <th>備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTx.map((t) => (
                      <tr key={t.id}>
                        <td className="pt-date-cell">{formatDateTime(t.occurredAt)}</td>
                        <td>
                          <span
                            className="pt-type-chip"
                            style={{ color: TX_META[t.type].color, background: TX_META[t.type].bg }}
                          >
                            {TX_META[t.type].label}
                          </span>
                        </td>
                        <td className={`pt-pts-cell ${t.points >= 0 ? "pos" : "neg"}`}>
                          {formatPoints(t.points)}
                        </td>
                        <td className="pt-bal-cell">{formatBalance(t.balanceAfter)}</td>
                        <td className="pt-src-cell">{t.source}</td>
                        <td>
                          {t.reference ? <code className="pt-ref">{t.reference}</code> : <span className="pt-na">—</span>}
                        </td>
                        <td className="pt-op-cell">{t.operatorName ?? <span className="pt-na">—</span>}</td>
                        <td className="pt-note-cell">{t.note ?? <span className="pt-na">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

// --- ダッシュボードタブ ---
function DashboardTab({ clubCode }: { clubCode: string }) {
  const [summary, setSummary] = useState<PointsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const fetchData = useCallback(
    async (demo: boolean) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ clubCode });
        if (demo) q.set("demo", "1");
        const res = await fetch(`/api/store-settings/points/summary?${q}`);
        if (res.ok) {
          const data = await res.json();
          setSummary(data.summary || null);
          setIsDemo(!!data.isDemo);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [clubCode]
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const maxTrend = useMemo(() => {
    if (!summary) return 1;
    return Math.max(
      1,
      ...summary.dailyTrend.flatMap((d) => [d.earned, d.used])
    );
  }, [summary]);

  return (
    <>
      <div className="pt-dash-actions">
        {isDemo && <span className="pt-demo-badge">サンプルデータ表示中</span>}
        <button
          type="button"
          className="pt-demo-btn"
          onClick={() => fetchData(!isDemo)}
        >
          {isDemo ? "実データに戻す" : "サンプルを表示"}
        </button>
      </div>

      {/* サマリー */}
      <section className="pt-summary-grid">
        <SummaryCard
          label="今月の付与"
          value={summary ? formatBalance(summary.thisMonthEarned) : "—"}
          sub={summary ? `本日: ${formatBalance(summary.todayEarned)}` : ""}
          color="#10b981"
          loading={loading}
        />
        <SummaryCard
          label="今月の利用"
          value={summary ? formatBalance(summary.thisMonthUsed) : "—"}
          sub={summary ? `本日: ${formatBalance(summary.todayUsed)}` : ""}
          color="#3b82f6"
          loading={loading}
        />
        <SummaryCard
          label="保有ポイント総額"
          value={summary ? formatBalance(summary.totalActiveBalance) : "—"}
          sub={summary ? `会員数: ${summary.totalMembers.toLocaleString("ja-JP")}` : ""}
          color="#8b5cf6"
          loading={loading}
        />
        <SummaryCard
          label="来月失効予定"
          value={summary ? formatBalance(summary.expiringNextMonth) : "—"}
          sub={summary ? `今月失効: ${formatBalance(summary.thisMonthExpired)}` : ""}
          color="#f59e0b"
          loading={loading}
        />
      </section>

      {/* トレンドチャート */}
      <section className="pt-trend-card">
        <h3 className="pt-section-title">過去14日間のポイント変動</h3>
        {summary && summary.dailyTrend.length > 0 ? (
          <div className="pt-trend-chart">
            {summary.dailyTrend.map((d, i) => (
              <div key={i} className="pt-trend-day">
                <div className="pt-trend-bars">
                  <div
                    className="pt-trend-bar earned"
                    style={{ height: `${(d.earned / maxTrend) * 100}%` }}
                    title={`付与: ${d.earned}pt`}
                  />
                  <div
                    className="pt-trend-bar used"
                    style={{ height: `${(d.used / maxTrend) * 100}%` }}
                    title={`利用: ${d.used}pt`}
                  />
                </div>
                <div className="pt-trend-date">{d.date}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="pt-mini-empty">データがありません</div>
        )}
        <div className="pt-trend-legend">
          <span className="pt-legend-item">
            <span className="pt-legend-dot earned" />
            付与
          </span>
          <span className="pt-legend-item">
            <span className="pt-legend-dot used" />
            利用
          </span>
        </div>
      </section>

      {/* 内訳 + トップ会員 */}
      <section className="pt-breakdown-grid">
        <div className="pt-breakdown-card">
          <h3 className="pt-section-title">種別内訳 (今月)</h3>
          {summary && summary.byType.length > 0 ? (
            <div className="pt-bd-list">
              {summary.byType.map((b) => {
                const max = Math.max(...summary.byType.map((x) => x.total), 1);
                const w = (b.total / max) * 100;
                return (
                  <div key={b.type} className="pt-bd-row">
                    <span
                      className="pt-type-chip"
                      style={{ color: TX_META[b.type].color, background: TX_META[b.type].bg }}
                    >
                      {TX_META[b.type].label}
                    </span>
                    <div className="pt-bd-track">
                      <div
                        className="pt-bd-fill"
                        style={{ width: `${w}%`, background: TX_META[b.type].color }}
                      />
                    </div>
                    <span className="pt-bd-value">
                      {b.count}件 / {b.total.toLocaleString("ja-JP")}pt
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="pt-mini-empty">データがありません</div>
          )}
        </div>

        <div className="pt-breakdown-card">
          <h3 className="pt-section-title">保有ポイント TOP 5</h3>
          {summary && summary.topMembers.length > 0 ? (
            <ol className="pt-top-list">
              {summary.topMembers.map((m, idx) => (
                <li key={m.memberCode} className="pt-top-row">
                  <span className={`pt-top-rank rank-${idx + 1}`}>{idx + 1}</span>
                  <div className="pt-top-info">
                    <div className="pt-top-name">{m.memberName}</div>
                    <code className="pt-top-code">{m.memberCode}</code>
                  </div>
                  <span className="pt-top-balance">{formatBalance(m.balance)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="pt-mini-empty">データがありません</div>
          )}
        </div>
      </section>

      {/* 直近トランザクション */}
      <section className="pt-list-card">
        <div className="pt-list-header">
          <h2 className="pt-list-title">
            直近のポイント変動
            <span className="pt-count">{summary?.recentTransactions.length ?? 0}</span>
          </h2>
        </div>

        {summary && summary.recentTransactions.length > 0 ? (
          <div className="pt-table-wrap">
            <table className="pt-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>会員</th>
                  <th>種別</th>
                  <th style={{ textAlign: "right" }}>変動</th>
                  <th>取得元</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentTransactions.map((t) => (
                  <tr key={t.id}>
                    <td className="pt-date-cell">{formatDateTime(t.occurredAt)}</td>
                    <td>
                      <div className="pt-recent-member">
                        <span className="pt-recent-name">{t.memberName}</span>
                        <code className="pt-recent-code">{t.memberCode}</code>
                      </div>
                    </td>
                    <td>
                      <span
                        className="pt-type-chip"
                        style={{ color: TX_META[t.type].color, background: TX_META[t.type].bg }}
                      >
                        {TX_META[t.type].label}
                      </span>
                    </td>
                    <td className={`pt-pts-cell ${t.points >= 0 ? "pos" : "neg"}`}>
                      {formatPoints(t.points)}
                    </td>
                    <td className="pt-src-cell">{t.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pt-empty-inline">
            {loading ? "読み込み中..." : "ポイント変動データはまだありません。"}
          </div>
        )}
      </section>
    </>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  color,
  loading,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="pt-summary-card">
      <div className="pt-summary-bar" style={{ background: color }} />
      <div className="pt-summary-body">
        <div className="pt-summary-label">{label}</div>
        <div className="pt-summary-value">{loading ? "—" : value}</div>
        {sub && <div className="pt-summary-sub">{sub}</div>}
      </div>
    </div>
  );
}

// --- メインエディタ ---
function PointsManager({ clubCode, initialTab }: { clubCode: string; initialTab: TabKey }) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [store, setStore] = useState<StoreSummary | null>(null);
  const [loadingStore, setLoadingStore] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/store-settings/stores");
        if (res.ok) {
          const data = await res.json();
          const matched = (data.stores || []).find((s: StoreSummary) => s.clubCode === clubCode);
          if (matched) setStore(matched);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingStore(false);
      }
    };
    run();
  }, [clubCode]);

  return (
    <div className="pt-root">
      <AdminLoadingOverlay visible={loadingStore} text="読み込み中..." />

      <header className="pt-header">
        <div className="pt-header-inner">
          <Link href={`/store-settings/basic?clubCode=${clubCode}`} className="pt-back-link">
            <span>←</span>
            <span>メニューへ戻る</span>
          </Link>
          <h1 className="pt-page-title">ポイント管理</h1>
          <div style={{ width: 120 }} />
        </div>
      </header>

      <main className="pt-main">
        <section className="pt-store-card">
          <div className="pt-store-left">
            <span className="pt-store-label">対象店舗</span>
            <div className="pt-store-name-row">
              <span className="pt-store-code">{clubCode}</span>
              <span className="pt-store-name">{store?.clubName ?? "—"}</span>
            </div>
          </div>
          <div className="pt-store-right">
            {store?.brand && (
              <span className={`pt-brand-badge ${store.brand.toUpperCase().startsWith("JOYFIT") ? "joyfit" : "fit365"}`}>
                {store.brand}
              </span>
            )}
          </div>
        </section>

        <div className="pt-tabs">
          <button
            type="button"
            className={`pt-tab ${tab === "member" ? "active" : ""}`}
            onClick={() => setTab("member")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            会員検索
          </button>
          <button
            type="button"
            className={`pt-tab ${tab === "dashboard" ? "active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            ダッシュボード
          </button>
        </div>

        {tab === "member" ? (
          <MemberSearchTab clubCode={clubCode} />
        ) : (
          <DashboardTab clubCode={clubCode} />
        )}
      </main>

      <style jsx global>{`
        .pt-root {
          background: linear-gradient(160deg, #ecfdf5 0%, #f8fafc 40%, #d1fae5 100%);
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
          color: #0f172a;
        }
        .pt-header {
          height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(180%);
          border-bottom: 1px solid rgba(226,232,240,0.8); position: sticky; top: 0; z-index: 200;
        }
        .pt-header-inner { max-width: 1280px; margin: 0 auto; padding: 0 24px; height: 100%; display: flex; align-items: center; justify-content: space-between; }
        .pt-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; padding: 6px 12px; border-radius: 8px; transition: 0.15s; display: flex; align-items: center; gap: 6px; }
        .pt-back-link:hover { background: #f1f5f9; color: #334155; }
        .pt-page-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; }

        .pt-main { max-width: 1280px; margin: 0 auto; padding: 24px 24px 80px; }

        /* 店舗カード */
        .pt-store-card {
          background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
          padding: 18px 24px; display: flex; justify-content: space-between; align-items: center;
          gap: 16px; flex-wrap: wrap; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .pt-store-left { display: flex; flex-direction: column; gap: 6px; }
        .pt-store-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .pt-store-name-row { display: flex; align-items: center; gap: 10px; }
        .pt-store-code { background: #1e293b; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-family: "SF Mono", monospace; font-weight: 700; }
        .pt-store-name { font-size: 16px; font-weight: 700; color: #1e293b; }
        .pt-brand-badge { font-size: 12px; font-weight: 800; padding: 6px 14px; border-radius: 99px; border: 1.5px solid; }
        .pt-brand-badge.fit365 { color: #be185d; border-color: #f9a8d4; background: #fdf2f8; }
        .pt-brand-badge.joyfit { color: #1d4ed8; border-color: #93c5fd; background: #eff6ff; }

        /* タブ */
        .pt-tabs { display: flex; gap: 4px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px; margin-bottom: 20px; width: fit-content; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .pt-tab { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 9px; font-size: 13px; font-weight: 700; background: transparent; color: #64748b; border: none; cursor: pointer; transition: 0.15s; }
        .pt-tab:hover { color: #1e293b; background: #f8fafc; }
        .pt-tab.active { background: linear-gradient(135deg, #10b981, #047857); color: #fff; box-shadow: 0 2px 6px rgba(16,185,129,0.3); }
        .pt-tab.active:hover { background: linear-gradient(135deg, #10b981, #047857); color: #fff; }

        /* 検索フォーム */
        .pt-search-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .pt-search-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .pt-search-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #047857; }
        .pt-search-input { flex: 1; min-width: 240px; padding: 11px 14px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 14px; outline: none; transition: 0.15s; font-family: inherit; }
        .pt-search-input:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.1); }
        .pt-search-btn { padding: 10px 22px; border-radius: 10px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, #10b981, #047857); color: #fff; border: none; cursor: pointer; box-shadow: 0 2px 6px rgba(16,185,129,0.3); transition: 0.15s; }
        .pt-search-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .pt-search-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16,185,129,0.4); }
        .pt-search-demo { padding: 10px 16px; border-radius: 10px; font-size: 12px; font-weight: 700; background: #ecfdf5; color: #047857; border: 1.5px solid #a7f3d0; cursor: pointer; transition: 0.15s; }
        .pt-search-demo:hover { background: #d1fae5; border-color: #6ee7b7; }
        .pt-search-hint { font-size: 12px; color: #94a3b8; margin-top: 10px; }

        /* 空状態 */
        .pt-empty-state { background: #fff; border: 1px dashed #cbd5e1; border-radius: 14px; padding: 60px 30px; text-align: center; }
        .pt-empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 96px; height: 96px; border-radius: 24px; background: #d1fae5; color: #10b981; margin-bottom: 16px; }
        .pt-empty-icon.error { background: #fef2f2; color: #dc2626; }
        .pt-empty-text { font-size: 14px; color: #64748b; line-height: 1.7; margin-bottom: 16px; }
        .pt-empty-text strong { color: #1e293b; }
        .pt-empty-btn { background: #ecfdf5; border: 1.5px solid #a7f3d0; color: #047857; padding: 10px 22px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; transition: 0.15s; }
        .pt-empty-btn:hover { background: #d1fae5; }
        .pt-empty-inline { font-size: 13px; color: #94a3b8; padding: 24px; text-align: center; background: #f8fafc; border-radius: 10px; }

        /* 会員カード */
        .pt-member-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; overflow: hidden; }
        .pt-demo-banner { background: linear-gradient(90deg, #fef3c7, #fde68a); border: 1px solid #fcd34d; color: #92400e; font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 8px; margin-bottom: 16px; display: inline-block; }
        .pt-member-top { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9; margin-bottom: 20px; }
        .pt-member-id { display: flex; align-items: center; gap: 14px; }
        .pt-member-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #047857); color: #fff; font-size: 22px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
        .pt-member-name { font-size: 18px; font-weight: 800; color: #0f172a; margin-bottom: 6px; }
        .pt-member-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .pt-member-code { background: #f1f5f9; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-family: "SF Mono", monospace; color: #475569; font-weight: 700; }
        .pt-member-status { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }
        .pt-member-status.status-active { background: #d1fae5; color: #047857; }
        .pt-member-status.status-dormant { background: #fef3c7; color: #b45309; }
        .pt-member-status.status-withdrawn { background: #fee2e2; color: #dc2626; }
        .pt-balance-big { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
        .pt-balance-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .pt-balance-value { font-size: 32px; font-weight: 800; color: #047857; font-variant-numeric: tabular-nums; line-height: 1; }

        .pt-member-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .pt-stat { background: #f8fafc; border-radius: 10px; padding: 12px 14px; }
        .pt-stat-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
        .pt-stat-value { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .pt-stat-value.earned { color: #047857; }
        .pt-stat-value.used { color: #1d4ed8; }
        .pt-stat-value.expired { color: #64748b; }
        .pt-stat-value.warn { color: #b45309; }

        .pt-member-contact { display: flex; gap: 20px; flex-wrap: wrap; padding-top: 16px; border-top: 1px dashed #e2e8f0; }
        .pt-contact-item { font-size: 13px; color: #475569; display: flex; gap: 6px; }
        .pt-contact-label { color: #94a3b8; font-weight: 600; }

        /* リスト */
        .pt-list-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .pt-list-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
        .pt-list-title { margin: 0; font-size: 16px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 10px; }
        .pt-count { background: #f1f5f9; color: #64748b; font-size: 12px; padding: 2px 10px; border-radius: 99px; font-weight: 700; }

        .pt-tx-filters { display: flex; gap: 6px; flex-wrap: wrap; }
        .pt-filter-chip { font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 99px; background: #f1f5f9; color: #64748b; border: 1.5px solid transparent; cursor: pointer; transition: 0.15s; }
        .pt-filter-chip:hover { background: #e2e8f0; color: #334155; }
        .pt-filter-chip.active { background: #d1fae5; color: #047857; border-color: #6ee7b7; }

        .pt-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
        .pt-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
        .pt-table th { background: #f8fafc; text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
        .pt-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .pt-table tr:last-child td { border-bottom: none; }
        .pt-table tbody tr:hover { background: #f8fafc; }
        .pt-date-cell { font-size: 12px; color: #475569; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .pt-type-chip { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; white-space: nowrap; }
        .pt-pts-cell { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .pt-pts-cell.pos { color: #047857; }
        .pt-pts-cell.neg { color: #b91c1c; }
        .pt-bal-cell { text-align: right; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .pt-src-cell { color: #475569; white-space: nowrap; }
        .pt-ref { background: #f1f5f9; padding: 3px 7px; border-radius: 5px; font-size: 11px; font-family: "SF Mono", monospace; color: #475569; font-weight: 600; }
        .pt-op-cell { font-size: 12px; color: #475569; white-space: nowrap; }
        .pt-note-cell { font-size: 12px; color: #64748b; }
        .pt-na { color: #cbd5e1; }
        .pt-recent-member { display: flex; flex-direction: column; gap: 2px; }
        .pt-recent-name { font-weight: 700; color: #1e293b; font-size: 13px; }
        .pt-recent-code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-family: "SF Mono", monospace; color: #64748b; font-weight: 600; width: fit-content; }

        /* ダッシュボード */
        .pt-dash-actions { display: flex; justify-content: flex-end; gap: 10px; align-items: center; margin-bottom: 16px; }
        .pt-demo-badge { font-size: 11px; font-weight: 700; color: #1d4ed8; background: #eff6ff; border: 1px solid #93c5fd; padding: 4px 10px; border-radius: 99px; }
        .pt-demo-btn { background: #fff; border: 1.5px solid #e2e8f0; color: #475569; padding: 7px 14px; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; transition: 0.15s; }
        .pt-demo-btn:hover { background: #f8fafc; border-color: #cbd5e1; }

        .pt-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .pt-summary-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; display: flex; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .pt-summary-bar { width: 4px; }
        .pt-summary-body { padding: 16px 20px; flex: 1; }
        .pt-summary-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .pt-summary-value { font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.2; font-variant-numeric: tabular-nums; }
        .pt-summary-sub { font-size: 12px; font-weight: 600; color: #64748b; margin-top: 6px; }

        .pt-section-title { margin: 0 0 16px 0; font-size: 14px; font-weight: 800; color: #1e293b; }

        /* トレンド */
        .pt-trend-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .pt-trend-chart { display: flex; align-items: flex-end; gap: 6px; height: 160px; padding: 8px 4px; border-bottom: 1px solid #f1f5f9; }
        .pt-trend-day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; }
        .pt-trend-bars { display: flex; gap: 2px; align-items: flex-end; width: 100%; height: 100%; justify-content: center; }
        .pt-trend-bar { width: 40%; min-height: 2px; border-radius: 3px 3px 0 0; transition: opacity 0.15s; }
        .pt-trend-bar:hover { opacity: 0.8; }
        .pt-trend-bar.earned { background: linear-gradient(180deg, #34d399, #10b981); }
        .pt-trend-bar.used { background: linear-gradient(180deg, #60a5fa, #3b82f6); }
        .pt-trend-date { font-size: 10px; font-weight: 600; color: #94a3b8; }
        .pt-trend-legend { display: flex; gap: 16px; justify-content: center; margin-top: 12px; }
        .pt-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #475569; }
        .pt-legend-dot { width: 12px; height: 12px; border-radius: 3px; }
        .pt-legend-dot.earned { background: #10b981; }
        .pt-legend-dot.used { background: #3b82f6; }
        .pt-mini-empty { font-size: 12px; color: #94a3b8; padding: 30px; text-align: center; }

        /* 内訳 */
        .pt-breakdown-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; margin-bottom: 20px; }
        @media (max-width: 900px) { .pt-breakdown-grid { grid-template-columns: 1fr; } }
        .pt-breakdown-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .pt-bd-list { display: flex; flex-direction: column; gap: 10px; }
        .pt-bd-row { display: grid; grid-template-columns: 70px 1fr 160px; gap: 12px; align-items: center; font-size: 12px; }
        .pt-bd-track { height: 8px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .pt-bd-fill { height: 100%; border-radius: 99px; transition: width 0.3s; }
        .pt-bd-value { font-weight: 600; color: #1e293b; text-align: right; font-variant-numeric: tabular-nums; }

        /* トップ */
        .pt-top-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .pt-top-row { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-bottom: 1px solid #f1f5f9; }
        .pt-top-row:last-child { border-bottom: none; }
        .pt-top-rank { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: #64748b; background: #f1f5f9; }
        .pt-top-rank.rank-1 { background: linear-gradient(135deg, #fbbf24, #d97706); color: #fff; }
        .pt-top-rank.rank-2 { background: linear-gradient(135deg, #cbd5e1, #94a3b8); color: #fff; }
        .pt-top-rank.rank-3 { background: linear-gradient(135deg, #fdba74, #c2410c); color: #fff; }
        .pt-top-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .pt-top-name { font-size: 13px; font-weight: 700; color: #1e293b; }
        .pt-top-code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-family: "SF Mono", monospace; color: #64748b; font-weight: 600; width: fit-content; }
        .pt-top-balance { font-size: 14px; font-weight: 800; color: #047857; font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  );
}

function PointsRouter() {
  const searchParams = useSearchParams();
  const clubCode = searchParams.get("clubCode");
  const viewParam = searchParams.get("view");
  const tab: TabKey = viewParam === "dashboard" ? "dashboard" : "member";

  if (!clubCode) {
    return (
      <StoreSelector
        basePath="/store-settings/basic/points"
        title="ポイント管理 - 店舗選択"
        backHref="/store-settings"
        backLabel="メニューへ戻る"
      />
    );
  }

  return (
    <ToastProvider>
      <PointsManager clubCode={clubCode} initialTab={tab} />
    </ToastProvider>
  );
}

export default function PointsPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f8fafc" }} />}>
      <PointsRouter />
    </Suspense>
  );
}
