"use client";

// 操作監査ログ 閲覧ページ (管理者専用)
// 誰が・いつ・何を したかを一覧。action/店舗/ユーザー/期間で絞り込み + CSV出力。
import React, { useCallback, useEffect, useMemo, useState } from "react";

type AuditLog = {
  userId: string;
  userName?: string;
  timestamp: string;
  action: string;
  resource?: string;
  clubCodes?: string[];
  targetCount?: number;
  detail?: Record<string, unknown>;
  ip?: string;
  result?: "ok" | "error";
};

// action → 日本語ラベル (前方一致で判定)
const ACTION_LABELS: { prefix: string; label: string }[] = [
  { prefix: "auth.login.failed", label: "ログイン失敗" },
  { prefix: "auth.login", label: "ログイン" },
  { prefix: "auth.logout", label: "ログアウト" },
  { prefix: "push.", label: "Push/お知らせ" },
  { prefix: "dm.", label: "DM配信" },
  { prefix: "member.extract", label: "会員抽出" },
  { prefix: "unpaid.csv", label: "未納CSV出力" },
  { prefix: "unpaid.list", label: "未納一覧表示" },
  { prefix: "refund.memberDetail", label: "返金:会員照会" },
  { prefix: "refund.", label: "返金申請" },
  { prefix: "deposit.", label: "入金申請" },
];

function actionLabel(action: string): string {
  const hit = ACTION_LABELS.find((a) => action.startsWith(a.prefix));
  return hit ? `${hit.label} (${action})` : action;
}

// action の大分類 (フィルタ選択肢)
const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "すべての操作" },
  { value: "auth.", label: "ログイン/ログアウト" },
  { value: "push.", label: "Push/お知らせ" },
  { value: "dm.", label: "DM配信" },
  { value: "member.extract", label: "会員抽出" },
  { value: "unpaid.csv", label: "未納CSV出力" },
  { value: "unpaid.list", label: "未納一覧表示" },
  { value: "refund.", label: "返金 (照会/申請/遷移)" },
  { value: "deposit.", label: "入金 (申請/遷移)" },
];

