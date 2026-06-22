"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

type ConfigStatus = { ok: boolean; fromEmail?: string; reason?: string } | null;

export default function MailTestPage() {
  const [config, setConfig] = useState<ConfigStatus>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 画面読み込み時に設定チェック
  useEffect(() => {
    fetch("/api/mail-test")
      .then((r) => r.json())
      .then((data) => setConfig(data))
      .catch(() => setConfig({ ok: false, reason: "API通信に失敗しました" }))
      .finally(() => setConfigLoading(false));
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!to.trim()) return;

    setSending(true);
    setResult(null);

    try {
      const res = await fetch("/api/mail-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim() }),
      });
      const json = await res.json();

      if (json.ok) {
        setResult({ ok: true, message: `${to.trim()} にテストメールを送信しました。受信ボックスを確認してください。` });
      } else {
        setResult({ ok: false, message: `送信失敗: ${json.reason}` });
      }
    } catch {
      setResult({ ok: false, message: "通信エラーが発生しました。" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-root">
      {/* Top bar */}
      <div className="mt-topbar">
        <div className="mt-topbar-inner">
          <div className="mt-topbar-left">
            <img
              src="/logos/KnowBase_icon.png"
              alt="Logo"
              className="mt-logo-icon"
            />
            <img
              src="/logos/KnowBase_CR.png"
              alt="Know Base"
              className="mt-logo-text"
            />
          </div>
          <div className="mt-topbar-right">
            <Link href="/admin" className="mt-back-btn">
              管理トップへ戻る
            </Link>
          </div>
        </div>
      </div>

      <main className="mt-main">
        <header className="mt-header">
          <div className="mt-badge">MAIL TEST</div>
          <h1>メール送信テスト</h1>
          <p>SendGrid の設定確認と、指定アドレスへのテスト送信を行います</p>
        </header>

        {/* 設定チェック */}
        <section className="mt-card">
          <h2 className="mt-card-title">SendGrid 設定状況</h2>
          {configLoading ? (
            <p className="mt-loading">確認中...</p>
          ) : config?.ok ? (
            <div className="mt-status mt-status-ok">
              <span className="mt-status-icon">OK</span>
              <div>
                <div className="mt-status-label">設定正常</div>
                <div className="mt-status-detail">送信元: {config.fromEmail}</div>
              </div>
            </div>
          ) : (
            <div className="mt-status mt-status-ng">
              <span className="mt-status-icon">NG</span>
              <div>
                <div className="mt-status-label">設定エラー</div>
                <div className="mt-status-detail">{config?.reason}</div>
              </div>
            </div>
          )}
        </section>

        {/* 送信フォーム */}
        <section className="mt-card">
          <h2 className="mt-card-title">テストメール送信</h2>
          <form onSubmit={handleSend} className="mt-form">
            <label className="mt-label" htmlFor="to-email">
              送信先メールアドレス
            </label>
            <div className="mt-input-row">
              <input
                id="to-email"
                type="email"
                className="mt-input"
                placeholder="example@okamoto-group.co.jp"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
                disabled={!config?.ok || sending}
              />
              <button
                type="submit"
                className="mt-send-btn"
                disabled={!config?.ok || sending || !to.trim()}
              >
                {sending ? "送信中..." : "テスト送信"}
              </button>
            </div>
          </form>

          {result && (
            <div className={`mt-result ${result.ok ? "mt-result-ok" : "mt-result-ng"}`}>
              {result.message}
            </div>
          )}
        </section>
      </main>

      <style jsx>{`
        .mt-root {
          min-height: 100vh;
          background-color: #fcfdfe;
          color: #0f172a;
          font-family: "Inter", -apple-system, sans-serif;
        }

        /* Topbar */
        .mt-topbar {
          height: 64px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid #e2e8f0;
          position: sticky;
          top: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
        }
        .mt-topbar-inner {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 32px;
        }
        .mt-topbar-left {
          display: flex;
          align-items: center;
        }
        .mt-logo-icon {
          width: 32px;
          height: 32px;
        }
        .mt-logo-text {
          height: 16px;
          margin-left: 12px;
        }
        .mt-topbar-right {
          display: flex;
          align-items: center;
        }

        /* Main */
        .mt-main {
          max-width: 640px;
          margin: 0 auto;
          padding: 60px 32px;
        }
        .mt-header {
          margin-bottom: 40px;
        }
        .mt-badge {
          display: inline-block;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.15em;
          color: #3b82f6;
          background: #eff6ff;
          padding: 4px 10px;
          border-radius: 4px;
          margin-bottom: 12px;
        }
        .mt-header h1 {
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 8px 0;
        }
        .mt-header p {
          font-size: 15px;
          color: #64748b;
          margin: 0;
        }

        /* Card */
        .mt-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 28px;
          margin-bottom: 24px;
        }
        .mt-card-title {
          font-size: 16px;
          font-weight: 700;
          color: #1e293b;
          margin: 0 0 16px 0;
        }

        /* Status */
        .mt-loading {
          color: #64748b;
          font-size: 14px;
        }
        .mt-status {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px;
          border-radius: 10px;
        }
        .mt-status-ok {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
        }
        .mt-status-ng {
          background: #fef2f2;
          border: 1px solid #fecaca;
        }
        .mt-status-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          font-size: 12px;
          font-weight: 800;
          flex-shrink: 0;
        }
        .mt-status-ok .mt-status-icon {
          background: #22c55e;
          color: #fff;
        }
        .mt-status-ng .mt-status-icon {
          background: #ef4444;
          color: #fff;
        }
        .mt-status-label {
          font-size: 14px;
          font-weight: 700;
          color: #1e293b;
        }
        .mt-status-detail {
          font-size: 13px;
          color: #64748b;
          margin-top: 2px;
        }

        /* Form */
        .mt-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .mt-label {
          font-size: 13px;
          font-weight: 600;
          color: #475569;
        }
        .mt-input-row {
          display: flex;
          gap: 10px;
        }
        .mt-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }
        .mt-input:focus {
          border-color: #3b82f6;
        }
        .mt-input:disabled {
          background: #f8fafc;
          color: #94a3b8;
        }

        .mt-send-btn {
          padding: 10px 24px;
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.2s;
          white-space: nowrap;
        }
        .mt-send-btn:hover:not(:disabled) {
          background: #1d4ed8;
        }
        .mt-send-btn:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        /* Result */
        .mt-result {
          margin-top: 16px;
          padding: 14px;
          border-radius: 10px;
          font-size: 14px;
          line-height: 1.6;
        }
        .mt-result-ok {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #166534;
        }
        .mt-result-ng {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #991b1b;
        }

        /* Back button */
        .mt-back-btn {
          background: #fff;
          border: 1px solid #e2e8f0;
          padding: 6px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          cursor: pointer;
          transition: 0.2s;
          text-decoration: none;
        }
        .mt-back-btn:hover {
          background: #f8fafc;
          border-color: #3b82f6;
          color: #3b82f6;
        }

        @media (max-width: 480px) {
          .mt-input-row {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
