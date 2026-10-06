// app/admin/bi/sales-budget/page.tsx — BI D6: 売上・予実
"use client";
import React from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useBi, FilterBar, BiLayout, Card, KpiCard, fmt, pct, yen, ymLabel, ConditionsPanel } from "@/components/bi/BiKit";

export default function Page() {
  const { f, setF, data, loading, err } = useBi<any>("/api/bi/sales-budget");
  const L = data?.latest;
  return (
    <BiLayout title="売上・予実" subtitle="振替売上=MART.DM_売上実績_集計 / 予算・会計実績=MART.DM_クラブ予実(勘定科目=売上高)。達成率は予実内で完結（実績/計画）。">
      <FilterBar f={f} setF={setF} options={data?.options} showMemberType={false} />
      <ConditionsPanel f={f} meta={data?.meta} />
      {err && <div style={{ color: "#dc2626" }}>エラー: {err}</div>}
      {loading && <div style={{ color: "#6b7280" }}>読み込み中…</div>}
      {L && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <KpiCard label="振替売上(実績)" value={yen(L.振替売上)} />
          <KpiCard label="会計実績(予実)" value={yen(L.会計実績)} />
          <KpiCard label="予算(計画)" value={yen(L.予算計画)} />
          <KpiCard label="予算達成率" value={pct(L.達成率)} />
          <KpiCard label="未納率" value={pct(L.未納率)} />
        </div>
      )}
      {data?.trend?.length > 0 && (
        <Card title="月次 振替売上 vs 予算・会計実績">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="ym" tickFormatter={ymLabel} minTickGap={20} />
              <YAxis tickFormatter={(v) => (v / 1e6).toFixed(0) + "M"} />
              <Tooltip labelFormatter={ymLabel} formatter={(v: any) => yen(Number(v))} /><Legend />
              <Bar dataKey="振替売上" fill="#93c5fd" />
              <Line dataKey="予算計画" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line dataKey="会計実績" stroke="#16a34a" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#6b7280" }}>※「振替売上」（口座振替ベース）と「会計実績」（会計PLベース）はソースが異なり一致しません。予算達成率は予実（会計）内で完結。</div>
        </Card>
      )}
    </BiLayout>
  );
}
