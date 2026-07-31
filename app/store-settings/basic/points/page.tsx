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
  cancelledBy?: string;
  cancelledAt?: string;
};

const POINT_REASONS = ["歩数", "イベント", "パーソナルトレーニング", "ボーナス", "その他"] as const;
type PointReason = typeof POINT_REASONS[number];

// CPSS変動履歴の1行 (期間指定 + ページ送り)
type HistoryRow = {
  id: string;
  occurredAt: string;
  type: PointTxType;
  points: number;
  status?: string | null;    // AVA/CAN
  cancelled?: boolean;
  source: string;
  shopid?: string | null;
  hid?: string;
  operatorName?: string | null;
  note?: string | null;
  cancellableTxId?: string | null;  // knowbase由来かつ取消可能なら DDB transactionId
};
// knowbie付与の取消(txId) と 外部/利用の取消(hid) の両対応
type CancelTarget = {
  txId?: string;          // knowbie付与の取消 (DDB transactionId)
  hid?: string;           // 外部/利用の取消 (CPSS hid)
  external?: boolean;
  txType?: PointTxType;   // used/earned など (方向の文言に使用)
  points: number;
  occurredAt: string;
  source: string;
};

// 外部(CPSS由来)取消の取消可能期間(日)。サーバ側 POINTS_EXTERNAL_CANCEL_MAX_AGE_DAYS と揃える。
const EXTERNAL_CANCEL_MAX_AGE_DAYS = 92;
// 外部取消の対象行か: 未取消 & hidあり & knowbie付与でない(=既存ボタン対象外) & 期間内
function canExternalCancel(t: HistoryRow): boolean {
  if (t.cancelled || t.status === "CAN") return false;
  if (t.cancellableTxId) return false; // knowbie付与は既存の取消ボタンで対応
  if (!t.hid) return false;
  const ts = new Date(t.occurredAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return (Date.now() - ts) / 86400000 <= EXTERNAL_CANCEL_MAX_AGE_DAYS;
}

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

  // 実データ(RDS/CPSS)連携
  plan?: string | null;          // 会員区分
  withdrawnAt?: string | null;   // 退会日
  tenureLabel?: string | null;   // 継続期間
  rank?: string | null;
  rankName?: string | null;      // CPSS ランク名
  age?: number | null;
  brand?: "JOYFIT" | "FIT365";
  cpssAvailable?: boolean;
  cpssError?: string | null;
};

type StoreSummary = {
  clubCode: string;
  clubName: string;
  brand: string;
  businessType: string;
  prefecture: string;
};

