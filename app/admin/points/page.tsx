"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  clubCode: string;
  clubName: string;
  brand: "FIT365" | "JOYFIT";
  granted: number;
  used: number;
  balance: number;
  memberCount: number;
};
type Totals = { granted: number; used: number; balance: number; stores: number };

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const yen = (n: number) => n.toLocaleString("ja-JP");

export default function PointsAccountingPage() {
  const [from, setFrom] = useState(thisMonth());
  const [to, setTo] = useState(thisMonth());
  const [brand, setBrand] = useState<"ALL" | "FIT365" | "JOYFIT">("ALL");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals>({ granted: 0, used: 0, balance: 0, stores: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const params = new URLSearchParams({ from, to, brand });
      const res = await fetch(`/api/admin/points-accounting?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "取得に失敗しました（権限をご確認ください）");
      setRows(data.rows || []);
      setTotals(data.totals || { granted: 0, used: 0, balance: 0, stores: 0 });
    } catch (e: any) {
      setErr(e?.message || "エラー"); setRows([]);
    } finally { setLoading(false); }
  }, [from, to, brand]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.clubCode} ${r.clubName}`.toLowerCase().includes(s));
  }, [rows, q]);

  const viewTotals = useMemo(() => {
    if (!q.trim()) return totals;
    return filtered.reduce((t, r) => { t.granted += r.granted; t.used += r.used; t.balance += r.balance; return t; },
      { granted: 0, used: 0, balance: 0, stores: filtered.length });
  }, [filtered, q, totals]);

  const downloadCsv = () => {
    const header = ["店舗コード", "店舗名", "ブランド", `取得(${from}〜${to})`, `使用(${from}〜${to})`, `残高(${to}末)`, "会員数"];
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of filtered) lines.push([r.clubCode, r.clubName, r.brand, r.granted, r.used, r.balance, r.memberCount].map(esc).join(","));
    lines.push(["合計", "", "", viewTotals.granted, viewTotals.used, viewTotals.balance, ""].map(esc).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `points_accounting_${from}_${to}${brand !== "ALL" ? "_" + brand : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ marginBottom: 8 }}>
        <Link href="/admin" style={{ color: "#64748b", textDecoration: "none", fontSize: 13 }}>← 管理者ダッシュボード</Link>
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>ポイント会計ダッシュボード</h1>
      <p style={{ color: "#64748b", fontSize: 12, marginBottom: 16 }}>
        各店舗のポイント取得・使用・残高を会計向けに集計します（夜間集計 yamauchi-PointSummary 由来）。
        残高は「取得−使用」の累積（失効未反映の近似・A方式）です。
      </p>

      {/* コントロール */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
        <div><label style={lbl}>期間 開始</label><input type="month" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={inp} /></div>
        <div><label style={lbl}>期間 終了</label><input type="month" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={inp} /></div>
        <div><label style={lbl}>ブランド</label>
          <select value={brand} onChange={(e) => setBrand(e.target.value as any)} style={inp}>
            <option value="ALL">すべて</option>
            <option value="FIT365">FIT365</option>
            <option value="JOYFIT">JOYFIT</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}><label style={lbl}>店舗検索</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="店舗名・コード" style={{ ...inp, width: "100%" }} /></div>
        <button onClick={downloadCsv} disabled={filtered.length === 0} style={{ ...btn, background: "#0f766e", color: "#fff", opacity: filtered.length === 0 ? 0.5 : 1 }}>CSV出力</button>
      </div>

      {err && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {/* サマリーカード */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi label={`取得 (${from}〜${to})`} value={yen(viewTotals.granted)} color="#0ea5e9" unit="pt" />
        <Kpi label={`使用 (${from}〜${to})`} value={yen(viewTotals.used)} color="#f59e0b" unit="pt" />
        <Kpi label={`残高 (${to}末)`} value={yen(viewTotals.balance)} color="#0f766e" unit="pt" />
        <Kpi label="対象店舗数" value={String(viewTotals.stores)} color="#64748b" unit="店" />
      </div>

      {loading ? (
        <div style={{ color: "#94a3b8", padding: 24 }}>読み込み中…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "#94a3b8", padding: 24, textAlign: "center", border: "1px dashed #e2e8f0", borderRadius: 10 }}>
          対象データがありません（CPSS未登録店舗・集計前の月は0件になります）。
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", textAlign: "right" }}>
                <th style={{ ...th, textAlign: "left" }}>店舗</th>
                <th style={{ ...th, textAlign: "center" }}>ブランド</th>
                <th style={th}>取得</th>
                <th style={th}>使用</th>
                <th style={th}>残高</th>
                <th style={th}>会員数</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.clubCode} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{ color: "#94a3b8", fontSize: 11, marginRight: 6 }}>{r.clubCode}</span>{r.clubName}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: r.brand === "FIT365" ? "#dc2626" : "#2563eb" }}>{r.brand}</span>
                  </td>
                  <td style={td}>{yen(r.granted)}</td>
                  <td style={td}>{yen(r.used)}</td>
                  <td style={{ ...td, fontWeight: 800, color: "#0f766e" }}>{yen(r.balance)}</td>
                  <td style={{ ...td, color: "#64748b" }}>{yen(r.memberCount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f8fafc", fontWeight: 800, borderTop: "2px solid #e2e8f0" }}>
                <td style={{ ...td, textAlign: "left" }}>合計 ({viewTotals.stores}店)</td>
                <td style={td}></td>
                <td style={td}>{yen(viewTotals.granted)}</td>
                <td style={td}>{yen(viewTotals.used)}</td>
                <td style={{ ...td, color: "#0f766e" }}>{yen(viewTotals.balance)}</td>
                <td style={td}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color, unit }: { label: string; value: string; color: string; unit: string }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", background: "#fff" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}<span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>{unit}</span></div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "#475569", margin: "0 0 4px" };
const inp: React.CSSProperties = { border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" };
const btn: React.CSSProperties = { border: "none", borderRadius: 9, padding: "9px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 700, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 14px", textAlign: "right", whiteSpace: "nowrap" };
