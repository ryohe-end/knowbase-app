// app/admin/bi/spot-usage/page.tsx — BI D5: 都度利用
"use client";
import React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useBi, FilterBar, BiLayout, Card, KpiCard, fmt, pct, yen, ymLabel, COLORS, ConditionsPanel } from "@/components/bi/BiKit";

const PRODS = ["OneTimePass", "1DAYパス", "オプション都度"];
export default function Page() {
  const { f, setF, data, loading, err } = useBi<any>("/api/bi/spot-usage");
  return (
    <BiLayout title="都度利用（OneTimePass / 1DAY / オプション都度）" subtitle="出典 MART.V_都度利用_統合。販売数=行数, 利用率=Σ利用/Σ販売, 売上=Σ金額。">
      <FilterBar f={f} setF={setF} options={data?.options} showMemberType={false} />
      <ConditionsPanel f={f} meta={data?.meta} />
      {err && <div style={{ color: "#dc2626" }}>エラー: {err}</div>}
      {loading && <div style={{ color: "#6b7280" }}>読み込み中…</div>}
      {data?.products?.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {data.products.map((p: any) => (
            <KpiCard key={p.商品区分} label={p.商品区分}
              value={<span>{fmt(p.販売数)}<span style={{ fontSize: 12, color: "#6b7280" }}> 販売</span></span>}
              sub={<span>{yen(p.売上金額)}・利用率 {pct(p.利用率)}</span>} />
          ))}
        </div>
      )}
      {data?.trend?.length > 0 && (
        <Card title="月次 売上金額（商品区分別・積み上げ）">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="ym" tickFormatter={ymLabel} minTickGap={20} />
              <YAxis tickFormatter={(v) => (v / 1e6).toFixed(0) + "M"} />
              <Tooltip labelFormatter={ymLabel} formatter={(v: any) => yen(Number(v))} /><Legend />
              {PRODS.map((p, i) => <Bar key={p} dataKey={p} stackId="a" fill={COLORS[i]} />)}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
      {data?.products?.length > 0 && (
        <Card title="商品区分別サマリ">
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr>{["商品区分", "販売数", "利用数", "利用率", "売上金額"].map((h) => <th key={h} style={{ textAlign: h === "商品区分" ? "left" : "right", padding: "6px 10px", borderBottom: "2px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
            <tbody>
              {data.products.map((p: any) => (
                <tr key={p.商品区分} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "5px 10px" }}>{p.商品区分}</td>
                  <td style={{ textAlign: "right", padding: "5px 10px" }}>{fmt(p.販売数)}</td>
                  <td style={{ textAlign: "right", padding: "5px 10px" }}>{fmt(p.利用数)}</td>
                  <td style={{ textAlign: "right", padding: "5px 10px" }}>{pct(p.利用率)}</td>
                  <td style={{ textAlign: "right", padding: "5px 10px" }}>{yen(p.売上金額)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </BiLayout>
  );
}
