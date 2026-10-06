// app/admin/bi/executive/page.tsx — 経営者ダッシュボード
"use client";
import React from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useBi, FilterBar, BiLayout, Card, KpiCard, yoy, fmt, pct, yen, ymLabel, ConditionsPanel, T } from "@/components/bi/BiKit";

export default function Page() {
  const { f, setF, data, loading, err } = useBi<any>("/api/bi/executive");
  const S = data?.summary, P = data?.prevYear;
  return (
    <BiLayout title="経営ダッシュボード" subtitle={`全社サマリ（★課金会員のみ＝家族会員を除く）。純増減=入会−退会。対象=直近の完了月 ${data?.latestYm ? ymLabel(data.latestYm) : "…"}。検索条件は全ボード共有。`}>
      <FilterBar f={f} setF={setF} options={data?.options} showMemberType={false} />
      <ConditionsPanel f={f} meta={data?.meta} extra={{ 対象月: data?.latestYm }} />
      {err && <div style={{ color: T.crit }}>エラー: {err}</div>}
      {loading && <div style={{ color: T.ink3 }}>読み込み中…</div>}

      {S && (
        <>
          {/* KPI一発 */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <KpiCard label="月末 課金会員数" value={fmt(S.月末)} sub={yoy(S.月末, P?.月末)} />
            <KpiCard label="純増減（入会-退会）" value={(S.純増減 >= 0 ? "+" : "") + fmt(S.純増減)} sub={P ? `前年 ${P.純増減 >= 0 ? "+" : ""}${fmt(P.純増減)}` : null} tone={S.純増減 >= 0 ? "ok" : "bad"} />
            <KpiCard label="入会数" value={fmt(S.入会)} sub={yoy(S.入会, P?.入会)} tone="ok" />
            <KpiCard label="退会数" value={fmt(S.退会)} sub={yoy(S.退会, P?.退会)} tone="bad" />
            <KpiCard label="会員売上（振替）" value={yen(S.会員売上)} sub={yoy(S.会員売上, P?.会員売上)} />
            <KpiCard label="客単価" value={yen(Math.round(S.客単価 || 0))} sub={yoy(S.客単価, P?.客単価)} />
            <KpiCard label="解約率" value={pct(S.解約率)} />
            <KpiCard label="LTV（客単価/解約率）" value={yen(Math.round(S.LTV || 0))} sub={S.平均継続月数 ? `平均継続 ${S.平均継続月数.toFixed(1)}ヶ月` : null} />
            <KpiCard label="都度売上（OTP/1DAY/OP）" value={yen(data.spotSales)} />
          </div>

          {/* 会員数 × 会員売上 推移 */}
          <Card title="会員数・会員売上 推移（棒=会員売上・折線=月末安定会員数）">
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
                <XAxis dataKey="ym" tickFormatter={ymLabel} minTickGap={20} />
                <YAxis yAxisId="l" tickFormatter={(v) => (v / 1e8).toFixed(0) + "億"} />
                <YAxis yAxisId="r" orientation="right" domain={["auto", "auto"]} />
                <Tooltip labelFormatter={ymLabel} formatter={(v: any, n: any) => n === "会員売上" ? yen(Number(v)) : fmt(Number(v))} />
                <Legend />
                <Bar yAxisId="l" dataKey="会員売上" fill={T.accent} opacity={0.35} />
                <Line yAxisId="r" dataKey="月末在籍数" stroke={T.accent} strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {/* 入退会 × 純増減 */}
          <Card title="入会・退会・純増減 推移">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
                <XAxis dataKey="ym" tickFormatter={ymLabel} minTickGap={20} /><YAxis />
                <Tooltip labelFormatter={ymLabel} formatter={(v: any) => fmt(Number(v))} /><Legend />
                <Bar dataKey="入会数" fill="#1baf7a" /><Bar dataKey="退会数" fill="#d03b3b" />
                <Line dataKey="純増減" stroke="#2a78d6" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {data?.cohort?.length > 0 && (
            <Card title="入会コホート別 継続率（行=入会月／列=経過月数）">
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
                  <thead><tr>
                    <th style={{ padding: "4px 8px", textAlign: "left", color: T.ink2 }}>入会月</th>
                    <th style={{ padding: "4px 8px", textAlign: "right", color: T.ink2 }}>入会者</th>
                    {data.cohortMonths.map((m: number) => <th key={m} style={{ padding: "4px 6px", color: T.ink2, fontWeight: 500 }}>{m}ヶ月</th>)}
                  </tr></thead>
                  <tbody>
                    {data.cohort.map((row: any) => (
                      <tr key={row.cohort}>
                        <td style={{ padding: "3px 8px", fontWeight: 600 }}>{ymLabel(row.cohort)}</td>
                        <td style={{ padding: "3px 8px", textAlign: "right", color: T.ink2 }}>{fmt(row.base)}</td>
                        {row.rates.map((r: number | null, i: number) => (
                          <td key={i} style={{ padding: "3px 6px", textAlign: "center", width: 46,
                            background: r == null ? "transparent" : `rgba(27,175,122,${0.12 + r * 0.8})`,
                            color: r != null && r > 0.55 ? "#fff" : T.ink }}>
                            {r == null ? "" : (r * 100).toFixed(0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: T.ink3, marginTop: 6 }}>数値=継続率(%)。濃いほど高い。0ヶ月=入会時点(100%)。継続率=SUM(継続者数)/SUM(入会者数)。</div>
            </Card>
          )}
        </>
      )}
    </BiLayout>
  );
}
