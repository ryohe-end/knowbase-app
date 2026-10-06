// app/admin/bi/member-summary/page.tsx
// BI D1: 会員数サマリー(Snowflake MART.DM_勝ち負け表_集計)。KPI + 月次推移 + 内訳。
"use client";

import React from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, Cell,
} from "recharts";
import { ConditionsPanel, useBi, FilterBar } from "@/components/bi/BiKit";

type Row = {
  ym: string; 月初在籍数: number; 月末在籍数: number; 入会数: number; 退会数: number;
  来館者数: number; 純増減: number; 解約率: number | null; 入会率: number | null; 来館率: number | null;
};
type Options = {
  brands: string[]; areas: string[]; companies: string[];
  clubs: { code: number; name: string }[]; memberTypes: string[];
};
type Resp = {
  options: Options; latest: Row | null; prevYear: Row | null; trend: Row[];
  breakdown: { byMemberType: { key: string; value: number }[]; byAge: any[]; byGender: any[] };
};

const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c"];
const AGE_ORDER = ["10未満", "10代", "20代", "30代", "40代", "50代", "60代", "70+", "不明"];
const orderAge = (rows: { key: string; value: number }[] = []) =>
  rows.slice().sort((a, b) => { const ia = AGE_ORDER.indexOf(a.key), ib = AGE_ORDER.indexOf(b.key); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? "—" : (n * 100).toFixed(1) + "%");
const ymLabel = (ym: string) => (ym?.length === 6 ? `${ym.slice(0, 4)}/${ym.slice(4)}` : ym);

function KpiCard({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: React.ReactNode; tone?: "neutral" | "ok" | "bad" }) {
  const top = tone === "ok" ? "#0ca30c" : tone === "bad" ? "#d03b3b" : "#2a78d6";
  return (
    <div style={{ flex: "1 1 150px", background: "#fff", border: "1px solid #dfe3ea", borderTop: `2px solid ${top}`, borderRadius: 4, padding: "12px 14px", boxShadow: "0 1px 2px rgba(17,22,32,.06)" }}>
      <div style={{ fontSize: 11.5, color: "#4b5566" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 2, fontFamily: '"IBM Plex Mono",ui-monospace,Menlo,monospace' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 11, marginTop: 5, color: "#4b5566" }}>{sub}</div>}
    </div>
  );
}

function yoy(cur?: number | null, prev?: number | null) {
  if (cur == null || prev == null || prev === 0) return null;
  const d = (cur - prev) / Math.abs(prev);
  const up = d >= 0;
  return <span style={{ color: up ? "#16a34a" : "#dc2626" }}>{up ? "▲" : "▼"}{(Math.abs(d) * 100).toFixed(1)}% 前年比</span>;
}

export default function MemberSummaryPage() {
  // 検索条件は全ボード共有(useBi=localStorage連携)
  const { f, setF, data, loading, err } = useBi<Resp>("/api/bi/member-summary");
  const L = data?.latest, P = data?.prevYear;

  return (
    <section className="board">
      <div className="bh">
        <h2>会員数サマリー</h2>
        <dl><dd style={{ margin: 0, color: "var(--ink-2)" }}>出典 <code>MART.DM_勝ち負け表_集計</code>（安定会員基準）。率は分子/分母を合算。来館率は近似。検索条件は全ボード共有。</dd></dl>
      </div>
      <ConditionsPanel f={f} meta={(data as any)?.meta} extra={{ 最新月: L?.ym }} />
      {err && <div style={{ color: "#dc2626", marginBottom: 12 }}>エラー: {err}</div>}
      {loading && <div style={{ color: "#6b7280" }}>読み込み中…</div>}

      {L && (
        <>
          <div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>最新月: <b>{ymLabel(L.ym)}</b></div>
          {/* KPIカード */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <KpiCard label="月末安定会員数" value={fmt(L.月末在籍数)} sub={yoy(L.月末在籍数, P?.月末在籍数)} />
            <KpiCard label="入会数" value={fmt(L.入会数)} sub={yoy(L.入会数, P?.入会数)} />
            <KpiCard label="退会数" value={fmt(L.退会数)} sub={yoy(L.退会数, P?.退会数)} tone="bad" />
            <KpiCard label="純増減(月末-月初)" value={(L.純増減 >= 0 ? "+" : "") + fmt(L.純増減)} />
            <KpiCard label="解約率" value={pct(L.解約率)} />
            <KpiCard label="来館率(近似)" value={pct(L.来館率)} />
          </div>

          {/* 月次推移 */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>月次推移（棒=入会/退会・折線=月末安定会員数）</div>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={data!.trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ym" tickFormatter={ymLabel} minTickGap={20} />
                <YAxis yAxisId="l" />
                <YAxis yAxisId="r" orientation="right" domain={["auto", "auto"]} />
                <RTooltip labelFormatter={ymLabel} formatter={(v: any) => fmt(Number(v))} />
                <Legend />
                <Bar yAxisId="l" dataKey="入会数" fill="#16a34a" />
                <Bar yAxisId="l" dataKey="退会数" fill="#dc2626" />
                <Line yAxisId="r" dataKey="月末在籍数" stroke="#2563eb" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 内訳 */}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[
              { title: "会員種別構成（会員種別フィルタ非連動）", rows: data!.breakdown.byMemberType },
              { title: "年代構成", rows: orderAge(data!.breakdown.byAge) },
              { title: "性別構成", rows: data!.breakdown.byGender },
            ].map((b) => (
              <div key={b.title} style={{ flex: "1 1 280px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{b.title}（月末在籍）</div>
                <ResponsiveContainer width="100%" height={Math.max(150, 30 + b.rows.length * 28)}>
                  <BarChart data={b.rows} layout="vertical" margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="key" width={78} tick={{ fontSize: 11 }} />
                    <RTooltip formatter={(v: any) => fmt(Number(v))} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 10, formatter: (v: any) => fmt(Number(v)) }}>
                      {b.rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
