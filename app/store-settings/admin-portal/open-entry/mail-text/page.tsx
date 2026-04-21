"use client";

import React, { useState } from "react";
import Link from "next/link";
import { 
  ArrowLeft, Save, Monitor, Mail, 
  HelpCircle, Eye, RefreshCw, Edit3 // ✅ Edit3を追加しました
} from "lucide-react";

export default function MailTextEditPage() {
  const shopName = "旭川アモール";
  const shopId = "000121";

  const [activeTab, setActiveTab] = useState<'COMPLETE' | 'MAIL'>('COMPLETE');
  const [targetType, setTargetType] = useState('WEB_NORMAL'); // WEB_NORMAL, WEB_1980, WEB_PREMIUM

  // サンプルデータ：文面
  const [texts, setTexts] = useState({
    complete_normal: `$name$ 様\n入会番号：$book$\n受付番号: $member$\n\nこの度はFIT365旭川アモールにご入会いただき、誠にありがとうございます！\n\n$start_dt$までにご来店時頂き、入会完了メールを一緒にご持参くださいますよう、宜しくお願いします。\n\n会員証発行のお手続きが必要です。\nご入会開始日までにご来店し会員証発行のお手続きをお願い致します。`,
    mail_normal_subject: "ご入会ありがとうございます！",
    mail_normal_body: `$name$ 様\n\n入会番号：$book$\n受付番号: $member$\n\nこの度はFIT365旭川アモールにご入会いただきまして誠にありがとうございました。\n皆様の快適生活をサポートさせていただくことが出来るよう\nスタッフ一同鋭意努力して参りますので今後とも何卒よろしくお願い致します。\n\n$name$ 様のお支払い内容は以下の通りです。\n\nお支払い内容\n$bill$`,
  });

  // プレビュー生成用ヘルパー（変数置換のみ。改行は CSS の white-space: pre-wrap に任せるので
  // HTML 化しない。XSS 対策として dangerouslySetInnerHTML は使わない）
  const generatePreview = (text: string): string => {
    return text
      .replace(/\$name\$/g, '鈴木 太郎')
      .replace(/\$book\$/g, '12345678')
      .replace(/\$member\$/g, 'M-000123')
      .replace(/\$start_dt\$/g, '2026/04/01')
      .replace(/\$bill\$/g, '----------------------------------\nカード発行料: 5,500円\n月会費: 3,278円\n----------------------------------')
      .replace(/\$activate_url\$/g, 'http://fit365.jp/activate');
  };

  const handleChange = (key: string, value: string) => {
    setTexts(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="mail-root">
      <header className="mail-header">
        <div className="mail-header-inner">
          <div className="mail-brand">
            <Link href="/store-settings/admin-portal/open-entry" className="mail-back-btn">
              <ArrowLeft size={20} />
            </Link>
            <div className="mail-title-group">
              <h1 className="mail-main-title">完了文面・メール編集</h1>
              <p className="mail-sub-title">{shopId} {shopName}</p>
            </div>
          </div>
          <button className="mail-save-btn">
            <Save size={18} />
            内容を保存
          </button>
        </div>
      </header>

      <main className="mail-container">
        
        {/* Tab & Target Selector */}
        <div className="mail-controls">
          <div className="mail-tabs">
            <button 
              className={`mail-tab ${activeTab === 'COMPLETE' ? 'active' : ''}`}
              onClick={() => setActiveTab('COMPLETE')}
            >
              <Monitor size={18} />
              WEB完了画面メッセージ
            </button>
            <button 
              className={`mail-tab ${activeTab === 'MAIL' ? 'active' : ''}`}
              onClick={() => setActiveTab('MAIL')}
            >
              <Mail size={18} />
              自動送信メール設定
            </button>
          </div>

          <div className="mail-target-selector">
            <label>編集対象:</label>
            <select value={targetType} onChange={(e) => setTargetType(e.target.value)}>
              <option value="WEB_NORMAL">WEB入会 (通常)</option>
              <option value="WEB_1980">WEB入会 (1980円会員)</option>
              <option value="WEB_PREMIUM">WEB入会 (プレミアム)</option>
            </select>
          </div>
        </div>

        {/* Editor Area */}
        <div className="mail-editor-grid">
          
          {/* Left: Input Area */}
          <div className="mail-input-panel">
            <div className="panel-header">
              <h3>
                <Edit3 size={16} />
                編集エリア
              </h3>
              <div className="variable-help">
                <button className="help-btn">
                  <HelpCircle size={14} />
                  使用できる変数タグ
                </button>
                <div className="help-tooltip">
                  <p><code>$name$</code> : 氏名</p>
                  <p><code>$member$</code> : 受付番号</p>
                  <p><code>$start_dt$</code> : 開始日</p>
                  <p><code>$bill$</code> : 請求金額</p>
                </div>
              </div>
            </div>

            <div className="panel-body">
              {activeTab === 'MAIL' && (
                <div className="form-group">
                  <label>メール件名</label>
                  <input 
                    type="text" 
                    value={texts.mail_normal_subject} 
                    onChange={(e) => handleChange('mail_normal_subject', e.target.value)}
                    className="subject-input"
                  />
                </div>
              )}
              
              <div className="form-group full-height">
                <label>本文</label>
                <textarea 
                  value={activeTab === 'COMPLETE' ? texts.complete_normal : texts.mail_normal_body}
                  onChange={(e) => handleChange(activeTab === 'COMPLETE' ? 'complete_normal' : 'mail_normal_body', e.target.value)}
                  className="body-textarea"
                />
              </div>
            </div>
          </div>

          {/* Right: Preview Area */}
          <div className="mail-preview-panel">
            <div className="panel-header">
              <h3>
                <Eye size={16} />
                プレビュー (自動置換後)
              </h3>
              <button className="refresh-preview">
                <RefreshCw size={14} />
              </button>
            </div>
            
            <div className="panel-body preview-bg">
              {activeTab === 'MAIL' ? (
                <div className="mail-preview-card">
                  <div className="preview-meta">
                    <span className="label">件名:</span>
                    <span className="value">{texts.mail_normal_subject}</span>
                  </div>
                  <div className="preview-content">
                    {generatePreview(texts.mail_normal_body)}
                  </div>
                </div>
              ) : (
                <div className="web-preview-card">
                  <div className="browser-mockup">
                    <div className="browser-bar">
                      <div className="dots"><span></span><span></span><span></span></div>
                    </div>
                    <div className="browser-content">
                      {generatePreview(texts.complete_normal)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>

      <style jsx global>{`
        .mail-root { background-color: #f8fafc; min-height: 100vh; font-family: 'Inter', sans-serif; color: #334155; }
        
        /* Header */
        .mail-header { background: #fff; height: 64px; border-bottom: 2px solid #fbbf24; sticky top: 0; z-index: 100; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .mail-header-inner { max-width: 1400px; margin: 0 auto; height: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; }
        .mail-brand { display: flex; align-items: center; gap: 16px; }
        .mail-back-btn { color: #94a3b8; transition: 0.2s; display: flex; }
        .mail-back-btn:hover { color: #fbbf24; }
        .mail-title-group { line-height: 1.2; }
        .mail-main-title { font-size: 16px; font-weight: 800; color: #1e293b; margin: 0; }
        .mail-sub-title { font-size: 12px; color: #64748b; font-weight: 600; }
        .mail-save-btn { background: #1e293b; color: #fff; border: none; padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: 0.2s; }
        .mail-save-btn:hover { background: #0f172a; transform: translateY(-1px); }

        .mail-container { max-width: 1400px; margin: 0 auto; padding: 24px; }

        /* Controls */
        .mail-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .mail-tabs { display: flex; gap: 4px; background: #e2e8f0; padding: 4px; border-radius: 12px; }
        .mail-tab { border: none; background: transparent; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: 0.2s; }
        .mail-tab.active { background: #fff; color: #1e293b; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }

        .mail-target-selector { display: flex; align-items: center; gap: 12px; background: #fff; padding: 8px 16px; border-radius: 12px; border: 1px solid #e2e8f0; }
        .mail-target-selector label { font-size: 12px; font-weight: 700; color: #94a3b8; }
        .mail-target-selector select { border: none; font-size: 13px; font-weight: 700; color: #1e293b; outline: none; background: transparent; cursor: pointer; }

        /* Editor Grid */
        .mail-editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; height: calc(100vh - 180px); min-height: 600px; }
        
        .mail-input-panel, .mail-preview-panel { background: #fff; border-radius: 16px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; overflow: hidden; }
        
        .panel-header { padding: 12px 20px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; background: #fff; }
        .panel-header h3 { font-size: 13px; font-weight: 800; color: #475569; display: flex; align-items: center; gap: 8px; margin: 0; }
        
        .panel-body { padding: 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
        .panel-body.preview-bg { background: #f1f5f9; }

        /* Variable Help */
        .variable-help { position: relative; }
        .help-btn { font-size: 11px; font-weight: 700; color: #3b82f6; background: #eff6ff; border: none; padding: 4px 10px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
        .help-tooltip { display: none; position: absolute; top: 100%; right: 0; background: #1e293b; color: #fff; padding: 12px; border-radius: 8px; font-size: 11px; width: 200px; z-index: 10; margin-top: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .variable-help:hover .help-tooltip { display: block; }
        .help-tooltip code { background: rgba(255,255,255,0.2); padding: 2px 4px; border-radius: 4px; font-family: monospace; margin-right: 6px; }
        .help-tooltip p { margin: 4px 0; }

        /* Forms */
        .form-group { display: flex; flex-direction: column; gap: 8px; }
        .form-group.full-height { flex: 1; }
        .form-group label { font-size: 12px; font-weight: 700; color: #64748b; }
        .subject-input { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; font-size: 14px; font-weight: 600; outline: none; transition: 0.2s; }
        .subject-input:focus { border-color: #3b82f6; ring: 2px solid #eff6ff; }
        .body-textarea { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; font-size: 14px; line-height: 1.6; outline: none; resize: none; font-family: monospace; min-height: 400px; }
        .body-textarea:focus { border-color: #3b82f6; }

        /* Preview Cards */
        .mail-preview-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); }
        .preview-meta { padding-bottom: 12px; border-bottom: 1px solid #f1f5f9; margin-bottom: 16px; display: flex; gap: 8px; align-items: baseline; }
        .preview-meta .label { font-size: 11px; font-weight: 700; color: #94a3b8; }
        .preview-meta .value { font-size: 14px; font-weight: 700; color: #1e293b; }
        .preview-content { font-size: 13px; line-height: 1.7; color: #334155; white-space: pre-wrap; }

        .web-preview-card { display: flex; justify-content: center; padding-top: 20px; }
        .browser-mockup { width: 100%; max-width: 400px; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
        .browser-bar { background: #f8fafc; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; display: flex; }
        .dots { display: flex; gap: 4px; }
        .dots span { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
        .dots span:nth-child(1) { background: #ef4444; }
        .dots span:nth-child(2) { background: #f59e0b; }
        .dots span:nth-child(3) { background: #10b981; }
        .browser-content { padding: 20px; font-size: 13px; line-height: 1.6; color: #334155; white-space: pre-wrap; }

        .refresh-preview { background: transparent; border: none; color: #94a3b8; cursor: pointer; transition: 0.2s; }
        .refresh-preview:hover { color: #3b82f6; transform: rotate(180deg); }

        @media (max-width: 1024px) {
          .mail-editor-grid { grid-template-columns: 1fr; height: auto; }
        }
      `}</style>
    </div>
  );
}