"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StoreSelector from "@/components/StoreSelector";

function OptionUsageInner({ clubCode }: { clubCode: string }) {
  return (
    <div className="ou-root">
      <header className="ou-header">
        <div className="ou-header-inner">
          <Link href={`/store-settings/basic?clubCode=${clubCode}`} className="ou-back-link">
            <span>←</span>
            <span>メニューへ戻る</span>
          </Link>
          <h1 className="ou-page-title">オプション都度利用</h1>
          <div style={{ width: 120 }} />
        </div>
      </header>

      <main className="ou-main">
        <div className="ou-card">
          <div className="ou-store-info">
            <span className="ou-store-label">対象店舗</span>
            <span className="ou-store-code">{clubCode}</span>
          </div>

          <div className="ou-empty">
            <div className="ou-empty-icon">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 48, height: 48 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </div>
            <h2 className="ou-empty-title">オプションの都度利用設定はここから行います</h2>
            <p className="ou-empty-desc">
              各オプションを都度利用として販売するための料金、利用条件、表示設定などを管理します。
              <br />
              設定項目はこのページに追加されます。
            </p>
          </div>
        </div>
      </main>

      <style jsx global>{`
        .ou-root {
          background: linear-gradient(160deg, #f5f3ff 0%, #f8fafc 40%, #ede9fe 100%);
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
          color: #0f172a;
        }
        .ou-header {
          height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(180%);
          border-bottom: 1px solid rgba(226,232,240,0.8); position: sticky; top: 0; z-index: 200;
        }
        .ou-header-inner { max-width: 1280px; margin: 0 auto; padding: 0 24px; height: 100%; display: flex; align-items: center; justify-content: space-between; }
        .ou-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; padding: 6px 12px; border-radius: 8px; transition: 0.15s; display: flex; align-items: center; gap: 6px; }
        .ou-back-link:hover { background: #f1f5f9; color: #334155; }
        .ou-page-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; }

        .ou-main { max-width: 1140px; margin: 0 auto; padding: 32px 24px 80px; }
        .ou-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .ou-store-info { display: flex; align-items: center; gap: 10px; padding-bottom: 20px; margin-bottom: 32px; border-bottom: 1px solid #f1f5f9; }
        .ou-store-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .ou-store-code { background: #1e293b; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-family: "SF Mono", monospace; font-weight: 700; }

        .ou-empty { text-align: center; padding: 40px 20px; }
        .ou-empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 96px; height: 96px; border-radius: 24px; background: #ede9fe; color: #8b5cf6; margin-bottom: 20px; }
        .ou-empty-title { font-size: 18px; font-weight: 700; margin: 0 0 12px 0; color: #1e293b; }
        .ou-empty-desc { font-size: 14px; color: #64748b; line-height: 1.7; margin: 0; }
      `}</style>
    </div>
  );
}

function OptionUsageRouter() {
  const searchParams = useSearchParams();
  const clubCode = searchParams.get("clubCode");

  if (!clubCode) {
    return (
      <StoreSelector
        basePath="/store-settings/basic/option-usage"
        title="オプション都度利用 - 店舗選択"
        backHref="/store-settings"
        backLabel="メニューへ戻る"
      />
    );
  }

  return <OptionUsageInner clubCode={clubCode} />;
}

export default function OptionUsagePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f8fafc" }} />}>
      <OptionUsageRouter />
    </Suspense>
  );
}
