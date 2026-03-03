"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation"; // ✅ 追加
import { 
  Store, Settings, Users, BarChart3, CreditCard, Mail, 
  FileText, LogOut, RefreshCw, CalendarDays, HelpCircle, 
  UserCheck, ChevronRight, ArrowLeft, 
  ClipboardList, History, Layers, ShieldCheck
} from "lucide-react";

export default function WebEntryAdminPage() {
  const router = useRouter(); // ✅ 追加
  const shopName = "旭川アモール";
  const shopId = "000121";

  const handleExternalLink = (url: string, target = "_self") => {
    if (typeof window !== "undefined") window.open(url, target);
  };

  return (
    <div className="admin-root">
      {/* Header - 洗練されたフラットデザイン */}
      <header className="admin-header">
        <div className="admin-header-inner">
          <div className="admin-brand">
            <Link href="/store-settings" className="admin-back-link">
              <ArrowLeft size={20} />
            </Link>
            <div className="admin-title-group">
              <h1 className="admin-main-title">Web入会システム管理</h1>
              <p className="admin-sub-title">{shopId} {shopName}</p>
            </div>
          </div>
          <div className="admin-header-actions">
            <div className="admin-status-indicator">
              <span className="admin-status-dot"></span>
              <span className="admin-status-text">稼働中</span>
            </div>
          </div>
        </div>
      </header>

      <main className="admin-content">
        <div className="admin-container">
          
          <div className="admin-dashboard-layout">
            
            {/* 左側：メイン機能（分析・設定） */}
            <div className="admin-main-col">
              
              {/* 分析セクション */}
              <section className="admin-card-section">
                <div className="admin-section-header">
                  <div className="admin-section-title">
                    <BarChart3 size={18} className="text-blue" />
                    <span>データ分析・閲覧</span>
                  </div>
                </div>
                <div className="admin-grid-tiles">
                  {/* ✅ Next.jsのページへ遷移 */}
                  <TileButton 
                    title="入会情報閲覧" 
                    sub="詳細検索・会員データ確認" 
                    icon={<Users />} 
                    color="#3b82f6" 
                    onClick={() => router.push('/store-settings/admin-portal/entry')} 
                  />
                  <TileButton 
                    title="入会経路集計" 
                    sub="メディア別流入分析" 
                    icon={<BarChart3 />} 
                    color="#10b981" 
                    onClick={() => handleExternalLink(`/tracking_summary/index${shopId}.na`)} 
                  />
                  <TileButton 
                    title="アンケート集計" 
                    sub="属性・意識調査結果" 
                    icon={<ClipboardList />} 
                    color="#8b5cf6" 
                    onClick={() => handleExternalLink(`/kanri2/anket?s=${shopId}&url=/admin/${shopId}/`)} 
                  />
                  <TileButton 
                    title="退会・変更履歴" 
                    sub="操作ログのトレース" 
                    icon={<History />} 
                    color="#64748b" 
                    onClick={() => handleExternalLink(`/wdop_history/withdrawal.na?s=${shopId}&url=/admin/${shopId}/`)} 
                  />
                </div>
              </section>

              {/* 設定セクション */}
              <section className="admin-card-section" style={{ marginTop: '32px' }}>
                <div className="admin-section-header">
                  <div className="admin-section-title">
                    <Settings size={18} className="text-slate" />
                    <span>システム・マスタ設定</span>
                  </div>
                </div>
                <div className="admin-list-group">
                  <ListItem title="管理者メールアドレス設定" icon={<Mail />} onClick={() => handleExternalLink(`/kanri2/adminMailSetting?s=${shopId}&url=/admin/${shopId}/`)} />
                  <ListItem title="ご利用開始日編集" icon={<CalendarDays />} onClick={() => console.log('POST: start_date_edit2')} />
                  <ListItem title="プレミアム登録設定" icon={<Layers />} onClick={() => handleExternalLink(`/kanri2/premium?s=${shopId}&url=/admin/${shopId}/`)} />
                  <ListItem title="オープン後入会設定" icon={<UserCheck />} onClick={() => handleExternalLink(`/kanri2/openEntry?s=${shopId}&url=/admin/${shopId}/`)} />
                  <ListItem title="休会退会設定" icon={<LogOut />} onClick={() => handleExternalLink(`https://qtform.fit365-service.jp/admin/Pd8o0YNuzfTZM74eB8tRXwEnkaupKAgf.jsp?s=121&url=https://entry.fit365.jp/admin/${shopId}/`)} />
                </div>
              </section>
            </div>

            {/* 右側：アクション・サポート */}
            <div className="admin-side-col">
              
              {/* 会員操作（最重要アクション） */}
              <section className="admin-card-section">
                <div className="admin-section-header">
                  <div className="admin-section-title">
                    <ShieldCheck size={18} className="text-orange" />
                    <span>会員ステータス操作</span>
                  </div>
                </div>
                <div className="admin-action-stack">
                  <ActionButton title="退会機能" desc="即時退会処理を実行" color="#ef4444" icon={<LogOut />} onClick={() => console.log('POST: kk_withdraw2')} />
                  <ActionButton title="オプション変更機能" desc="付帯サービスの追加・解約" color="#f59e0b" icon={<RefreshCw />} onClick={() => console.log('POST: kk_option2')} />
                  <ActionButton title="主契約変更機能" desc="プランのアップグレード等" color="#4f46e5" icon={<FileText />} onClick={() => handleExternalLink(`/kanri2/searchContractChangeList?s=${shopId}&url=/admin/${shopId}/`)} />
                </div>
              </section>

              {/* その他決済等 */}
              <section className="admin-card-section" style={{ marginTop: '32px' }}>
                <div className="admin-list-group">
                  <ListItem title="1DayPass関連設定" icon={<CalendarDays />} onClick={() => handleExternalLink(`/kanri2/oneDayPass?s=${shopId}&url=/admin/${shopId}/`)} />
                  <ListItem title="レズミルズ関連設定" icon={<Settings />} onClick={() => handleExternalLink(`/kanri2/lesmills?s=${shopId}&url=/admin/${shopId}/`)} />
                  <ListItem title="クレカ情報変更" icon={<CreditCard />} onClick={() => handleExternalLink(`/sbps_reg/?shop=${shopId}`, '_blank')} />
                  <ListItem title="復会者一覧 (External)" icon={<RefreshCw />} onClick={() => handleExternalLink(`https://comebackcp.wf-datahub.com/?club_cd=${shopId}`, '_blank')} />
                </div>
              </section>

              {/* サポート */}
              <div className="admin-help-box">
                <div className="admin-help-header">
                  <HelpCircle size={20} />
                  <span>サポート案内</span>
                </div>
                <p>クレジットカード関連のトラブルや操作の不明点はこちら。</p>
                <button className="admin-help-btn" onClick={() => console.log('POST: inquiry')}>お問い合わせフォーム</button>
              </div>
            </div>

          </div>
        </div>
      </main>

      <style jsx global>{`
        /* 既存のスタイルを維持 */
        .admin-root { background-color: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; }
        .admin-header { background: #fff; height: 72px; border-bottom: 2px solid #fbbf24; position: sticky; top: 0; z-index: 50; }
        .admin-header-inner { max-width: 1240px; margin: 0 auto; height: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; }
        .admin-brand { display: flex; align-items: center; gap: 20px; }
        .admin-back-link { color: #94a3b8; transition: 0.2s; display: flex; }
        .admin-back-link:hover { color: #fbbf24; }
        .admin-title-group { line-height: 1.2; }
        .admin-main-title { font-size: 18px; font-weight: 800; color: #1e293b; margin: 0; }
        .admin-sub-title { font-size: 13px; color: #64748b; font-weight: 600; }
        .admin-status-indicator { display: flex; align-items: center; gap: 8px; background: #f8fafc; padding: 6px 12px; border-radius: 20px; border: 1px solid #e2e8f0; }
        .admin-status-dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.1); }
        .admin-status-text { font-size: 11px; font-weight: 800; color: #059669; }
        .admin-container { max-width: 1240px; margin: 0 auto; padding: 40px 24px; }
        .admin-dashboard-layout { display: grid; grid-template-columns: 1fr 380px; gap: 32px; }
        .admin-section-header { margin-bottom: 16px; padding-left: 4px; }
        .admin-section-title { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
        .admin-grid-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
        .admin-tile { background: #fff; border: 1px solid #e2e8f0; border-radius: 24px; padding: 24px; transition: 0.2s; cursor: pointer; display: flex; gap: 20px; text-align: left; width: 100%; }
        .admin-tile:hover { transform: translateY(-4px); border-color: #fbbf24; box-shadow: 0 12px 20px -5px rgba(0,0,0,0.05); }
        .admin-tile-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; shrink-0; }
        .admin-tile-body { display: flex; flex-direction: column; justify-content: center; }
        .admin-tile-h { font-size: 15px; font-weight: 800; color: #1e293b; margin-bottom: 2px; }
        .admin-tile-p { font-size: 12px; color: #94a3b8; font-weight: 500; }
        .admin-list-group { background: #fff; border-radius: 24px; border: 1px solid #e2e8f0; overflow: hidden; }
        .admin-list-item { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; transition: 0.2s; cursor: pointer; border: none; background: transparent; width: 100%; border-bottom: 1px solid #f1f5f9; }
        .admin-list-item:last-child { border-bottom: none; }
        .admin-list-item:hover { background: #f8fafc; padding-left: 30px; }
        .admin-li-left { display: flex; align-items: center; gap: 16px; }
        .admin-li-icon { color: #94a3b8; }
        .admin-list-item:hover .admin-li-icon { color: #fbbf24; }
        .admin-li-text { font-size: 14px; font-weight: 700; color: #475569; }
        .admin-action-stack { display: flex; flex-direction: column; gap: 12px; }
        .admin-action-btn { background: #fff; border: 1px solid #e2e8f0; border-radius: 20px; padding: 20px; display: flex; align-items: center; gap: 16px; transition: 0.2s; cursor: pointer; text-align: left; width: 100%; }
        .admin-action-btn:hover { transform: scale(1.02); border-color: #fbbf24; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); }
        .admin-action-icon-box { padding: 10px; border-radius: 12px; display: flex; }
        .admin-action-title { font-size: 15px; font-weight: 800; color: #1e293b; display: block; }
        .admin-action-desc { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .admin-help-box { background: #1e293b; color: #fff; border-radius: 28px; padding: 28px; margin-top: 24px; }
        .admin-help-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-weight: 800; font-size: 15px; color: #fbbf24; }
        .admin-help-box p { font-size: 12px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }
        .admin-help-btn { width: 100%; background: #fbbf24; color: #1e293b; border: none; padding: 12px; border-radius: 14px; font-weight: 800; font-size: 13px; cursor: pointer; transition: 0.2s; }
        .admin-help-btn:hover { background: #fcd34d; transform: translateY(-2px); }
        .text-blue { color: #3b82f6; }
        .text-slate { color: #64748b; }
        .text-orange { color: #f59e0b; }
        @media (max-width: 1024px) {
          .admin-dashboard-layout { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

// 部品：タイルボタン
const TileButton = ({ title, sub, icon, color, onClick }: any) => (
  <button className="admin-tile" onClick={onClick}>
    <div className="admin-tile-icon" style={{ backgroundColor: `${color}12`, color }}>
      {React.cloneElement(icon, { size: 24 })}
    </div>
    <div className="admin-tile-body">
      <span className="admin-tile-h">{title}</span>
      <span className="admin-tile-p">{sub}</span>
    </div>
  </button>
);

// 部品：リストアイテム
const ListItem = ({ title, icon, onClick }: any) => (
  <button className="admin-list-item" onClick={onClick}>
    <div className="admin-li-left">
      <div className="admin-li-icon">{React.cloneElement(icon, { size: 20 })}</div>
      <span className="admin-li-text">{title}</span>
    </div>
    <ChevronRight size={16} color="#cbd5e1" />
  </button>
);

// 部品：アクションボタン
const ActionButton = ({ title, desc, color, icon, onClick }: any) => (
  <button className="admin-action-btn" onClick={onClick}>
    <div className="admin-action-icon-box" style={{ backgroundColor: `${color}10`, color }}>
      {React.cloneElement(icon, { size: 22 })}
    </div>
    <div style={{ flex: 1 }}>
      <span className="admin-action-title">{title}</span>
      <span className="admin-action-desc">{desc}</span>
    </div>
    <ChevronRight size={18} color="#cbd5e1" />
  </button>
);