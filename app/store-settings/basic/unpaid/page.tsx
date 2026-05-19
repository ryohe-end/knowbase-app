"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StoreSelector from "@/components/StoreSelector";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import { ToastProvider, useToast } from "@/components/Toast";

// --- 型 ---
type UnpaidCategory = "monthly_fee" | "option" | "onetime_pass" | "penalty" | "other";
type UnpaidStatus = "unpaid" | "reminded" | "negotiating" | "paid" | "written_off";

type UnpaidItem = {
  id: string;
  occurredAt: string;
  dueAt: string;
  category: UnpaidCategory;
  amount: number;
  description: string;
  status: UnpaidStatus;
  lastRemindedAt: string | null;
  remindCount: number;
  paidAt: string | null;
  paymentMethod: string | null;
  note: string | null;
};

type PaymentRecord = {
  id: string;
  paidAt: string;
  amount: number;
  method: string;
  reference: string | null;
};

type MemberUnpaidInfo = {
  memberCode: string;
  memberName: string;
  email: string | null;
  phone: string | null;
  joinedAt: string;
  status: "active" | "dormant" | "withdrawn";
  totalUnpaid: number;
  unpaidCount: number;
  oldestUnpaidAt: string | null;
  lifetimePaid: number;
  items: UnpaidItem[];
  paymentHistory: PaymentRecord[];
};

type StoreSummary = {
  clubCode: string;
  clubName: string;
  brand: string;
  businessType: string;
  prefecture: string;
};

type AgingBucket = {
  key: "0-30" | "31-60" | "61-90" | "91+";
  label: string;
  count: number;
  amount: number;
};

type UnpaidSummary = {
  totalUnpaidAmount: number;
  totalUnpaidMembers: number;
  totalUnpaidCount: number;
  thisMonthOccurred: number;
  thisMonthCollected: number;
  collectionRate: number;
  averageDaysOverdue: number;
  oldestUnpaidDays: number;
  aging: AgingBucket[];
  byCategory: { category: UnpaidCategory; count: number; amount: number }[];
  monthlyTrend: { month: string; occurred: number; collected: number }[];
  topUnpaid: { memberCode: string; memberName: string; amount: number; oldestUnpaidAt: string; unpaidCount: number }[];
  recentReminders: { id: string; memberCode: string; memberName: string; amount: number; remindedAt: string; channel: "email" | "sms" | "phone" | "letter" }[];
};

type TabKey = "member" | "dashboard";

// --- 定数 ---
const CATEGORY_META: Record<UnpaidCategory, { label: string; color: string; bg: string }> = {
  monthly_fee: { label: "会費", color: "#b91c1c", bg: "#fee2e2" },
  option: { label: "オプション", color: "#7c3aed", bg: "#ede9fe" },
  onetime_pass: { label: "都度利用", color: "#b45309", bg: "#fef3c7" },
  penalty: { label: "遅延手数料", color: "#be185d", bg: "#fdf2f8" },
  other: { label: "その他", color: "#475569", bg: "#f1f5f9" },
};

const STATUS_META: Record<UnpaidStatus, { label: string; color: string; bg: string }> = {
  unpaid: { label: "未納", color: "#b91c1c", bg: "#fee2e2" },
  reminded: { label: "督促中", color: "#b45309", bg: "#fef3c7" },
  negotiating: { label: "交渉中", color: "#7c3aed", bg: "#ede9fe" },
  paid: { label: "支払済", color: "#047857", bg: "#d1fae5" },
  written_off: { label: "貸倒", color: "#64748b", bg: "#e2e8f0" },
};

const CHANNEL_META: Record<"email" | "sms" | "phone" | "letter", string> = {
  email: "メール",
  sms: "SMS",
  phone: "電話",
  letter: "郵送",
};

// --- ヘルパー ---
function formatYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
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
function daysSince(iso: string): number {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (24 * 3600 * 1000));
}

