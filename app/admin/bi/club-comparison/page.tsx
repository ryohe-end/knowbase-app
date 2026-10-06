// app/admin/bi/club-comparison/page.tsx — BI D2: 勝ち負け店舗比較
"use client";
import React, { useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useBi, FilterBar, BiLayout, Card, KpiCard, yoy, fmt, pct, yen, ymLabel, ConditionsPanel } from "@/components/bi/BiKit";

export default function Page() {
  const [month, setMonth] = useState("");
  const [gran, setGran] = useState<"month" | "fy">("month");
  const qs = `${month ? `month=${month}&` : ""}gran=${gran}`;
  const { f, setF, data, loading, err } = useBi<any>(`/api/bi/club-comparison?${qs}`);
  const [sort, setSort] = useState<string>("純増減");
  const [minMs, setMinMs] = useState(100); // 月初在籍の下限(小規模店を率ランキングから除外=設計書2-5)
  const clubs = (data?.clubs || []).filter((c: any) => (c.月初 ?? 0) >= minMs)
    .slice().sort((a: any, b: any) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity));
  const S = data?.summary, P = data?.prevYear;

  return (
    <BiLayout title="勝ち負け店舗比較" subtitle="出典 MART.DM_勝ち負け表_売上_集計。客単価=売上額/月初(課金会員のみ)。率は分子/分母を合算。当月は途中集計のため既定は直近の完了月。">
      {/* 月セレクタ + 年度トグル */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "#374151" }}>対象月{" "}
          <select value={month || data?.selectedMonth || ""} onChange={(e) => setMonth(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 }}>
            {(data?.months || []).map((m: string) => <option key={m} value={m}>{ymLabel(m)}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: "#6b7280" }}>｜推移の粒度:</span>
        {(["month", "fy"] as const).map((g) => (
          <button key={g} onClick={() => setGran(g)} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: gran === g ? "#2563eb" : "#fff", color: gran === g ? "#fff" : "#374151", cursor: "pointer" }}>{g === "month" ? "月次" : "年度"}</button>
        ))}
        <label style={{ fontSize: 12, color: "#374151", marginLeft: 8 }}>月初在籍 下限{" "}
          <input type="number" value={minMs} onChange={(e) => setMinMs(Number(e.target.value) || 0)} style={{ width: 70, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 6 }} />
          <span style={{ color: "#9ca3af" }}> 未満を率ランキングから除外</span>
        </label>
      </div>
      <FilterBar f={f} setF={setF} options={data?.options} />
      <ConditionsPanel f={f} meta={data?.meta} extra={{ 対象月: data?.selectedMonth, 推移粒度: gran === "fy" ? "年度" : "月次", 月初下限: String(minMs) }} />
      {err && <div style={{ color: "#dc2626" }}>エラー: {err}</div>}
      {loading && <div style={{ color: "#6b7280" }}>読み込み中…</div>}

      {/* 全社KPI(選択月) + 前年同月 */}
      {S && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <KpiCard label="月初安定会員数" value={fmt(S.月初)} sub={yoy(S.月初, P?.月初) || (P ? null : "前年なし")} />
          <KpiCard label="月末安定会員数" value={fmt(S.月末)} sub={yoy(S.月末, P?.月末)} />
          <KpiCard label="入会数" value={fmt(S.入会)} sub={yoy(S.入会, P?.入会)} />
          <KpiCard label="退会数" value={fmt(S.退会)} sub={yoy(S.退会, P?.退会)} tone="bad" />
          <KpiCard label="純増減" value={(S.純増減 >= 0 ? "+" : "") + fmt(S.純増減)} sub={P ? `前年 ${P.純増減 >= 0 ? "+" : ""}${fmt(P.純増減)}` : null} />
          <KpiCard label="客単価" value={yen(Math.round(S.客単価 || 0))} />
        </div>
      )}

      {data?.trend?.length > 0 && (
        <Card title={`${gran === "fy" ? "年度" : "月次"}推移（棒=入会/退会・折線=月末在籍）`}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tickFormatter={ymLabel} minTickGap={20} />
              <YAxis yAxisId="l" /><YAxis yAxisId="r" orientation="right" />
              <Tooltip labelFormatter={ymLabel} formatter={(v: any) => fmt(Number(v))} /><Legend />
              <Bar yAxisId="l" dataKey="入会数" fill="#16a34a" /><Bar yAxisId="l" dataKey="退会数" fill="#dc2626" />
              <Line yAxisId="r" dataKey="月末在籍数" stroke="#2563eb" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {clubs.length > 0 && (
        <Card title={`クラブ別比較 ${data?.selectedMonth ? ymLabel(data.selectedMonth) : ""}（${clubs.length}店・見出しクリックで並替。かっこ=前年同月）`}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead><tr>
                {["name", "月初", "月末", "入会", "退会", "純増減", "解約率", "来館率", "客単価"].map((c) => (
                  <th key={c} onClick={() => c !== "name" && setSort(c)} style={{ textAlign: c === "name" ? "left" : "right", padding: "6px 10px", borderBottom: "2px solid #e5e7eb", cursor: c === "name" ? "default" : "pointer", color: sort === c ? "#2563eb" : "#374151", whiteSpace: "nowrap" }}>
                    {c === "name" ? "クラブ" : c}{sort === c ? " ▼" : ""}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {clubs.slice(0, 60).map((r: any) => {
                  const py = r.前年;
                  const cell = (v: any, prev?: any, color?: string) => (
                    <td style={{ textAlign: "right", padding: "5px 10px", color, whiteSpace: "nowrap" }}>
                      {fmt(v)}{prev != null && <span style={{ color: "#9ca3af", fontSize: 11 }}> ({fmt(prev)})</span>}
                    </td>);
                  return (
                    <tr key={r.code} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "5px 10px" }}>{r.name}</td>
                      {cell(r.月初, py?.月初)}{cell(r.月末, py?.月末)}
                      {cell(r.入会, py?.入会, "#16a34a")}{cell(r.退会, py?.退会, "#dc2626")}
                      <td style={{ textAlign: "right", padding: "5px 10px", fontWeight: 600, color: r.純増減 >= 0 ? "#16a34a" : "#dc2626", whiteSpace: "nowrap" }}>
                        {r.純増減 >= 0 ? "+" : ""}{fmt(r.純増減)}{py && <span style={{ color: "#9ca3af", fontSize: 11 }}> ({py.純増減 >= 0 ? "+" : ""}{fmt(py.純増減)})</span>}
                      </td>
                      <td style={{ textAlign: "right", padding: "5px 10px" }}>{pct(r.解約率)}</td>
                      <td style={{ textAlign: "right", padding: "5px 10px" }}>{pct(r.来館率)}</td>
                      <td style={{ textAlign: "right", padding: "5px 10px" }}>{yen(Math.round(r.客単価 || 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </BiLayout>
  );
}