function fmtJst(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}/${p(jst.getUTCMonth() + 1)}/${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}:${p(jst.getUTCSeconds())}`;
}

function detailText(d?: Record<string, unknown>): string {
  if (!d) return "";
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" / ");
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // フィルタ
  const [action, setAction] = useState("");
  const [clubCode, setClubCode] = useState("");
  const [userId, setUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [limit, setLimit] = useState(200);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (action) q.set("action", action);
      if (clubCode.trim()) q.set("clubCode", clubCode.trim());
      if (userId.trim()) q.set("userId", userId.trim());
      // 日付(JST)→ISO(UTC)。from は 00:00、to は 23:59:59 で包含する。
      if (fromDate) q.set("from", new Date(`${fromDate}T00:00:00+09:00`).toISOString());
      if (toDate) q.set("to", new Date(`${toDate}T23:59:59+09:00`).toISOString());
      q.set("limit", String(limit));
      const res = await fetch(`/api/store-settings/audit?${q.toString()}`, { cache: "no-store" });
      if (res.status === 403) {
        setError("この画面は管理者のみ閲覧できます。");
        setLogs([]);
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "取得に失敗しました");
        setLogs([]);
        return;
      }
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTruncated(!!data.truncated);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [action, clubCode, userId, fromDate, toDate, limit]);

  useEffect(() => {
    load();
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportCsv = useCallback(() => {
    const header = ["日時(JST)", "操作", "実行者", "名前", "店舗", "件数", "対象", "詳細", "IP", "結果"];
    const rows = logs.map((l) => [
      fmtJst(l.timestamp),
      l.action,
      l.userId,
      l.userName || "",
      (l.clubCodes || []).join(" "),
      l.targetCount ?? "",
      l.resource || "",
      detailText(l.detail),
      l.ip || "",
      l.result || "ok",
    ]);
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  const errorCount = useMemo(() => logs.filter((l) => l.result === "error").length, [logs]);

  return (
    <div className="al-wrap">
      <div className="al-head">
        <h1>操作監査ログ</h1>
        <p className="al-sub">Push/DM送信・会員抽出・未納CSV出力・返金/入金の申請と承認など、重要操作の実行履歴です。</p>
      </div>

      <div className="al-filters">
        <label>
          <span>操作</span>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>店舗コード</span>
          <input value={clubCode} onChange={(e) => setClubCode(e.target.value)} placeholder="例: 511" />
        </label>
        <label>
          <span>実行者(メール)</span>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user@example.com" />
        </label>
        <label>
          <span>期間 From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          <span>期間 To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label>
          <span>最大件数</span>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="al-actions">
          <button className="al-btn primary" onClick={load} disabled={loading}>
            {loading ? "取得中…" : "絞り込み"}
          </button>
          <button className="al-btn" onClick={exportCsv} disabled={logs.length === 0}>CSV出力</button>
        </div>
      </div>

      <div className="al-summary">
        <span>{logs.length} 件表示</span>
        {errorCount > 0 && <span className="al-err">エラー {errorCount} 件</span>}
        {truncated && <span className="al-warn">※ 上限に達したため一部のみ表示しています。期間で絞り込んでください。</span>}
      </div>

      {error && <div className="al-error">{error}</div>}

      <div className="al-tablewrap">
        <table className="al-table">
          <thead>
            <tr>
              <th>日時 (JST)</th>
              <th>操作</th>
              <th>実行者</th>
              <th>店舗</th>
              <th>件数</th>
              <th>対象 / 詳細</th>
              <th>IP</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={`${l.userId}-${l.timestamp}-${i}`} className={l.result === "error" ? "row-err" : ""}>
                <td className="nowrap">{fmtJst(l.timestamp)}</td>
                <td>{actionLabel(l.action)}</td>
                <td>
                  <div className="al-user">{l.userName || l.userId}</div>
                  {l.userName && <div className="al-userid">{l.userId}</div>}
                </td>
                <td>{(l.clubCodes || []).join(", ")}</td>
                <td className="num">{l.targetCount ?? ""}</td>
                <td className="al-detail">
                  {l.resource && <div className="al-res">{l.resource}</div>}
                  {detailText(l.detail) && <div className="al-dt">{detailText(l.detail)}</div>}
                </td>
                <td className="nowrap">{l.ip || ""}</td>
                <td>
                  <span className={`al-badge ${l.result === "error" ? "err" : "ok"}`}>
                    {l.result === "error" ? "エラー" : "OK"}
                  </span>
                </td>
              </tr>
            ))}
            {logs.length === 0 && !loading && (
              <tr><td colSpan={8} className="al-empty">該当するログがありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .al-wrap { padding: 24px; max-width: 1280px; margin: 0 auto; }
        .al-head h1 { font-size: 22px; font-weight: 700; color: #1e293b; margin: 0 0 4px; }
        .al-sub { color: #64748b; font-size: 13px; margin: 0 0 20px; }
        .al-filters {
          display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end;
          background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 14px;
        }
        .al-filters label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
        .al-filters input, .al-filters select {
          border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 10px; font-size: 13px; background: #fff; min-width: 140px;
        }
        .al-actions { display: flex; gap: 8px; margin-left: auto; }
        .al-btn {
          border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px;
          padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .al-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
        .al-btn:disabled { opacity: .55; cursor: default; }
        .al-summary { display: flex; gap: 14px; align-items: center; font-size: 12px; color: #64748b; margin-bottom: 8px; }
        .al-err { color: #dc2626; font-weight: 600; }
        .al-warn { color: #b45309; }
        .al-error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
        .al-tablewrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px; }
        .al-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .al-table th {
          background: #f1f5f9; text-align: left; padding: 10px 12px; color: #475569; font-weight: 600;
          border-bottom: 1px solid #e2e8f0; white-space: nowrap; position: sticky; top: 0;
        }
        .al-table td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: top; }
        .al-table tr.row-err td { background: #fff7f7; }
        .nowrap { white-space: nowrap; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .al-user { font-weight: 600; }
        .al-userid { color: #94a3b8; font-size: 11px; }
        .al-detail { max-width: 420px; }
        .al-res { color: #0f766e; font-family: ui-monospace, monospace; font-size: 11.5px; }
        .al-dt { color: #64748b; font-size: 11.5px; word-break: break-word; }
        .al-badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .al-badge.ok { background: #dcfce7; color: #15803d; }
        .al-badge.err { background: #fee2e2; color: #b91c1c; }
        .al-empty { text-align: center; color: #94a3b8; padding: 32px; }
      `}</style>
    </div>
  );
}
