// app/admin/bi/page.tsx — BIダッシュボード一覧(ハブ)
"use client";
import React from "react";
import Link from "next/link";

const BOARDS = [
  { href: "/admin/bi/executive", title: "★ 経営ダッシュボード", desc: "会員数・純増減・会員売上・客単価・都度売上・推移をKPIで一発。全社サマリ" },
  { href: "/admin/bi/member-summary", title: "D1 会員数サマリー", desc: "安定会員数・入会・退会・純増減・解約率・来館率（勝ち負け表_集計）" },
  { href: "/admin/bi/club-comparison", title: "D2 勝ち負け店舗比較", desc: "クラブ別の純増減・解約率・来館率・客単価ランキング" },
  { href: "/admin/bi/family", title: "D3 家族会員", desc: "課金会員・家族会員・付帯率の推移とクラブ別" },
  { href: "/admin/bi/traffic", title: "D4 来館・混雑", desc: "曜日×時間帯ヒートマップ・月次来館数" },
  { href: "/admin/bi/spot-usage", title: "D5 都度利用", desc: "OneTimePass/1DAY/オプション都度の販売・利用率・売上" },
  { href: "/admin/bi/sales-budget", title: "D6 売上・予実", desc: "振替売上・予算・会計実績・達成率・未納率" },
  { href: "/admin/bi/distribution", title: "D7 会員分布", desc: "都道府県別会員数・性別/年代構成（区分切替）" },
  { href: "/bi/enjoy-points.html", title: "EP ENJOYポイント効果検証", desc: "導入効果の判定・店舗別の累計発行/使用/残高(退会含む/除く)。上部フィルタがページ全体に連動", external: true },
];

export default function Page() {
  return (
    <div style={{ padding: 24, background: "#f9fafb", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>BI ダッシュボード</h1>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 20 }}>出典: Snowflake <code>OPENFLOW_DB.MART</code>（読取専用 KB_BI_USER）。率は分子/分母を合算して算出。</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
        {BOARDS.map((b) => {
          const card = (
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 18, height: "100%", transition: "box-shadow .1s" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#2563eb", marginBottom: 6 }}>{b.title}</div>
              <div style={{ fontSize: 13, color: "#4b5563" }}>{b.desc}</div>
            </div>
          );
          // external(静的HTML) は別タブで開く。内部ルートは Next Link。
          return (b as any).external ? (
            <a key={b.href} href={b.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>{card}</a>
          ) : (
            <Link key={b.href} href={b.href} style={{ textDecoration: "none" }}>{card}</Link>
          );
        })}
      </div>
    </div>
  );
}