type Bucket = { granted: number; used: number; members: number };
type SummaryData = {
  ok: boolean;
  clubCode: string;
  brand: "JOYFIT" | "FIT365";
  month: string;
  available: boolean;
  updatedAt: string | null;
  current: {
    granted: number; used: number; grantedCount: number; usedCount: number; memberCount: number;
    byGender: Record<string, Bucket>;
    byAge: Record<string, Bucket>;
    byRank: Record<string, Bucket>;
    avgTenureMonths: number | null;
    avgEarnToUseDays: number | null;
    earnToUseSamples: number;
  } | null;
  compare: {
    prevMonth: { granted: number; used: number } | null;
    prevYear: { granted: number; used: number } | null;
    grantedMoM: number | null; usedMoM: number | null;
    grantedYoY: number | null; usedYoY: number | null;
  };
  monthly: { ym: string; granted: number; used: number; memberCount: number }[];
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
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// 既定期間 = 直近3ヶ月
function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 3);
  return { from: ymd(from), to: ymd(to) };
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

  // 変動履歴 (CPSS期間指定 + 50行ページ送り)
  const initPeriod = useMemo(() => defaultPeriod(), []);
  const [fromDate, setFromDate] = useState(initPeriod.from);
  const [toDate, setToDate] = useState(initPeriod.to);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);

  // 付与モーダル
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantPoints, setGrantPoints] = useState("");
  const [grantReason, setGrantReason] = useState<PointReason>("歩数");
  const [grantNote, setGrantNote] = useState("");
  const [granting, setGranting] = useState(false);

  // 取消モーダル
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // CPSS変動履歴の取得 (実データ会員のみ)
  const fetchHistory = useCallback(
    async (code: string, p: number, from: string, to: string) => {
      setHistLoading(true);
      setHistErr(null);
      try {
        const q = new URLSearchParams({ memberCode: code, from, to, page: String(p) });
        const res = await fetch(`/api/store-settings/points/history?${q}`);
        const data = await res.json();
        if (res.ok && data.ok) {
          setHistory(data.rows || []);
          setHasNext(!!data.hasNext);
          setPage(data.page || p);
        } else {
          setHistory([]);
          setHasNext(false);
          setHistErr(data?.error || "履歴の取得に失敗しました");
        }
      } catch (e) {
        console.error(e);
        setHistory([]);
        setHasNext(false);
        setHistErr("履歴の取得に失敗しました");
      } finally {
        setHistLoading(false);
      }
    },
    []
  );

  const doSearch = useCallback(
    async (code: string, demo: boolean) => {
      const trimmed = code.trim();
      if (!trimmed) {
        showToast("会員番号を入力してください。", "error");
        return;
      }
      setLoading(true);
      setSearched(true);
      setPage(1);
      setHistory([]);
      setHistErr(null);
      try {
        const q = new URLSearchParams({ clubCode, memberCode: trimmed });
        if (demo) q.set("demo", "1");
        const res = await fetch(`/api/store-settings/points/member?${q}`);
        if (res.ok) {
          const data = await res.json();
          setMember(data.member);
          setIsDemo(!!data.isDemo);
          if (data.member && !data.isDemo) {
            fetchHistory(trimmed, 1, fromDate, toDate);
          }
        }
      } catch (e) {
        console.error(e);
        showToast("検索に失敗しました。", "error");
      } finally {
        setLoading(false);
      }
    },
    [clubCode, showToast, fetchHistory, fromDate, toDate]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(memberCodeInput, false);
  };

  // 期間の適用 (1ページ目から再取得)
  const applyPeriod = () => {
    if (fromDate && toDate && fromDate > toDate) {
      showToast("開始日は終了日以前にしてください。", "error");
      return;
    }
    if (member && !isDemo) fetchHistory(member.memberCode, 1, fromDate, toDate);
  };
  const gotoPage = (p: number) => {
    if (member && !isDemo && p >= 1) fetchHistory(member.memberCode, p, fromDate, toDate);
  };

  // 表示行: 実データは /history(サーバページ)、サンプルは member.transactions を種別フィルタ
  const displayRows: HistoryRow[] = useMemo(() => {
    if (isDemo) {
      const src = member?.transactions ?? [];
      const filtered = typeFilter === "all" ? src : src.filter((t) => t.type === typeFilter);
      return filtered.map((t) => ({
        id: t.id, occurredAt: t.occurredAt, type: t.type, points: t.points,
        status: null, cancelled: !!t.cancelledBy, source: t.source, shopid: null,
        hid: "", operatorName: t.operatorName ?? null, note: t.note ?? null,
        cancellableTxId: t.type === "earned" && !t.cancelledBy ? t.id : null,
      }));
    }
    if (typeFilter === "all") return history;
    return history.filter((t) => t.type === typeFilter);
  }, [isDemo, member, typeFilter, history]);

  // 付与実行
  const doGrant = async () => {
    if (!member) return;
    const pts = Number(grantPoints.replace(/[^\d]/g, ""));
    if (!Number.isFinite(pts) || pts <= 0) {
      showToast("ポイントを正の整数で入力してください。", "error");
      return;
    }
    setGranting(true);
    try {
      const res = await fetch("/api/store-settings/points/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grant",
          clubCode,
          memberCode: member.memberCode,
          points: pts,
          reason: grantReason,
          note: grantNote || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "付与失敗");
      showToast(`${pts}pt を付与しました。`, "success");
      setGrantOpen(false);
      setGrantPoints("");
      setGrantNote("");
      // 再取得
      await doSearch(member.memberCode, isDemo);
    } catch (e: any) {
      showToast(e?.message || "付与に失敗しました。", "error");
    } finally {
      setGranting(false);
    }
  };

  // 取り消し実行
  const doCancel = async () => {
    if (!member || !cancelTarget) return;
    // 外部取消は理由必須
    if (cancelTarget.external && !cancelNote.trim()) {
      showToast("取消理由を入力してください。", "error");
      return;
    }
    setCancelling(true);
    try {
      const payload = cancelTarget.external
        ? {
            action: "cancelExternal",
            clubCode,
            memberCode: member.memberCode,
            hid: cancelTarget.hid,
            occurredAt: cancelTarget.occurredAt,
            note: cancelNote,
          }
        : {
            action: "cancel",
            clubCode,
            memberCode: member.memberCode,
            sourceTransactionId: cancelTarget.txId,
            note: cancelNote || undefined,
          };
      const res = await fetch("/api/store-settings/points/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "取り消し失敗");
      showToast(`${formatPoints(cancelTarget.points)} を取り消しました。`, "success");
      setCancelTarget(null);
      setCancelNote("");
      await doSearch(member.memberCode, isDemo);
    } catch (e: any) {
      showToast(e?.message || "取り消しに失敗しました。", "error");
    } finally {
      setCancelling(false);
    }
  };

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
            placeholder="例: 5110001234"
            value={memberCodeInput}
            onChange={(e) => setMemberCodeInput(e.target.value)}
            autoFocus
          />
          <button type="submit" className="pt-search-btn" disabled={loading}>
            {loading ? "検索中..." : "検索"}
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
                      {member.status === "active" ? "現行" : member.status === "dormant" ? "休会中" : "退会"}
                    </span>
                    {member.plan && <span className="pt-member-plan">{member.plan}</span>}
                    {member.rankName && <span className="pt-member-rank">★ {member.rankName}</span>}
                  </div>
                </div>
              </div>
              <div className="pt-balance-big">
                <span className="pt-balance-label">現在残高</span>
                <span className="pt-balance-value">{formatBalance(member.currentBalance)}</span>
                <button
                  type="button"
                  className="pt-grant-btn"
                  onClick={() => setGrantOpen(true)}
                >
                  + ポイント付与
                </button>
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
              {member.plan && (
                <div className="pt-contact-item">
                  <span className="pt-contact-label">会員区分:</span>
                  <span>{member.plan}</span>
                </div>
              )}
              {member.joinedAt && (
                <div className="pt-contact-item">
                  <span className="pt-contact-label">入会日:</span>
                  <span>{formatDate(member.joinedAt)}</span>
                </div>
              )}
              {member.tenureLabel && (
                <div className="pt-contact-item">
                  <span className="pt-contact-label">継続期間:</span>
                  <span>{member.tenureLabel}</span>
                </div>
              )}
              {member.status === "withdrawn" && member.withdrawnAt && (
                <div className="pt-contact-item">
                  <span className="pt-contact-label">退会日:</span>
                  <span>{formatDate(member.withdrawnAt)}</span>
                </div>
              )}
              {member.phone && (
                <div className="pt-contact-item">
                  <span className="pt-contact-label">電話:</span>
                  <span>{member.phone}</span>
                </div>
              )}
            </div>

            {!isDemo && member.cpssAvailable === false && (
              <div className="pt-cpss-warn">
                ポイント残高(CPSS)を取得できませんでした{member.cpssError ? `: ${member.cpssError}` : ""}。会員情報のみ表示しています。
              </div>
            )}
          </section>

          {/* ポイント変動履歴 (期間指定 + 50行ページ送り) */}
          <section className="pt-list-card">
            <div className="pt-list-header">
              <h2 className="pt-list-title">
                ポイント変動履歴
                {histLoading && <span className="pt-count">読込中…</span>}
              </h2>
              <div className="pt-tx-filters">
                <button
                  type="button"
                  className={`pt-filter-chip ${typeFilter === "all" ? "active" : ""}`}
                  onClick={() => setTypeFilter("all")}
                >
                  すべて
                </button>
                {(["earned", "used"] as PointTxType[]).map((t) => (
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

            {/* 期間セレクタ (サンプル表示時は無効) */}
            <div className="pt-period-bar">
              <span className="pt-period-label">期間</span>
              <input
                type="date"
                className="pt-period-input"
                value={fromDate}
                max={toDate}
                disabled={isDemo}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <span className="pt-period-tilde">〜</span>
              <input
                type="date"
                className="pt-period-input"
                value={toDate}
                min={fromDate}
                disabled={isDemo}
                onChange={(e) => setToDate(e.target.value)}
              />
              <button type="button" className="pt-period-apply" onClick={applyPeriod} disabled={isDemo || histLoading}>
                適用
              </button>
              {isDemo && <span className="pt-period-note">サンプル表示中は期間指定は使用できません</span>}
            </div>

            {histErr && !isDemo ? (
              <div className="pt-empty-inline">{histErr}</div>
            ) : displayRows.length === 0 ? (
              <div className="pt-empty-inline">
                {histLoading ? "読み込み中…" : "この期間の変動履歴はありません。"}
              </div>
            ) : (
              <>
                <div className="pt-table-wrap">
                  <table className="pt-table">
                    <thead>
                      <tr>
                        <th>日時</th>
                        <th>種別</th>
                        <th style={{ textAlign: "right" }}>変動</th>
                        <th>店舗</th>
                        <th>取得元</th>
                        <th>担当</th>
                        <th>備考</th>
                        <th style={{ width: 90 }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((t) => (
                        <tr key={t.id} className={t.cancelled ? "is-cancelled" : ""}>
                          <td className="pt-date-cell">{formatDateTime(t.occurredAt)}</td>
                          <td>
                            <span
                              className="pt-type-chip"
                              style={{ color: TX_META[t.type].color, background: TX_META[t.type].bg }}
                            >
                              {TX_META[t.type].label}
                            </span>
                            {t.cancelled && <span className="pt-cancelled-chip">取消済</span>}
                          </td>
                          <td className={`pt-pts-cell ${t.points >= 0 ? "pos" : "neg"}`}>
                            {formatPoints(t.points)}
                          </td>
                          <td className="pt-src-cell">{t.shopid ?? <span className="pt-na">—</span>}</td>
                          <td className="pt-src-cell">{t.source}</td>
                          <td className="pt-op-cell">{t.operatorName ?? <span className="pt-na">—</span>}</td>
                          <td className="pt-note-cell">{t.note ?? <span className="pt-na">—</span>}</td>
                          <td>
                            {t.cancellableTxId ? (
                              <button
                                className="pt-cancel-btn"
                                onClick={() => setCancelTarget({ txId: t.cancellableTxId!, points: t.points, occurredAt: t.occurredAt, source: t.source })}
                              >
                                取消
                              </button>
                            ) : canExternalCancel(t) ? (
                              <button
                                className="pt-cancel-btn"
                                title="外部/利用ポイントを取り消します（要理由・監査記録）"
                                onClick={() => setCancelTarget({ hid: t.hid!, external: true, txType: t.type, points: t.points, occurredAt: t.occurredAt, source: t.source })}
                              >
                                取消
                              </button>
                            ) : (
                              <span className="pt-na">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ページ送り (実データのみ / 50行単位) */}
                {!isDemo && (
                  <div className="pt-pager">
                    <button
                      type="button"
                      className="pt-pager-btn"
                      onClick={() => gotoPage(page - 1)}
                      disabled={page <= 1 || histLoading}
                    >
                      ← 前の50件
                    </button>
                    <span className="pt-pager-page">ページ {page}</span>
                    <button
                      type="button"
                      className="pt-pager-btn"
                      onClick={() => gotoPage(page + 1)}
                      disabled={!hasNext || histLoading}
                    >
                      次の50件 →
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* 付与モーダル */}
      {grantOpen && member && (
        <div className="pt-modal-overlay" onClick={() => !granting && setGrantOpen(false)}>
          <div className="pt-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pt-modal-header">
              <h3>ポイントを付与</h3>
              <p>{member.memberName} 様 ({member.memberCode}) に付与します。</p>
            </header>
            <div className="pt-modal-body">
              <div className="pt-field">
                <label>付与理由 <span style={{ color: "#ef4444" }}>*</span></label>
                <select
                  className="pt-input"
                  value={grantReason}
                  onChange={(e) => setGrantReason(e.target.value as PointReason)}
                >
                  {POINT_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="pt-field">
                <label>付与ポイント <span style={{ color: "#ef4444" }}>*</span></label>
                <div className="pt-amount-row">
                  <input
                    type="text"
                    inputMode="numeric"
                    className="pt-input pt-amount-input"
                    value={grantPoints}
                    onChange={(e) => setGrantPoints(e.target.value)}
                    placeholder="例) 500"
                  />
                  <span className="pt-amount-unit">pt</span>
                </div>
              </div>
              <div className="pt-field">
                <label>備考（任意）</label>
                <textarea
                  className="pt-input pt-textarea"
                  rows={3}
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  placeholder="例) 月間目標達成 / イベント参加賞 など"
                />
              </div>
            </div>
            <footer className="pt-modal-footer">
              <button className="pt-modal-cancel" onClick={() => setGrantOpen(false)} disabled={granting}>
                キャンセル
              </button>
              <button className="pt-modal-submit" onClick={doGrant} disabled={granting || !grantPoints}>
                {granting ? "送信中..." : "付与する"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 取消モーダル */}
      {cancelTarget && member && (
        <div className="pt-modal-overlay" onClick={() => !cancelling && setCancelTarget(null)}>
          <div className="pt-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pt-modal-header">
              <h3>{cancelTarget.external ? "ポイント取引を取り消す" : "ポイント付与を取り消す"}</h3>
              <p>
                {cancelTarget.external
                  ? cancelTarget.txType === "used"
                    ? "取り消すと利用分が会員に戻ります（残高が増えます）。元には戻せません。"
                    : "取り消すと会員残高が変わります。元には戻せません。"
                  : "取り消すと残高は減算されます。元には戻せません。"}
              </p>
            </header>
            <div className="pt-modal-body">
              {cancelTarget.external && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
                  ⚠️ これは外部システム由来の取引の取消です。会員の残高に直接影響します。理由の入力が必須で、操作は監査ログに記録されます。
                </div>
              )}
              <div className="pt-confirm-row">
                <span>対象</span>
                <span>{formatDateTime(cancelTarget.occurredAt)} / {cancelTarget.source}</span>
              </div>
              <div className="pt-confirm-row">
                <span>{cancelTarget.external ? (cancelTarget.txType === "used" ? "利用ポイント" : "対象ポイント") : "付与ポイント"}</span>
                <span style={{ fontWeight: 800, color: cancelTarget.points < 0 ? "#1d4ed8" : "#047857" }}>{formatPoints(cancelTarget.points)}</span>
              </div>
              <div className="pt-field">
                <label>取消理由{cancelTarget.external ? "（必須）" : "（任意）"}</label>
                <textarea
                  className="pt-input pt-textarea"
                  rows={3}
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  placeholder={cancelTarget.external ? "例) 二重課金 / 誤操作による利用" : "例) 入力誤り / 重複付与"}
                />
              </div>
            </div>
            <footer className="pt-modal-footer">
              <button className="pt-modal-cancel" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                戻る
              </button>
              <button
                className="pt-modal-submit pt-modal-danger"
                onClick={doCancel}
                disabled={cancelling || (cancelTarget.external && !cancelNote.trim())}
              >
                {cancelling ? "送信中..." : "取り消す"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

// --- ダッシュボードタブ ---
// --- ダッシュボードタブ (夜間集計ベースの分析) ---
function thisMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const GENDER_LABEL: Record<string, string> = { male: "男性", female: "女性", unknown: "不明" };
const GENDER_COLOR: Record<string, string> = { male: "#3b82f6", female: "#ec4899", unknown: "#94a3b8" };
function ageLabel(b: string): string {
  if (b === "unknown") return "不明";
  if (b === "0") return "〜9歳";
  if (b === "70") return "70代以上";
  return `${b}代`;
}
function DeltaBadge({ label, value }: { label: string; value: number | null }) {
  if (value == null) return <span className="pt-delta na">{label} —</span>;
  const cls = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "±";
  return <span className={`pt-delta ${cls}`}>{label} {arrow}{Math.abs(value)}%</span>;
}

function DashboardTab({ clubCode, brand }: { clubCode: string; brand?: string }) {
  const [month, setMonth] = useState<string>(thisMonthStr());
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/store-settings/points/summary?clubCode=${clubCode}&month=${m}`);
      const d = await res.json();
      setData(d?.ok ? d : null);
    } catch (e) {
      console.error(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clubCode]);

  useEffect(() => { fetchData(month); }, [fetchData, month]);

  const cur = data?.current ?? null;
  const cmp = data?.compare;
  const isFit365 = (data?.brand || brand || "").toUpperCase() === "FIT365";
  const monthly = data?.monthly ?? [];
  const maxMonthly = useMemo(() => Math.max(1, ...monthly.flatMap((m) => [m.granted, m.used])), [monthly]);
  const genderKeys = ["male", "female", "unknown"];
  const ageKeys = ["0", "10", "20", "30", "40", "50", "60", "70", "unknown"];
  const maxGender = Math.max(1, ...genderKeys.map((k) => (cur?.byGender?.[k]?.granted ?? 0)));
  const maxAge = Math.max(1, ...ageKeys.map((k) => (cur?.byAge?.[k]?.granted ?? 0)));
  const rankRows = cur ? Object.entries(cur.byRank || {}).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const maxRank = Math.max(1, ...rankRows.map(([, v]) => v.granted));

  return (
    <>
      {/* 期間セレクタ */}
      <div className="pt-dash-head">
        <div className="pt-dash-period">
          <span className="pt-period-label">対象月</span>
          <input type="month" className="pt-period-input" value={month} max={thisMonthStr()} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="pt-dash-meta">
          {loading ? "読込中…" : data?.updatedAt ? `集計: ${formatDateTime(data.updatedAt)}` : ""}
        </div>
      </div>

      {!loading && !data?.available && (
        <section className="pt-empty-state">
          <div className="pt-empty-text">
            この月の集計データはまだありません。<br />
            集計は夜間バッチで作成されます（対象店舗が本番CPSSに登録済みで、当月のポイント処理がある場合に表示されます）。
          </div>
        </section>
      )}

      {/* KPI */}
      <section className="pt-summary-grid">
        <div className="pt-kpi">
          <div className="pt-kpi-label">付与ポイント合計</div>
          <div className="pt-kpi-value earned">{cur ? formatBalance(cur.granted) : "—"}</div>
          <div className="pt-kpi-deltas">
            <DeltaBadge label="前月比" value={cmp?.grantedMoM ?? null} />
            <DeltaBadge label="昨年比" value={cmp?.grantedYoY ?? null} />
          </div>
          <div className="pt-kpi-sub">{cur ? `${cur.grantedCount.toLocaleString("ja-JP")}件` : ""}</div>
        </div>
        <div className="pt-kpi">
          <div className="pt-kpi-label">使用ポイント合計</div>
          <div className="pt-kpi-value used">{cur ? formatBalance(cur.used) : "—"}</div>
          <div className="pt-kpi-deltas">
            <DeltaBadge label="前月比" value={cmp?.usedMoM ?? null} />
            <DeltaBadge label="昨年比" value={cmp?.usedYoY ?? null} />
          </div>
          <div className="pt-kpi-sub">{cur ? `${cur.usedCount.toLocaleString("ja-JP")}件` : ""}</div>
        </div>
        <div className="pt-kpi">
          <div className="pt-kpi-label">対象会員数</div>
          <div className="pt-kpi-value">{cur ? cur.memberCount.toLocaleString("ja-JP") : "—"}</div>
          <div className="pt-kpi-sub">当月にポイント変動のあった会員</div>
        </div>
        {isFit365 && (
          <div className="pt-kpi">
            <div className="pt-kpi-label">平均継続ヶ月</div>
            <div className="pt-kpi-value">{cur?.avgTenureMonths != null ? `${cur.avgTenureMonths}ヶ月` : "—"}</div>
            <div className="pt-kpi-sub">
              {cur?.avgEarnToUseDays != null ? `取得→使用まで 平均${cur.avgEarnToUseDays}日 (${cur.earnToUseSamples}件)` : "取得→使用データなし"}
            </div>
          </div>
        )}
      </section>

      {/* 月次サマリー */}
      <section className="pt-trend-card">
        <h3 className="pt-section-title">月次サマリー（直近12ヶ月）</h3>
        <div className="pt-trend-chart">
          {monthly.map((m) => (
            <div key={m.ym} className="pt-trend-day">
              <div className="pt-trend-bars">
                <div className="pt-trend-bar earned" style={{ height: `${(m.granted / maxMonthly) * 100}%` }} title={`付与 ${m.granted.toLocaleString("ja-JP")}pt`} />
                <div className="pt-trend-bar used" style={{ height: `${(m.used / maxMonthly) * 100}%` }} title={`使用 ${m.used.toLocaleString("ja-JP")}pt`} />
              </div>
              <div className="pt-trend-date">{m.ym.slice(5)}月</div>
            </div>
          ))}
        </div>
        <div className="pt-trend-legend">
          <span className="pt-legend-item"><span className="pt-legend-dot earned" />付与</span>
          <span className="pt-legend-item"><span className="pt-legend-dot used" />使用</span>
        </div>
      </section>

      {/* 男女別 / 年代別 */}
      <section className="pt-breakdown-grid">
        <div className="pt-breakdown-card">
          <h3 className="pt-section-title">男女別（付与ポイント）</h3>
          <div className="pt-bd-list">
            {genderKeys.map((k) => {
              const v = cur?.byGender?.[k] ?? { granted: 0, used: 0, members: 0 };
              return (
                <div key={k} className="pt-bd-row">
                  <span className="pt-type-chip" style={{ color: "#fff", background: GENDER_COLOR[k] }}>{GENDER_LABEL[k]}</span>
                  <div className="pt-bd-track"><div className="pt-bd-fill" style={{ width: `${(v.granted / maxGender) * 100}%`, background: GENDER_COLOR[k] }} /></div>
                  <span className="pt-bd-value">{v.granted.toLocaleString("ja-JP")}pt / {v.members}名</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="pt-breakdown-card">
          <h3 className="pt-section-title">年代別（付与ポイント）</h3>
          <div className="pt-bd-list">
            {ageKeys.filter((k) => (cur?.byAge?.[k]?.members ?? 0) > 0).map((k) => {
              const v = cur!.byAge[k];
              return (
                <div key={k} className="pt-bd-row">
                  <span className="pt-type-chip" style={{ color: "#0369a1", background: "#e0f2fe", minWidth: 64, textAlign: "center" }}>{ageLabel(k)}</span>
                  <div className="pt-bd-track"><div className="pt-bd-fill" style={{ width: `${(v.granted / maxAge) * 100}%`, background: "#0ea5e9" }} /></div>
                  <span className="pt-bd-value">{v.granted.toLocaleString("ja-JP")}pt / {v.members}名</span>
                </div>
              );
            })}
            {cur && !ageKeys.some((k) => (cur.byAge?.[k]?.members ?? 0) > 0) && <div className="pt-mini-empty">データがありません</div>}
          </div>
        </div>
      </section>

      {/* FIT365: ランク内訳 */}
      {isFit365 && (
        <section className="pt-breakdown-card" style={{ marginBottom: 20 }}>
          <h3 className="pt-section-title">ランク内訳（FIT365 / 付与ポイント）</h3>
          {rankRows.length > 0 ? (
            <div className="pt-bd-list">
              {rankRows.map(([rk, v]) => (
                <div key={rk} className="pt-bd-row">
                  <span className="pt-type-chip" style={{ color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", minWidth: 64, textAlign: "center" }}>ランク{rk}</span>
                  <div className="pt-bd-track"><div className="pt-bd-fill" style={{ width: `${(v.granted / maxRank) * 100}%`, background: "#f59e0b" }} /></div>
                  <span className="pt-bd-value">{v.granted.toLocaleString("ja-JP")}pt / {v.members}名</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="pt-mini-empty">ランク別データがありません</div>
          )}
        </section>
      )}
    </>
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
          <Link href="/store-settings/basic/points/bulk" style={{ textDecoration: "none", background: "#047857", color: "#fff", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
            ＋ 一括付与
          </Link>
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
          <DashboardTab clubCode={clubCode} brand={store?.brand} />
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
        .pt-member-plan { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; background: #eff6ff; color: #1d4ed8; }
        .pt-member-rank { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
        .pt-cpss-warn { margin-top: 14px; padding: 10px 14px; border-radius: 10px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; font-size: 12px; font-weight: 600; }
        .pt-balance-big { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
        .pt-grant-btn { margin-top: 8px; padding: 8px 16px; border-radius: 8px; border: none; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; font-size: 12px; font-weight: 800; cursor: pointer; transition: 0.15s; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.3); }
        .pt-grant-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4); }
        .pt-cancel-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid #fecaca; background: #fff; color: #b91c1c; font-size: 11px; font-weight: 700; cursor: pointer; transition: 0.15s; }
        .pt-cancel-btn:hover { background: #fef2f2; border-color: #fca5a5; }
        .pt-cancelled-chip { margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: #e2e8f0; color: #64748b; font-size: 10px; font-weight: 700; }
        .pt-table tr.is-cancelled { opacity: 0.55; text-decoration: line-through; }
        .pt-table tr.is-cancelled .pt-cancelled-chip { text-decoration: none; }

        /* 付与/取消モーダル */
        .pt-modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; z-index: 2000; }
        .pt-modal { background: #fff; width: 90%; max-width: 480px; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
        .pt-modal-header { padding: 20px 24px 12px; border-bottom: 1px solid #e2e8f0; }
        .pt-modal-header h3 { font-size: 16px; font-weight: 800; margin: 0 0 4px; color: #0f172a; }
        .pt-modal-header p { font-size: 12px; color: #64748b; margin: 0; }
        .pt-modal-body { padding: 18px 24px; display: flex; flex-direction: column; gap: 14px; max-height: 65vh; overflow-y: auto; }
        .pt-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
        .pt-modal-cancel { background: #fff; color: #475569; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 12px; }
        .pt-modal-cancel:hover:not(:disabled) { background: #f1f5f9; }
        .pt-modal-submit { background: #047857; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 12px; }
        .pt-modal-submit:hover:not(:disabled) { background: #065f46; }
        .pt-modal-submit.pt-modal-danger { background: #b91c1c; }
        .pt-modal-submit.pt-modal-danger:hover:not(:disabled) { background: #991b1b; }
        .pt-modal-submit:disabled, .pt-modal-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
        .pt-field { display: flex; flex-direction: column; gap: 6px; }
        .pt-field label { font-size: 11px; font-weight: 700; color: #475569; }
        .pt-input { padding: 9px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 13px; background: #fff; color: #0f172a; outline: none; font-family: inherit; }
        .pt-input:focus { border-color: #047857; }
        .pt-textarea { resize: vertical; }
        .pt-amount-row { display: flex; align-items: center; gap: 8px; }
        .pt-amount-input { flex: 1; font-size: 18px; font-weight: 700; text-align: right; }
        .pt-amount-unit { font-size: 14px; font-weight: 800; color: #047857; }
        .pt-confirm-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 13px; border-bottom: 1px dashed #e2e8f0; }
        .pt-confirm-row span:first-child { color: #64748b; font-size: 11px; font-weight: 700; }
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

        /* 期間セレクタ */
        .pt-period-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
        .pt-period-label { font-size: 11px; font-weight: 700; color: #64748b; }
        .pt-period-input { padding: 7px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-family: inherit; color: #0f172a; background: #fff; }
        .pt-period-input:disabled { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }
        .pt-period-tilde { color: #94a3b8; font-weight: 700; }
        .pt-period-apply { padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #10b981, #047857); color: #fff; border: none; cursor: pointer; box-shadow: 0 2px 6px rgba(16,185,129,0.3); }
        .pt-period-apply:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
        .pt-period-note { font-size: 11px; color: #94a3b8; }

        /* ページ送り */
        .pt-pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 16px; }
        .pt-pager-btn { padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 700; background: #fff; color: #047857; border: 1.5px solid #a7f3d0; cursor: pointer; transition: 0.15s; }
        .pt-pager-btn:hover:not(:disabled) { background: #ecfdf5; }
        .pt-pager-btn:disabled { opacity: 0.4; cursor: not-allowed; color: #94a3b8; border-color: #e2e8f0; }
        .pt-pager-page { font-size: 13px; font-weight: 700; color: #475569; font-variant-numeric: tabular-nums; }

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
        .pt-dash-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
        .pt-dash-period { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .pt-dash-meta { font-size: 12px; color: #94a3b8; font-weight: 600; }
        .pt-kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 8px; }
        .pt-kpi-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .pt-kpi-value { font-size: 26px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .pt-kpi-value.earned { color: #047857; }
        .pt-kpi-value.used { color: #1d4ed8; }
        .pt-kpi-deltas { display: flex; gap: 8px; flex-wrap: wrap; }
        .pt-kpi-sub { font-size: 12px; color: #64748b; }
        .pt-delta { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 99px; white-space: nowrap; }
        .pt-delta.up { background: #dcfce7; color: #15803d; }
        .pt-delta.down { background: #fee2e2; color: #b91c1c; }
        .pt-delta.flat { background: #f1f5f9; color: #475569; }
        .pt-delta.na { background: #f8fafc; color: #cbd5e1; }
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
