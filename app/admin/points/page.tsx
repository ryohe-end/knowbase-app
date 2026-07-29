"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  clubCode: string;
  clubName: string;
  brand: "FIT365" | "JOYFIT";
  area: string;
  block: string;
  granted: number;
  used: number;
  balance: number;
  memberCount: number;
};
type AreaRow = { area: string; granted: number; used: number; balance: number; stores: number };
type MonthPoint = { ym: string; granted: number; used: number; balance: number };
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
  const [group, setGroup] = useState<"store" | "area">("store");
  const [rows, setRows] = useState<Row[]>([]);
  const [byArea, setByArea] = useState<AreaRow[]>([]);
  const [monthly, setMonthly] = useState<MonthPoint[]>([]);
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
      setByArea(data.byArea || []);
      setMonthly(data.monthly || []);
      setTotals(data.totals || { granted: 0, used: 0, balance: 0, stores: 0 });
    } catch (e: any) {
      setErr(e?.message || "エラー"); setRows([]); setByArea([]); setMonthly([]);
    } finally { setLoading(false); }
  }, [from, to, brand]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.clubCode} ${r.clubName} ${r.area}`.toLowerCase().includes(s));
  }, [rows, q]);

  const viewTotals = useMemo(() => {
    if (!q.trim()) return totals;
    return filtered.reduce((t, r) => { t.granted += r.granted; t.used += r.used; t.balance += r.balance; return t; },
      { granted: 0, used: 0, balance: 0, stores: filtered.length });
  }, [filtered, q, totals]);

  const downloadCsv = () => {
    const esc = (v: any) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    let header: string[]; let body: any[][]; let footer: any[];
    if (group === "area") {
      header = ["エリア", `取得(${from}〜${to})`, `使用(${from}〜${to})`, `残高(${to}末)`, "店舗数"];
      body = byArea.map((a) => [a.area, a.granted, a.used, a.balance, a.stores]);
      footer = ["合計", viewTotals.granted, viewTotals.used, viewTotals.balance, viewTotals.stores];
    } else {
      header = ["店舗コード", "店舗名", "ブランド", "エリア", `取得(${from}〜${to})`, `使用(${from}〜${to})`, `残高(${to}末)`, "会員数"];
      body = filtered.map((r) => [r.clubCode, r.clubName, r.brand, r.area, r.granted, r.used, r.balance, r.memberCount]);
      footer = ["合計", "", "", "", viewTotals.granted, viewTotals.used, viewTotals.balance, ""];
    }
    const lines = [header, ...body, footer].map((row) => row.map(esc).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `points_${group}_${from}_${to}${brand !== "ALL" ? "_" + brand : ""}.csv`;
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
            <option value="ALL">すべて</option><option value="FIT365">FIT365</option><option value="JOYFIT">JOYFIT</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}><label style={lbl}>店舗検索</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="店舗名・コード・エリア" style={{ ...inp, width: "100%" }} /></div>
        <button onClick={downloadCsv} disabled={(group === "area" ? byArea.length : filtered.length) === 0} style={{ ...btn, background: "#0f766e", color: "#fff", opacity: (group === "area" ? byArea.length : filtered.length) === 0 ? 0.5 : 1 }}>CSV出力</button>
      </div>

      {err && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {/* サマリーカード */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi label={`取得 (${from}〜${to})`} value={yen(viewTotals.granted)} color="#0ea5e9" unit="pt" />
        <Kpi label={`使用 (${from}〜${to})`} value={yen(viewTotals.used)} color="#f59e0b" unit="pt" />
        <Kpi label={`残高 (${to}末)`} value={yen(viewTotals.balance)} color="#0f766e" unit="pt" />
        <Kpi label="対象店舗数" value={String(viewTotals.stores)} color="#64748b" unit="店" />
      </div>

      {/* 月次推移グラフ */}
      <TrendChart data={monthly} />

      {/* グルーピング切替 */}
      <div style={{ display: "flex", gap: 6, margin: "18px 0 10px" }}>
        {(["store", "area"] as const).map((g) => (
          <button key={g} onClick={() => setGroup(g)}
            style={{ ...btn, padding: "7px 14px", background: group === g ? "#0f172a" : "#fff", color: group === g ? "#fff" : "#475569", border: group === g ? "none" : "1px solid #e2e8f0" }}>
            {g === "store" ? "店舗別" : "エリア別"}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: "#94a3b8", padding: 24 }}>読み込み中…</div>
      ) : group === "area" ? (
        byArea.length === 0 ? <Empty /> : (
          <div style={tableWrap}>
            <table style={table}>
              <thead><tr style={theadRow}>
                <th style={{ ...th, textAlign: "left" }}>エリア</th><th style={th}>取得</th><th style={th}>使用</th><th style={th}>残高</th><th style={th}>店舗数</th>
              </tr></thead>
              <tbody>
                {byArea.map((a) => (
                  <tr key={a.area} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{a.area}</td>
                    <td style={td}>{yen(a.granted)}</td><td style={td}>{yen(a.used)}</td>
                    <td style={{ ...td, fontWeight: 800, color: "#0f766e" }}>{yen(a.balance)}</td>
                    <td style={{ ...td, color: "#64748b" }}>{a.stores}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={tfootRow}>
                <td style={{ ...td, textAlign: "left" }}>合計</td>
                <td style={td}>{yen(viewTotals.granted)}</td><td style={td}>{yen(viewTotals.used)}</td>
                <td style={{ ...td, color: "#0f766e" }}>{yen(viewTotals.balance)}</td><td style={td}>{viewTotals.stores}</td>
              </tr></tfoot>
            </table>
          </div>
        )
      ) : filtered.length === 0 ? <Empty /> : (
        <div style={tableWrap}>
          <table style={table}>
            <thead><tr style={theadRow}>
              <th style={{ ...th, textAlign: "left" }}>店舗</th><th style={{ ...th, textAlign: "center" }}>ブランド</th>
              <th style={{ ...th, textAlign: "left" }}>エリア</th><th style={th}>取得</th><th style={th}>使用</th><th style={th}>残高</th><th style={th}>会員数</th>
            </tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.clubCode} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ ...td, textAlign: "left" }}><span style={{ color: "#94a3b8", fontSize: 11, marginRight: 6 }}>{r.clubCode}</span>{r.clubName}</td>
                  <td style={{ ...td, textAlign: "center" }}><span style={{ fontSize: 11, fontWeight: 700, color: r.brand === "FIT365" ? "#dc2626" : "#2563eb" }}>{r.brand}</span></td>
                  <td style={{ ...td, textAlign: "left", color: "#64748b", fontSize: 12 }}>{r.area}</td>
                  <td style={td}>{yen(r.granted)}</td><td style={td}>{yen(r.used)}</td>
                  <td style={{ ...td, fontWeight: 800, color: "#0f766e" }}>{yen(r.balance)}</td>
                  <td style={{ ...td, color: "#64748b" }}>{yen(r.memberCount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={tfootRow}>
              <td style={{ ...td, textAlign: "left" }}>合計 ({viewTotals.stores}店)</td><td style={td}></td><td style={td}></td>
              <td style={td}>{yen(viewTotals.granted)}</td><td style={td}>{yen(viewTotals.used)}</td>
              <td style={{ ...td, color: "#0f766e" }}>{yen(viewTotals.balance)}</td><td style={td}></td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// 月次推移: 取得/使用の棒 + 残高の折れ線 (軽量SVG)
function TrendChart({ data }: { data: MonthPoint[] }) {
  if (!data.length) return null;
  const W = 720, H = 200, padL = 8, padR = 8, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const maxFlow = Math.max(1, ...data.map((d) => Math.max(d.granted, d.used)));
  const maxBal = Math.max(1, ...data.map((d) => Math.abs(d.balance)));
  const n = data.length;
  const slot = iw / n;
  const barW = Math.min(14, slot / 3);
  const yFlow = (v: number) => padT + ih - (v / maxFlow) * ih;
  const balPts = data.map((d, i) => `${padL + slot * (i + 0.5)},${padT + ih - (d.balance / maxBal) * ih}`).join(" ");
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>月次推移（直近12ヶ月）</div>
        <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 12 }}>
          <span><span style={{ ...dot, background: "#0ea5e9" }} />取得</span>
          <span><span style={{ ...dot, background: "#f59e0b" }} />使用</span>
          <span><span style={{ ...dot, background: "#0f766e" }} />残高</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {data.map((d, i) => {
          const cx = padL + slot * (i + 0.5);
          return (
            <g key={d.ym}>
              <rect x={cx - barW - 1} y={yFlow(d.granted)} width={barW} height={padT + ih - yFlow(d.granted)} fill="#0ea5e9" opacity={0.85} />
              <rect x={cx + 1} y={yFlow(d.used)} width={barW} height={padT + ih - yFlow(d.used)} fill="#f59e0b" opacity={0.85} />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">{d.ym.slice(2)}</text>
            </g>
          );
        })}
        <polyline points={balPts} fill="none" stroke="#0f766e" strokeWidth="2" />
        {data.map((d, i) => (
          <circle key={d.ym} cx={padL + slot * (i + 0.5)} cy={padT + ih - (d.balance / maxBal) * ih} r="2.5" fill="#0f766e" />
        ))}
      </svg>
    </div>
  );
}

function Empty() {
  return <div style={{ color: "#94a3b8", padding: 24, textAlign: "center", border: "1px dashed #e2e8f0", borderRadius: 10 }}>
    対象データがありません（CPSS未登録店舗・集計前の月は0件になります）。
  </div>;
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
const tableWrap: React.CSSProperties = { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 };
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const theadRow: React.CSSProperties = { background: "#f8fafc", color: "#475569", textAlign: "right" };
const tfootRow: React.CSSProperties = { background: "#f8fafc", fontWeight: 800, borderTop: "2px solid #e2e8f0" };
const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 700, whiteSpace: "nowrap", textAlign: "right" };
const td: React.CSSProperties = { padding: "9px 14px", textAlign: "right", whiteSpace: "nowrap" };
const dot: React.CSSProperties = { display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 4, verticalAlign: "middle" };
