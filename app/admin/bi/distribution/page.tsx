// app/admin/bi/distribution/page.tsx — BI D7: 会員分布(都道府県)
"use client";
import React, { useState } from "react";
import { ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Cell } from "recharts";
import { useBi, FilterBar, BiLayout, Card, fmt, ymLabel, COLORS, ConditionsPanel } from "@/components/bi/BiKit";

// 地域別グリッド(タイルカルトグラム風。面積バイアス回避)
const REGIONS: { name: string; prefs: string[] }[] = [
  { name: "北海道・東北", prefs: ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"] },
  { name: "関東", prefs: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"] },
  { name: "中部", prefs: ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"] },
  { name: "近畿", prefs: ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"] },
  { name: "中国・四国", prefs: ["鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県"] },
  { name: "九州・沖縄", prefs: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] },
];
const SEQ = ["#eef3fb", "#cde2fb", "#9ec5f4", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];
function PrefTileMap({ rows }: { rows: { key: string; value: number }[] }) {
  const by: Record<string, number> = {}; let max = 0;
  rows.forEach((r) => { by[r.key] = r.value; if (r.value > max) max = r.value; });
  const color = (v: number) => v ? SEQ[Math.min(SEQ.length - 1, Math.ceil((v / (max || 1)) * (SEQ.length - 1)))] : "#f7f8fa";
  const fukumei = rows.find((r) => r.key === "不明");
  return (
    <Card title="都道府県別 会員数（地域別タイル。濃いほど多い）">
      {REGIONS.map((rg) => (
        <div key={rg.name} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#848d9c", marginBottom: 3 }}>{rg.name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {rg.prefs.map((p) => { const v = by[p] || 0; return (
              <div key={p} title={`${p}: ${fmt(v)}`} style={{ width: 78, padding: "6px 8px", borderRadius: 3, background: color(v), color: v > max * 0.55 ? "#fff" : "#333c48" }}>
                <div style={{ fontSize: 11 }}>{p.replace(/[都道府県]$/, "")}</div>
                <div style={{ fontSize: 12, fontFamily: '"IBM Plex Mono",monospace', fontWeight: 600 }}>{fmt(v)}</div>
              </div>); })}
          </div>
        </div>
      ))}
      {fukumei && <div style={{ fontSize: 12, color: "#4b5566", marginTop: 6 }}>※「不明」（都道府県が取れない会員）: <b>{fmt(fukumei.value)}</b>（地図には非表示）</div>}
    </Card>
  );
}

export default function Page() {
  const [kubun, setKubun] = useState("安定");
  const { f, setF, data, loading, err } = useBi<any>(`/api/bi/distribution?kubun=${encodeURIComponent(kubun)}`);
  return (
    <BiLayout title="会員分布（都道府県）" subtitle={`出典 MART.V_会員分布_都道府県（DM_会員属性プロット集計・都道府県粒度）。区分=${kubun}／最新月 ${data?.latestYm ? ymLabel(data.latestYm) : "…"}。緯度経度は非表示（個人情報配慮）。`}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {["安定", "入会", "退会"].map((k) => (
          <button key={k} onClick={() => setKubun(k)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #d1d5db", background: kubun === k ? "#2563eb" : "#fff", color: kubun === k ? "#fff" : "#374151", cursor: "pointer" }}>{k}</button>
        ))}
      </div>
      <FilterBar f={f} setF={setF} options={data?.options} showMemberType={true} />
      <ConditionsPanel f={f} meta={data?.meta} extra={{ 区分: kubun, 対象月: data?.latestYm }} />
      {err && <div style={{ color: "#dc2626" }}>エラー: {err}</div>}
      {loading && <div style={{ color: "#6b7280" }}>読み込み中…</div>}
      {data?.byPref?.length > 0 && <PrefTileMap rows={data.byPref} />}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {[{ t: "性別構成", rows: data?.byGender }, { t: "年代構成", rows: data?.byAge }].map((b) => b.rows?.length > 0 && (
          <div key={b.t} style={{ flex: "1 1 280px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{b.t}</div>
            <ResponsiveContainer width="100%" height={Math.max(150, 30 + (b.rows?.length || 0) * 28)}>
              <BarChart data={b.rows} layout="vertical" margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="key" width={72} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 10, formatter: (v: any) => fmt(Number(v)) }}>
                  {b.rows.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </BiLayout>
  );
}
