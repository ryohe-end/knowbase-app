// app/admin/bi/family/page.tsx — BI D3: 家族会員
"use client";
import React from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart } from "recharts";
import { useBi, FilterBar, BiLayout, Card, KpiCard, fmt, pct, ymLabel, ConditionsPanel } from "@/components/bi/BiKit";

export default function Page() {
  const { f, setF, data, loading, err } = useBi<any>("/api/bi/family");
  const L = data?.latest;
  return (
    <BiLayout title="家族会員" subtitle="出典 MART.DM_家族会員数_集計。付帯率=家族会員数/課金会員数（合算して算出）。">
      <FilterBar f={f} setF={setF} options={data?.options} showMemberType={false} />
      <ConditionsPanel f={f} meta={data?.meta} />
      {err && <div style={{ color: "#dc2626" }}>エラー: {err}</div>}
      {loading && <div style={{ color: "#6b7280" }}>読み込み中…</div>}
      {L && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <KpiCard label="課金会員数" value={fmt(L.課金会員数)} />
          <KpiCard label="家族会員数" value={fmt(L.家族会員数)} />
          <KpiCard label="付帯率" value={pct(L.付帯率)} />
        </div>
      )}
      {data?.trend?.length > 0 && (
        <Card title="月次推移（棒=課金/家族・折線=付帯率）">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="ym" tickFormatter={ymLabel} minTickGap={20} />
              <YAxis yAxisId="l" /><YAxis yAxisId="r" orientation="right" tickFormatter={(v) => (v * 100).toFixed(0) + "%"} />
              <Tooltip labelFormatter={ymLabel} formatter={(v: any, n: any) => n === "付帯率" ? pct(Number(v)) : fmt(Number(v))} /><Legend />
              <Bar yAxisId="l" dataKey="課金会員数" fill="#2563eb" /><Bar yAxisId="l" dataKey="家族会員数" fill="#f59e0b" />
              <Line yAxisId="r" dataKey="付帯率" stroke="#16a34a" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#6b7280" }}>※家族関係は履歴を持たず、過去月にも現行の家族数を適用するため、付帯率の過去推移は実態より現在に引きずられます（構造上の制約）。</div>
        </Card>
      )}
      {data?.clubs?.length > 0 && (
        <Card title="クラブ別 付帯率 TOP20（最新月）">
          <ResponsiveContainer width="100%" height={Math.min(600, 40 + data.clubs.slice(0, 20).length * 26)}>
            <BarChart data={data.clubs.slice(0, 20)} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" tickFormatter={(v) => (v * 100).toFixed(0) + "%"} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => pct(Number(v))} />
              <Bar dataKey="付帯率" fill="#0891b2" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </BiLayout>
  );
}
