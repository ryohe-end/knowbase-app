"use client";

import React from "react";
import Link from "next/link";

// Heroicons(outline) — 既存ハブと同じ作法。派手なグラデ/絵文字は使わない。
const DocIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);
const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);
const FlowIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
  </svg>
);

type Item = { title: string; desc: string; href: string; icon: React.ReactNode; color: string; comingSoon?: boolean; step: string };

export default function DesignHome() {
  const items: Item[] = [
    {
      step: "①",
      title: "仕様書・標準図の登録・管理",
      desc: "仕様書・標準図(PDF/CAD)を登録・編集する管理画面(設計担当)。閲覧は全社向けの閲覧画面(/specs)で行えます。",
      href: "/design/specs",
      icon: <DocIcon />,
      color: "#2563eb",
    },
    {
      step: "②",
      title: "元図面データの整備",
      desc: "店舗図面をクラブコードで管理・検索。店舗データベースと紐づけて、該当店の図面フォルダにすぐ辿れるようにします。",
      href: "/design/drawings",
      icon: <FolderIcon />,
      color: "#0891b2",
      comingSoon: true,
    },
    {
      step: "③",
      title: "リニューアル業務フロー",
      desc: "運営からの依頼窓口(フォーム)から、ゾーニング→平面図→承認→稟議→支払いまでの進行を1つの導線で管理します。",
      href: "/design/renewal",
      icon: <FlowIcon />,
      color: "#d97706",
      comingSoon: true,
    },
  ];

  return (
    <div className="kb-design-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/" className="kb-back-link">← ホームへ戻る</Link>
          <div style={{ fontWeight: 700 }}>設計業務</div>
          <span style={{ width: 88 }} />
        </div>
      </div>

      <main className="kb-main-container">
        <header className="kb-page-header">
          <div className="kb-badge">DESIGN</div>
          <h1>設計業務ポータル</h1>
          <p>仕様書・標準図の整備、元図面データの管理、リニューアル業務フローを一元管理します。（FIT365 / JOYFIT / ジョイリハ）</p>
        </header>

        <section className="kb-cat-section">
          <h2 className="kb-cat-title">対策メニュー</h2>
          <div className="kb-design-grid">
            {items.map((item) => {
              const card = (
                <div className={`kb-modern-card${item.comingSoon ? " kb-card-soon" : ""}`}>
                  <div className="kb-accent-bar" style={{ backgroundColor: item.color }} />
                  {item.comingSoon && <span className="kb-soon-badge">Coming Soon</span>}
                  <div className="kb-card-body">
                    <div className="kb-card-icon-wrapper" style={{ color: item.color, background: `${item.color}15` }}>
                      {item.icon}
                    </div>
                    <div className="kb-card-step" style={{ color: item.color }}>{item.step}</div>
                    <h3 className="kb-card-heading">{item.title}</h3>
                    <p className="kb-card-subtext">{item.desc}</p>
                  </div>
                  <div className="kb-card-footer">
                    <span className="kb-action-label">{item.comingSoon ? "準備中" : "開く"}</span>
                    <span className="kb-action-icon">→</span>
                  </div>
                </div>
              );
              return item.comingSoon ? (
                <div key={item.title} className="kb-menu-link kb-menu-disabled" aria-disabled title="準備中です">{card}</div>
              ) : (
                <Link href={item.href} key={item.title} className="kb-menu-link">{card}</Link>
              );
            })}
          </div>
        </section>
      </main>

      <style jsx global>{`
        .kb-design-root { background-color: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .kb-main-container { max-width: 1140px; margin: 0 auto; padding: 40px 24px; }
        .kb-page-header { margin-bottom: 36px; }
        .kb-badge { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: #0f172a; background: #e2e8f0; padding: 4px 10px; border-radius: 4px; margin-bottom: 12px; }
        .kb-page-header h1 { font-size: 28px; font-weight: 800; margin: 0 0 8px 0; }
        .kb-page-header p { font-size: 14px; color: #64748b; margin: 0; line-height: 1.7; }
        .kb-cat-section { margin-bottom: 32px; }
        .kb-cat-title { font-size: 13px; font-weight: 800; color: #475569; margin: 0 0 14px; padding-left: 12px; border-left: 4px solid #cbd5e1; letter-spacing: 0.02em; }
        .kb-design-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
        .kb-menu-link { text-decoration: none; color: inherit; display: block; height: 100%; }
        .kb-menu-disabled { cursor: not-allowed; }
        .kb-modern-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; position: relative; height: 100%; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; overflow: hidden; }
        .kb-menu-link:not(.kb-menu-disabled) .kb-modern-card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px -8px rgba(0,0,0,0.1); border-color: #bfdbfe; }
        .kb-card-soon { filter: grayscale(0.12); }
        .kb-soon-badge { position: absolute; top: 12px; right: 12px; z-index: 3; background: #f1f5f9; color: #64748b; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; padding: 4px 12px; border-radius: 20px; border: 1px solid #e2e8f0; text-transform: uppercase; }
        .kb-accent-bar { height: 4px; width: 100%; }
        .kb-card-body { padding: 22px 22px 18px; flex: 1; }
        .kb-card-icon-wrapper { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
        .kb-card-step { font-size: 12px; font-weight: 900; letter-spacing: 0.05em; margin-bottom: 4px; }
        .kb-card-heading { font-size: 16px; font-weight: 800; margin: 0 0 8px 0; }
        .kb-card-subtext { font-size: 12.5px; color: #64748b; line-height: 1.65; margin: 0; }
        .kb-card-footer { padding: 12px 22px; background: #fcfdfe; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
        .kb-action-label { font-size: 12px; font-weight: 700; color: #94a3b8; }
        .kb-action-icon { font-size: 16px; color: #cbd5e1; }
        .kb-menu-link:not(.kb-menu-disabled) .kb-modern-card:hover .kb-action-label { color: #2563eb; }
        .kb-menu-link:not(.kb-menu-disabled) .kb-modern-card:hover .kb-action-icon { color: #2563eb; }
      `}</style>
    </div>
  );
}
