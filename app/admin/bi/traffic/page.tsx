// app/admin/bi/traffic/page.tsx — BI D4: 来館・混雑
"use client";
import React, { useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { useBi, FilterBar, BiLayout, Card, fmt, ymLabel, ConditionsPanel } from "@/components/bi/BiKit";

const DOW_ORDER = ["日", "月", "火", "水", "木", "金", "土"];

export default function Page() {
  const { f, setF, data, loading, err } = useBi<any>("/api/bi/traffic");
  const { hours, grid, max } = useMemo(() => {
    const cells: any[] = data?.heatmap || [];
    const hours = Array.from(new Set(cells.map((c) => c.hour))).sort((a, b) => a - b);
    const map: Record<string, number> = {};
    let max = 0;
    cells.forEach((c) => { map[`${c.dow}|${c.hour}`] = c.value; if (c.value > max) max = c.value; });
    return { hours, grid: map, max };
  }, [data]);
  const color = (v: number) => { if (!v) return "#f9fafb"; const t = Math.min(1, v / (max || 1)); return `rgba(37,99,235,${0.12 + t * 0.78})`; };

  return (
    <BiLayout title="来館・混雑" subtitle="出典 MART.DM_時間別来館_集計_軽量。曜日×時間帯の来館数（選択期間の合算）。">
      <FilterBar f={f} setF={setF} options={data?.options} showMemberType={false} />
      <ConditionsPanel f={f} meta={data?.meta} />
      {err && <div style={{ color: "#dc2626" }}>エラー: {err}</div>}
      {loading && <div style={{ color: "#6b7280" }}>読み込み中…</div>}
      {hours.length > 0 && (
        <Card title="曜日 × 時間帯 ヒートマップ（来館数）">
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr><th style={{ padding: 4 }}></th>{hours.map((h) => <th key={h} style={{ padding: "2px 4px", color: "#6b7280", fontWeight: 500 }}>{h}</th>)}</tr></thead>
              <tbody>
                {DOW_ORDER.filter((d) => data.heatmap.some((c: any) => c.dow === d)).map((d) => (
                  <tr key={d}>
                    <td style={{ padding: "2px 6px", fontWeight: 600 }}>{d}</td>
                    {hours.map((h) => { const v = grid[`${d}|${h}`] || 0; return (
                      <td key={h} title={`${d} ${h}時: ${fmt(v)}`} style={{ background: color(v), width: 28, height: 22, textAlign: "center", color: v > max * 0.6 ? "#fff" : "#374151", border: "1px solid #fff" }}>
                        {v ? Math.round(v / 1000) + "k" : ""}
                      </td>); })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {data?.trend?.length > 0 && (
        <Card title="月次 来館数・来館人数">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="ym" tickFormatter={ymLabel} minTickGap={20} /><YAxis />
              <Tooltip labelFormatter={ymLabel} formatter={(v: any) => fmt(Number(v))} />
              <Line dataKey="来館数" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line dataKey="来館人数" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
    </BiLayout>
  );
}
