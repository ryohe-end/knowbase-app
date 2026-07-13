"use client";

import React from "react";
import Link from "next/link";
import GuideTour from "@/components/GuideTour";

const CogIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
  </svg>
);

const EnvelopeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

const DocumentTextIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

const BanknotesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
  </svg>
);

const StorefrontIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
  </svg>
);

// UserPlusIcon は入会画面設定クローズに伴い未使用のため削除 (後日復活)

export default function StoreSettingsMenu() {
  const menuItems = [
    {
      title: "アプリ基本設定",
      desc: "店舗情報、ブランド設定、各種URLや機能フラグを管理します。",
      href: "/store-settings/basic",
      icon: <CogIcon />,
      color: "#3b82f6",
    },
    {
      title: "PUSH通知設定",
      desc: "会員向けのPUSH通知の配信設定や履歴を確認します。",
      href: "/store-settings/push",
      icon: <BellIcon />,
      color: "#10b981",
    },
    {
      title: "DM送信",
      desc: "特定の会員セグメントに対してダイレクトメッセージを送信します。",
      href: "/store-settings/dm",
      icon: <EnvelopeIcon />,
      color: "#f59e0b",
    },
    {
      title: "規約管理",
      desc: "利用規約、プライバシーポリシーなどの法的文書を編集・更新します。",
      href: "/store-settings/terms",
      icon: <DocumentTextIcon />,
      color: "#8b5cf6",
    },
    {
      title: "店舗詳細管理",
      desc: "Web入会システムの管理者メニュー（入会情報、退会機能、メール設定等）へアクセスします。",
      href: "/store-settings/admin-portal",
      icon: <StorefrontIcon />,
      color: "#e11d48",
      comingSoon: true,
    },
    // 入会画面設定は一旦クローズ (後日開発)。メニューから非表示。ページ/APIは残置。
    {
      title: "返金・入金申請",
      desc: "対象月の返金申請、未納金の入金登録を行います。",
      href: "/store-settings/refund-payment",
      icon: <BanknotesIcon />,
      color: "#0ea5e9",
    },
  ];

  return (
    <div className="kb-store-root">
      <GuideTour
        storageKey="tour_store_top_v1"
        steps={[
          { title: "店舗設定へようこそ", body: "この画面から、配信・規約・返金など店舗運営の各機能にアクセスできます。まず全体の流れをご案内します。" },
          { selector: ".kb-page-header", title: "担当店舗の範囲", body: "表示・操作できるのは、あなたに割り当てられた担当店舗（クラブコード）の範囲です。担当外の店舗データは表示されません。" },
          { selector: ".kb-store-grid", title: "機能メニュー", body: "各カードをクリックすると設定画面が開きます。「準備中」のカードは今後提供予定です。" },
          { selector: ".gt-fab", title: "いつでも見返せます", body: "各画面の右下にある「使い方」ボタンから、いつでもこのガイドを再表示できます。" },
        ]}
      />
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/" className="kb-back-link">← ホームへ戻る</Link>
          <div style={{ fontWeight: 700 }}>店舗アプリ設定</div>
          <a href="/manual/store-settings.html" target="_blank" rel="noopener noreferrer" className="kb-manual-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            運用マニュアル
          </a>
        </div>
      </div>

      <main className="kb-main-container">
        <header className="kb-page-header">
          <div className="kb-badge">STORE MANAGER</div>
          <h1>FIT365 / JOYFIT アプリ設定</h1>
          <p>あなたの店舗のアプリ表示・機能を設定します。</p>
        </header>

        <div className="kb-store-grid">
          {menuItems.map((item) => {
            const card = (
              <div className={`kb-modern-card${item.comingSoon ? " kb-card-soon" : ""}`}>
                <div className="kb-accent-bar" style={{ backgroundColor: item.color }} />
                {item.comingSoon && <span className="kb-soon-badge">Coming Soon</span>}
                <div className="kb-card-body">
                  <div
                    className="kb-card-icon-wrapper"
                    style={{ color: item.color, background: `${item.color}15` }}
                  >
                    {item.icon}
                  </div>
                  <h3 className="kb-card-heading">{item.title}</h3>
                  <p className="kb-card-subtext">{item.desc}</p>
                </div>
                <div className="kb-card-footer">
                  <span className="kb-action-label">{item.comingSoon ? "準備中" : "設定を開く"}</span>
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
      </main>

      <style jsx global>{`
        .kb-store-root { background-color: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .kb-manual-link { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; font-size: 13px; font-weight: 700; color: #4f46e5; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 6px 12px; }
        .kb-manual-link:hover { background: #e0e7ff; }
        .kb-main-container { max-width: 1140px; margin: 0 auto; padding: 40px 24px; }
        .kb-page-header { margin-bottom: 40px; }
        .kb-badge { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: #0f172a; background: #e2e8f0; padding: 4px 10px; border-radius: 4px; margin-bottom: 12px; }
        .kb-page-header h1 { font-size: 28px; font-weight: 800; margin: 0 0 8px 0; }
        .kb-page-header p { font-size: 14px; color: #64748b; margin: 0; }
        .kb-store-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
        .kb-menu-link { text-decoration: none; color: inherit; display: block; height: 100%; }
        .kb-menu-disabled { cursor: not-allowed; }
        .kb-card-soon { opacity: 0.6; filter: grayscale(0.5); }
        .kb-menu-disabled:hover .kb-card-soon { transform: none; box-shadow: none; }
        .kb-soon-badge { position: absolute; top: 10px; right: 10px; z-index: 2; background: #64748b; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; padding: 3px 10px; border-radius: 20px; }

        .kb-modern-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; position: relative; height: 100%; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; overflow: hidden; }
        .kb-modern-card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px -8px rgba(0,0,0,0.1); border-color: #bfdbfe; }

        .kb-accent-bar { height: 4px; width: 100%; }
        .kb-card-body { padding: 32px; flex: 1; }

        .kb-card-icon-wrapper {
          width: 56px; height: 56px;
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 20px;
        }

        .kb-card-heading { font-size: 18px; font-weight: 700; margin: 0 0 10px 0; }
        .kb-card-subtext { font-size: 13px; color: #64748b; line-height: 1.6; margin: 0; }
        .kb-card-footer { padding: 16px 32px; background: #fcfdfe; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
        .kb-action-label { font-size: 12px; font-weight: 700; color: #94a3b8; }
        .kb-action-icon { font-size: 16px; color: #cbd5e1; }
        .kb-modern-card:hover .kb-action-label { color: #3b82f6; }
        .kb-modern-card:hover .kb-action-icon { color: #3b82f6; }
      `}</style>
    </div>
  );
}