// --- 個人別タブ ---
function MemberTab({ clubCode }: { clubCode: string }) {
  const { showToast } = useToast();
  const [memberCodeInput, setMemberCodeInput] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [member, setMember] = useState<MemberUnpaidInfo | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | UnpaidStatus>("all");

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
        const res = await fetch(`/api/store-settings/unpaid/member?${q}`);
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

  const filteredItems = useMemo(() => {
    if (!member) return [];
    if (statusFilter === "all") return member.items;
    return member.items.filter((i) => i.status === statusFilter);
  }, [member, statusFilter]);

  return (
    <>
      <section className="up-search-card">
        <form className="up-search-form" onSubmit={handleSubmit}>
          <div className="up-search-label">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 18, height: 18 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span>会員番号で検索</span>
          </div>
          <input
            type="text"
            className="up-search-input"
            placeholder="例: M012345"
            value={memberCodeInput}
            onChange={(e) => setMemberCodeInput(e.target.value)}
            autoFocus
          />
          <button type="submit" className="up-search-btn" disabled={loading}>
            {loading ? "検索中..." : "検索"}
          </button>
          <button
            type="button"
            className="up-search-demo"
            onClick={() => doSearch(memberCodeInput || "M012345", true)}
          >
            サンプル表示
          </button>
        </form>
        <div className="up-search-hint">
          会員番号を入力して、その会員の未納明細・督促履歴・支払履歴を確認できます。
        </div>
      </section>

      {!searched && (
        <section className="up-empty-state">
          <div className="up-empty-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 64, height: 64 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="up-empty-text">
            会員番号を検索すると、ここに未納金の明細が表示されます。
          </div>
        </section>
      )}

      {searched && !loading && !member && (
        <section className="up-empty-state">
          <div className="up-empty-icon error">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 64, height: 64 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div className="up-empty-text">
            会員番号「<strong>{memberCodeInput}</strong>」の未納情報は見つかりませんでした。
          </div>
          <button
            type="button"
            className="up-empty-btn"
            onClick={() => doSearch(memberCodeInput || "M012345", true)}
          >
            サンプルデータで表示
          </button>
        </section>
      )}

      {member && (
        <>
          {/* 会員サマリー */}
          <section className="up-member-card">
            {isDemo && <div className="up-demo-banner">サンプルデータを表示中</div>}

            <div className="up-member-top">
              <div className="up-member-id">
                <div className="up-member-avatar">{member.memberName.charAt(0)}</div>
                <div>
                  <div className="up-member-name">{member.memberName}</div>
                  <div className="up-member-meta">
                    <code className="up-member-code">{member.memberCode}</code>
                    <span className={`up-member-status status-${member.status}`}>
                      {member.status === "active" ? "稼働中" : member.status === "dormant" ? "休会中" : "退会済"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="up-balance-big">
                <span className="up-balance-label">未納合計</span>
                <span className={`up-balance-value ${member.totalUnpaid > 0 ? "danger" : "ok"}`}>
                  {formatYen(member.totalUnpaid)}
                </span>
                {member.totalUnpaid > 0 && (
                  <span className="up-balance-sub">{member.unpaidCount}件 未処理</span>
                )}
              </div>
            </div>

            <div className="up-member-stats">
              <div className="up-stat">
                <div className="up-stat-label">最古の未納</div>
                <div className="up-stat-value">
                  {member.oldestUnpaidAt ? (
                    <>
                      {daysSince(member.oldestUnpaidAt)}<span className="up-stat-unit">日経過</span>
                    </>
                  ) : (
                    "—"
                  )}
                </div>
                {member.oldestUnpaidAt && (
                  <div className="up-stat-sub">{formatDate(member.oldestUnpaidAt)}〜</div>
                )}
              </div>
              <div className="up-stat">
                <div className="up-stat-label">未納件数</div>
                <div className="up-stat-value warn">{member.unpaidCount}</div>
                <div className="up-stat-sub">件</div>
              </div>
              <div className="up-stat">
                <div className="up-stat-label">累計支払額</div>
                <div className="up-stat-value paid">{formatYen(member.lifetimePaid)}</div>
              </div>
              <div className="up-stat">
                <div className="up-stat-label">入会日</div>
                <div className="up-stat-value plain">{formatDate(member.joinedAt)}</div>
              </div>
            </div>

            <div className="up-member-contact">
              {member.email && (
                <div className="up-contact-item">
                  <span className="up-contact-label">メール:</span>
                  <span>{member.email}</span>
                </div>
              )}
              {member.phone && (
                <div className="up-contact-item">
                  <span className="up-contact-label">電話:</span>
                  <span>{member.phone}</span>
                </div>
              )}
            </div>
          </section>

          {/* 明細リスト */}
          <section className="up-list-card">
            <div className="up-list-header">
              <h2 className="up-list-title">
                未納金明細
                <span className="up-count">{filteredItems.length}</span>
              </h2>
              <div className="up-tx-filters">
                <button
                  type="button"
                  className={`up-filter-chip ${statusFilter === "all" ? "active" : ""}`}
                  onClick={() => setStatusFilter("all")}
                >
                  すべて
                </button>
                {(["unpaid", "reminded", "negotiating", "paid"] as UnpaidStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`up-filter-chip ${statusFilter === s ? "active" : ""}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <div className="up-empty-inline">該当する明細はありません。</div>
            ) : (
              <div className="up-table-wrap">
                <table className="up-table">
                  <thead>
                    <tr>
                      <th>発生日</th>
                      <th>経過</th>
                      <th>支払期限</th>
                      <th>種別</th>
                      <th>内容</th>
                      <th style={{ textAlign: "right" }}>金額</th>
                      <th>督促</th>
                      <th>ステータス</th>
                      <th>支払日</th>
                      <th>備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((it) => {
                      const days = it.status === "paid" ? null : daysSince(it.occurredAt);
                      return (
                        <tr key={it.id}>
                          <td className="up-date-cell">{formatDate(it.occurredAt)}</td>
                          <td className="up-aging-cell">
                            {days !== null ? (
                              <span className={`up-aging-pill ${days > 90 ? "high" : days > 60 ? "mid" : days > 30 ? "low" : "ok"}`}>
                                {days}日
                              </span>
                            ) : (
                              <span className="up-na">—</span>
                            )}
                          </td>
                          <td className="up-date-cell">{formatDate(it.dueAt)}</td>
                          <td>
                            <span
                              className="up-cat-chip"
                              style={{ color: CATEGORY_META[it.category].color, background: CATEGORY_META[it.category].bg }}
                            >
                              {CATEGORY_META[it.category].label}
                            </span>
                          </td>
                          <td className="up-desc-cell">{it.description}</td>
                          <td className="up-amount-cell">{formatYen(it.amount)}</td>
                          <td>
                            {it.remindCount > 0 ? (
                              <div className="up-remind-cell">
                                <span className="up-remind-count">{it.remindCount}回</span>
                                {it.lastRemindedAt && (
                                  <span className="up-remind-date">{formatDate(it.lastRemindedAt)}</span>
                                )}
                              </div>
                            ) : (
                              <span className="up-na">—</span>
                            )}
                          </td>
                          <td>
                            <span
                              className="up-status-chip"
                              style={{ color: STATUS_META[it.status].color, background: STATUS_META[it.status].bg }}
                            >
                              {STATUS_META[it.status].label}
                            </span>
                          </td>
                          <td className="up-date-cell">
                            {it.paidAt ? formatDate(it.paidAt) : <span className="up-na">—</span>}
                          </td>
                          <td className="up-note-cell">{it.note ?? <span className="up-na">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 支払履歴 */}
          {member.paymentHistory.length > 0 && (
            <section className="up-list-card">
              <div className="up-list-header">
                <h2 className="up-list-title">
                  支払履歴
                  <span className="up-count">{member.paymentHistory.length}</span>
                </h2>
              </div>
              <div className="up-table-wrap">
                <table className="up-table">
                  <thead>
                    <tr>
                      <th>支払日</th>
                      <th style={{ textAlign: "right" }}>金額</th>
                      <th>支払方法</th>
                      <th>参照ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {member.paymentHistory.map((p) => (
                      <tr key={p.id}>
                        <td className="up-date-cell">{formatDateTime(p.paidAt)}</td>
                        <td className="up-amount-cell paid">{formatYen(p.amount)}</td>
                        <td className="up-pay-cell">{p.method}</td>
                        <td>
                          {p.reference ? <code className="up-ref">{p.reference}</code> : <span className="up-na">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

// --- ダッシュボードタブ ---
function DashboardTab({ clubCode }: { clubCode: string }) {
  const [summary, setSummary] = useState<UnpaidSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const fetchData = useCallback(
    async (demo: boolean) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ clubCode });
        if (demo) q.set("demo", "1");
        const res = await fetch(`/api/store-settings/unpaid/summary?${q}`);
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
      ...summary.monthlyTrend.flatMap((d) => [d.occurred, d.collected])
    );
  }, [summary]);

  return (
    <>
      <div className="up-dash-actions">
        {isDemo && <span className="up-demo-badge">サンプルデータ表示中</span>}
        <button
          type="button"
          className="up-demo-btn"
          onClick={() => fetchData(!isDemo)}
        >
          {isDemo ? "実データに戻す" : "サンプルを表示"}
        </button>
      </div>

      {/* サマリー */}
      <section className="up-summary-grid">
        <SummaryCard
          label="未納総額"
          value={summary ? formatYen(summary.totalUnpaidAmount) : "—"}
          sub={summary ? `${summary.totalUnpaidMembers}名 / ${summary.totalUnpaidCount}件` : ""}
          color="#ef4444"
          loading={loading}
        />
        <SummaryCard
          label="今月発生"
          value={summary ? formatYen(summary.thisMonthOccurred) : "—"}
          sub=""
          color="#f59e0b"
          loading={loading}
        />
        <SummaryCard
          label="今月回収"
          value={summary ? formatYen(summary.thisMonthCollected) : "—"}
          sub={summary ? `回収率: ${summary.collectionRate}%` : ""}
          color="#10b981"
          loading={loading}
        />
        <SummaryCard
          label="平均経過日数"
          value={summary ? `${summary.averageDaysOverdue}日` : "—"}
          sub={summary ? `最古: ${summary.oldestUnpaidDays}日` : ""}
          color="#8b5cf6"
          loading={loading}
        />
      </section>

      {/* エイジング分析 */}
      <section className="up-aging-card">
        <h3 className="up-section-title">エイジング分析 (経過日数別未納金)</h3>
        {summary && summary.aging.some((a) => a.count > 0) ? (
          <div className="up-aging-grid">
            {summary.aging.map((b) => {
              const max = Math.max(...summary.aging.map((x) => x.amount), 1);
              const w = (b.amount / max) * 100;
              const colorClass = b.key === "91+" ? "high" : b.key === "61-90" ? "mid" : b.key === "31-60" ? "low" : "ok";
              return (
                <div key={b.key} className={`up-aging-row aging-${colorClass}`}>
                  <div className="up-aging-info">
                    <span className="up-aging-label">{b.label}</span>
                    <span className="up-aging-count">{b.count}件</span>
                  </div>
                  <div className="up-aging-bar-track">
                    <div className={`up-aging-bar-fill aging-${colorClass}`} style={{ width: `${w}%` }} />
                  </div>
                  <span className="up-aging-amount">{formatYen(b.amount)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="up-mini-empty">未納データがありません</div>
        )}
      </section>

      {/* 月次トレンド */}
      <section className="up-trend-card">
        <h3 className="up-section-title">月次トレンド (直近6ヶ月)</h3>
        {summary && summary.monthlyTrend.length > 0 ? (
          <>
            <div className="up-trend-chart">
              {summary.monthlyTrend.map((d, i) => (
                <div key={i} className="up-trend-month">
                  <div className="up-trend-bars">
                    <div
                      className="up-trend-bar occurred"
                      style={{ height: `${(d.occurred / maxTrend) * 100}%` }}
                      title={`発生: ${formatYen(d.occurred)}`}
                    />
                    <div
                      className="up-trend-bar collected"
                      style={{ height: `${(d.collected / maxTrend) * 100}%` }}
                      title={`回収: ${formatYen(d.collected)}`}
                    />
                  </div>
                  <div className="up-trend-label">{d.month}</div>
                </div>
              ))}
            </div>
            <div className="up-trend-legend">
              <span className="up-legend-item">
                <span className="up-legend-dot occurred" />
                発生額
              </span>
              <span className="up-legend-item">
                <span className="up-legend-dot collected" />
                回収額
              </span>
            </div>
          </>
        ) : (
          <div className="up-mini-empty">データがありません</div>
        )}
      </section>

      {/* 種別内訳 + TOP未納者 */}
      <section className="up-breakdown-grid">
        <div className="up-breakdown-card">
          <h3 className="up-section-title">種別内訳</h3>
          {summary && summary.byCategory.length > 0 ? (
            <div className="up-bd-list">
              {summary.byCategory.map((c) => {
                const max = Math.max(...summary.byCategory.map((x) => x.amount), 1);
                const w = (c.amount / max) * 100;
                return (
                  <div key={c.category} className="up-bd-row">
                    <span
                      className="up-cat-chip"
                      style={{ color: CATEGORY_META[c.category].color, background: CATEGORY_META[c.category].bg }}
                    >
                      {CATEGORY_META[c.category].label}
                    </span>
                    <div className="up-bd-track">
                      <div
                        className="up-bd-fill"
                        style={{ width: `${w}%`, background: CATEGORY_META[c.category].color }}
                      />
                    </div>
                    <span className="up-bd-value">
                      {c.count}件 / {formatYen(c.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="up-mini-empty">データがありません</div>
          )}
        </div>

        <div className="up-breakdown-card">
          <h3 className="up-section-title">未納額 TOP 5</h3>
          {summary && summary.topUnpaid.length > 0 ? (
            <ol className="up-top-list">
              {summary.topUnpaid.map((m, idx) => (
                <li key={m.memberCode} className="up-top-row">
                  <span className={`up-top-rank rank-${idx + 1}`}>{idx + 1}</span>
                  <div className="up-top-info">
                    <div className="up-top-name">{m.memberName}</div>
                    <div className="up-top-meta">
                      <code className="up-top-code">{m.memberCode}</code>
                      <span className="up-top-days">{daysSince(m.oldestUnpaidAt)}日経過 / {m.unpaidCount}件</span>
                    </div>
                  </div>
                  <span className="up-top-amount">{formatYen(m.amount)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="up-mini-empty">データがありません</div>
          )}
        </div>
      </section>

      {/* 直近の督促 */}
      <section className="up-list-card">
        <div className="up-list-header">
          <h2 className="up-list-title">
            直近の督促履歴
            <span className="up-count">{summary?.recentReminders.length ?? 0}</span>
          </h2>
        </div>

        {summary && summary.recentReminders.length > 0 ? (
          <div className="up-table-wrap">
            <table className="up-table">
              <thead>
                <tr>
                  <th>督促日時</th>
                  <th>会員</th>
                  <th>チャネル</th>
                  <th style={{ textAlign: "right" }}>未納額</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentReminders.map((r) => (
                  <tr key={r.id}>
                    <td className="up-date-cell">{formatDateTime(r.remindedAt)}</td>
                    <td>
                      <div className="up-recent-member">
                        <span className="up-recent-name">{r.memberName}</span>
                        <code className="up-recent-code">{r.memberCode}</code>
                      </div>
                    </td>
                    <td className="up-channel-cell">{CHANNEL_META[r.channel]}</td>
                    <td className="up-amount-cell">{formatYen(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="up-empty-inline">
            {loading ? "読み込み中..." : "督促データはまだありません。"}
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
    <div className="up-summary-card">
      <div className="up-summary-bar" style={{ background: color }} />
      <div className="up-summary-body">
        <div className="up-summary-label">{label}</div>
        <div className="up-summary-value">{loading ? "—" : value}</div>
        {sub && <div className="up-summary-sub">{sub}</div>}
      </div>
    </div>
  );
}

// --- メイン ---
function UnpaidManager({ clubCode, initialTab }: { clubCode: string; initialTab: TabKey }) {
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
    <div className="up-root">
      <AdminLoadingOverlay visible={loadingStore} text="読み込み中..." />

      <header className="up-header">
        <div className="up-header-inner">
          <Link href={`/store-settings/basic?clubCode=${clubCode}`} className="up-back-link">
            <span>←</span>
            <span>メニューへ戻る</span>
          </Link>
          <h1 className="up-page-title">未納金管理</h1>
          <div style={{ width: 120 }} />
        </div>
      </header>

      <main className="up-main">
        <section className="up-store-card">
          <div className="up-store-left">
            <span className="up-store-label">対象店舗</span>
            <div className="up-store-name-row">
              <span className="up-store-code">{clubCode}</span>
              <span className="up-store-name">{store?.clubName ?? "—"}</span>
            </div>
          </div>
          <div className="up-store-right">
            {store?.brand && (
              <span className={`up-brand-badge ${store.brand.toUpperCase().startsWith("JOYFIT") ? "joyfit" : "fit365"}`}>
                {store.brand}
              </span>
            )}
          </div>
        </section>

        <div className="up-tabs">
          <button
            type="button"
            className={`up-tab ${tab === "member" ? "active" : ""}`}
            onClick={() => setTab("member")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            個人別
          </button>
          <button
            type="button"
            className={`up-tab ${tab === "dashboard" ? "active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            ダッシュボード
          </button>
        </div>

        {tab === "member" ? <MemberTab clubCode={clubCode} /> : <DashboardTab clubCode={clubCode} />}
      </main>

      <style jsx global>{`
        .up-root {
          background: linear-gradient(160deg, #fef2f2 0%, #f8fafc 40%, #fee2e2 100%);
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
          color: #0f172a;
        }
        .up-header {
          height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(180%);
          border-bottom: 1px solid rgba(226,232,240,0.8); position: sticky; top: 0; z-index: 200;
        }
        .up-header-inner { max-width: 1280px; margin: 0 auto; padding: 0 24px; height: 100%; display: flex; align-items: center; justify-content: space-between; }
        .up-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; padding: 6px 12px; border-radius: 8px; transition: 0.15s; display: flex; align-items: center; gap: 6px; }
        .up-back-link:hover { background: #f1f5f9; color: #334155; }
        .up-page-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; }

        .up-main { max-width: 1280px; margin: 0 auto; padding: 24px 24px 80px; }

        /* 店舗カード */
        .up-store-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .up-store-left { display: flex; flex-direction: column; gap: 6px; }
        .up-store-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .up-store-name-row { display: flex; align-items: center; gap: 10px; }
        .up-store-code { background: #1e293b; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-family: "SF Mono", monospace; font-weight: 700; }
        .up-store-name { font-size: 16px; font-weight: 700; color: #1e293b; }
        .up-brand-badge { font-size: 12px; font-weight: 800; padding: 6px 14px; border-radius: 99px; border: 1.5px solid; }
        .up-brand-badge.fit365 { color: #be185d; border-color: #f9a8d4; background: #fdf2f8; }
        .up-brand-badge.joyfit { color: #1d4ed8; border-color: #93c5fd; background: #eff6ff; }

        /* タブ */
        .up-tabs { display: flex; gap: 4px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px; margin-bottom: 20px; width: fit-content; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .up-tab { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 9px; font-size: 13px; font-weight: 700; background: transparent; color: #64748b; border: none; cursor: pointer; transition: 0.15s; }
        .up-tab:hover { color: #1e293b; background: #f8fafc; }
        .up-tab.active { background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; box-shadow: 0 2px 6px rgba(239,68,68,0.3); }
        .up-tab.active:hover { background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; }

        /* 検索 */
        .up-search-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .up-search-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .up-search-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #b91c1c; }
        .up-search-input { flex: 1; min-width: 240px; padding: 11px 14px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 14px; outline: none; transition: 0.15s; font-family: inherit; }
        .up-search-input:focus { border-color: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,0.1); }
        .up-search-btn { padding: 10px 22px; border-radius: 10px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; border: none; cursor: pointer; box-shadow: 0 2px 6px rgba(239,68,68,0.3); transition: 0.15s; }
        .up-search-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .up-search-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239,68,68,0.4); }
        .up-search-demo { padding: 10px 16px; border-radius: 10px; font-size: 12px; font-weight: 700; background: #fef2f2; color: #b91c1c; border: 1.5px solid #fecaca; cursor: pointer; transition: 0.15s; }
        .up-search-demo:hover { background: #fee2e2; border-color: #fca5a5; }
        .up-search-hint { font-size: 12px; color: #94a3b8; margin-top: 10px; }

        /* 空状態 */
        .up-empty-state { background: #fff; border: 1px dashed #cbd5e1; border-radius: 14px; padding: 60px 30px; text-align: center; }
        .up-empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 96px; height: 96px; border-radius: 24px; background: #fee2e2; color: #ef4444; margin-bottom: 16px; }
        .up-empty-icon.error { background: #fef2f2; color: #dc2626; }
        .up-empty-text { font-size: 14px; color: #64748b; line-height: 1.7; margin-bottom: 16px; }
        .up-empty-text strong { color: #1e293b; }
        .up-empty-btn { background: #fef2f2; border: 1.5px solid #fecaca; color: #b91c1c; padding: 10px 22px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; transition: 0.15s; }
        .up-empty-btn:hover { background: #fee2e2; }
        .up-empty-inline { font-size: 13px; color: #94a3b8; padding: 24px; text-align: center; background: #f8fafc; border-radius: 10px; }

        /* 会員カード */
        .up-member-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .up-demo-banner { background: linear-gradient(90deg, #fef3c7, #fde68a); border: 1px solid #fcd34d; color: #92400e; font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 8px; margin-bottom: 16px; display: inline-block; }
        .up-member-top { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9; margin-bottom: 20px; }
        .up-member-id { display: flex; align-items: center; gap: 14px; }
        .up-member-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; font-size: 22px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
        .up-member-name { font-size: 18px; font-weight: 800; color: #0f172a; margin-bottom: 6px; }
        .up-member-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .up-member-code { background: #f1f5f9; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-family: "SF Mono", monospace; color: #475569; font-weight: 700; }
        .up-member-status { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }
        .up-member-status.status-active { background: #d1fae5; color: #047857; }
        .up-member-status.status-dormant { background: #fef3c7; color: #b45309; }
        .up-member-status.status-withdrawn { background: #fee2e2; color: #dc2626; }
        .up-balance-big { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
        .up-balance-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .up-balance-value { font-size: 32px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; }
        .up-balance-value.danger { color: #b91c1c; }
        .up-balance-value.ok { color: #047857; }
        .up-balance-sub { font-size: 12px; font-weight: 700; color: #b91c1c; background: #fee2e2; padding: 3px 10px; border-radius: 99px; margin-top: 4px; }

        .up-member-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .up-stat { background: #f8fafc; border-radius: 10px; padding: 12px 14px; }
        .up-stat-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
        .up-stat-value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; color: #0f172a; }
        .up-stat-value.warn { color: #b91c1c; }
        .up-stat-value.paid { color: #047857; font-size: 17px; }
        .up-stat-value.plain { color: #1e293b; font-size: 14px; }
        .up-stat-unit { font-size: 12px; color: #64748b; margin-left: 4px; font-weight: 600; }
        .up-stat-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }

        .up-member-contact { display: flex; gap: 20px; flex-wrap: wrap; padding-top: 16px; border-top: 1px dashed #e2e8f0; }
        .up-contact-item { font-size: 13px; color: #475569; display: flex; gap: 6px; }
        .up-contact-label { color: #94a3b8; font-weight: 600; }

        /* リスト */
        .up-list-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .up-list-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
        .up-list-title { margin: 0; font-size: 16px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 10px; }
        .up-count { background: #f1f5f9; color: #64748b; font-size: 12px; padding: 2px 10px; border-radius: 99px; font-weight: 700; }

        .up-tx-filters { display: flex; gap: 6px; flex-wrap: wrap; }
        .up-filter-chip { font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 99px; background: #f1f5f9; color: #64748b; border: 1.5px solid transparent; cursor: pointer; transition: 0.15s; }
        .up-filter-chip:hover { background: #e2e8f0; color: #334155; }
        .up-filter-chip.active { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }

        .up-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
        .up-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 1000px; }
        .up-table th { background: #f8fafc; text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
        .up-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .up-table tr:last-child td { border-bottom: none; }
        .up-table tbody tr:hover { background: #f8fafc; }
        .up-date-cell { font-size: 12px; color: #475569; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .up-aging-cell { white-space: nowrap; }
        .up-aging-pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 99px; }
        .up-aging-pill.ok { background: #f1f5f9; color: #475569; }
        .up-aging-pill.low { background: #fef3c7; color: #b45309; }
        .up-aging-pill.mid { background: #fed7aa; color: #c2410c; }
        .up-aging-pill.high { background: #fee2e2; color: #b91c1c; }
        .up-cat-chip { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; white-space: nowrap; }
        .up-desc-cell { color: #1e293b; font-weight: 600; }
        .up-amount-cell { text-align: right; font-weight: 800; color: #b91c1c; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .up-amount-cell.paid { color: #047857; }
        .up-remind-cell { display: flex; flex-direction: column; gap: 2px; }
        .up-remind-count { font-size: 12px; font-weight: 700; color: #b45309; }
        .up-remind-date { font-size: 10px; color: #94a3b8; }
        .up-status-chip { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; white-space: nowrap; }
        .up-note-cell { font-size: 12px; color: #64748b; }
        .up-pay-cell { font-size: 12px; color: #475569; white-space: nowrap; }
        .up-ref { background: #f1f5f9; padding: 3px 7px; border-radius: 5px; font-size: 11px; font-family: "SF Mono", monospace; color: #475569; font-weight: 600; }
        .up-na { color: #cbd5e1; }
        .up-recent-member { display: flex; flex-direction: column; gap: 2px; }
        .up-recent-name { font-weight: 700; color: #1e293b; font-size: 13px; }
        .up-recent-code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-family: "SF Mono", monospace; color: #64748b; font-weight: 600; width: fit-content; }
        .up-channel-cell { font-size: 12px; color: #475569; }

        /* ダッシュボード */
        .up-dash-actions { display: flex; justify-content: flex-end; gap: 10px; align-items: center; margin-bottom: 16px; }
        .up-demo-badge { font-size: 11px; font-weight: 700; color: #1d4ed8; background: #eff6ff; border: 1px solid #93c5fd; padding: 4px 10px; border-radius: 99px; }
        .up-demo-btn { background: #fff; border: 1.5px solid #e2e8f0; color: #475569; padding: 7px 14px; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; transition: 0.15s; }
        .up-demo-btn:hover { background: #f8fafc; border-color: #cbd5e1; }

        .up-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .up-summary-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; display: flex; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .up-summary-bar { width: 4px; }
        .up-summary-body { padding: 16px 20px; flex: 1; }
        .up-summary-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .up-summary-value { font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.2; font-variant-numeric: tabular-nums; }
        .up-summary-sub { font-size: 12px; font-weight: 600; color: #64748b; margin-top: 6px; }

        .up-section-title { margin: 0 0 16px 0; font-size: 14px; font-weight: 800; color: #1e293b; }

        /* エイジング */
        .up-aging-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .up-aging-grid { display: flex; flex-direction: column; gap: 12px; }
        .up-aging-row { display: grid; grid-template-columns: 140px 1fr 140px; gap: 16px; align-items: center; padding: 10px 14px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; }
        .up-aging-row.aging-high { background: #fef2f2; border-color: #fecaca; }
        .up-aging-row.aging-mid { background: #fff7ed; border-color: #fed7aa; }
        .up-aging-row.aging-low { background: #fffbeb; border-color: #fde68a; }
        .up-aging-info { display: flex; flex-direction: column; gap: 2px; }
        .up-aging-label { font-size: 13px; font-weight: 700; color: #1e293b; }
        .up-aging-count { font-size: 11px; color: #64748b; font-weight: 600; }
        .up-aging-bar-track { height: 10px; background: #fff; border-radius: 99px; overflow: hidden; border: 1px solid #e2e8f0; }
        .up-aging-bar-fill { height: 100%; border-radius: 99px; transition: width 0.3s; }
        .up-aging-bar-fill.aging-ok { background: linear-gradient(90deg, #94a3b8, #64748b); }
        .up-aging-bar-fill.aging-low { background: linear-gradient(90deg, #fbbf24, #d97706); }
        .up-aging-bar-fill.aging-mid { background: linear-gradient(90deg, #fb923c, #c2410c); }
        .up-aging-bar-fill.aging-high { background: linear-gradient(90deg, #ef4444, #b91c1c); }
        .up-aging-amount { font-weight: 800; color: #0f172a; text-align: right; font-variant-numeric: tabular-nums; font-size: 14px; }

        /* トレンド */
        .up-trend-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .up-trend-chart { display: flex; align-items: flex-end; gap: 12px; height: 180px; padding: 8px 4px; border-bottom: 1px solid #f1f5f9; }
        .up-trend-month { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; }
        .up-trend-bars { display: flex; gap: 4px; align-items: flex-end; width: 100%; height: 100%; justify-content: center; }
        .up-trend-bar { width: 40%; min-height: 2px; border-radius: 4px 4px 0 0; transition: opacity 0.15s; }
        .up-trend-bar:hover { opacity: 0.8; }
        .up-trend-bar.occurred { background: linear-gradient(180deg, #fca5a5, #ef4444); }
        .up-trend-bar.collected { background: linear-gradient(180deg, #6ee7b7, #10b981); }
        .up-trend-label { font-size: 11px; font-weight: 600; color: #64748b; }
        .up-trend-legend { display: flex; gap: 16px; justify-content: center; margin-top: 12px; }
        .up-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #475569; }
        .up-legend-dot { width: 12px; height: 12px; border-radius: 3px; }
        .up-legend-dot.occurred { background: #ef4444; }
        .up-legend-dot.collected { background: #10b981; }
        .up-mini-empty { font-size: 12px; color: #94a3b8; padding: 30px; text-align: center; }

        /* 内訳 */
        .up-breakdown-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; margin-bottom: 20px; }
        @media (max-width: 900px) { .up-breakdown-grid { grid-template-columns: 1fr; } }
        .up-breakdown-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .up-bd-list { display: flex; flex-direction: column; gap: 10px; }
        .up-bd-row { display: grid; grid-template-columns: 100px 1fr 160px; gap: 12px; align-items: center; font-size: 12px; }
        .up-bd-track { height: 8px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .up-bd-fill { height: 100%; border-radius: 99px; transition: width 0.3s; }
        .up-bd-value { font-weight: 600; color: #1e293b; text-align: right; font-variant-numeric: tabular-nums; }

        /* トップ */
        .up-top-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .up-top-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid #f1f5f9; }
        .up-top-row:last-child { border-bottom: none; }
        .up-top-rank { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: #64748b; background: #f1f5f9; flex-shrink: 0; }
        .up-top-rank.rank-1 { background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; }
        .up-top-rank.rank-2 { background: linear-gradient(135deg, #fb923c, #c2410c); color: #fff; }
        .up-top-rank.rank-3 { background: linear-gradient(135deg, #fbbf24, #d97706); color: #fff; }
        .up-top-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .up-top-name { font-size: 13px; font-weight: 700; color: #1e293b; }
        .up-top-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .up-top-code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-family: "SF Mono", monospace; color: #64748b; font-weight: 600; }
        .up-top-days { font-size: 11px; color: #94a3b8; }
        .up-top-amount { font-size: 14px; font-weight: 800; color: #b91c1c; font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  );
}

function UnpaidRouter() {
  const searchParams = useSearchParams();
  const clubCode = searchParams.get("clubCode");
  const viewParam = searchParams.get("view");
  const tab: TabKey = viewParam === "dashboard" ? "dashboard" : "member";

  if (!clubCode) {
    return (
      <StoreSelector
        basePath="/store-settings/basic/unpaid"
        title="未納金管理 - 店舗選択"
        backHref="/store-settings"
        backLabel="メニューへ戻る"
      />
    );
  }

  return (
    <ToastProvider>
      <UnpaidManager clubCode={clubCode} initialTab={tab} />
    </ToastProvider>
  );
}

export default function UnpaidPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f8fafc" }} />}>
      <UnpaidRouter />
    </Suspense>
  );
}
