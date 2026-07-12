"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StoreSelector from "@/components/StoreSelector";

type EntryScreenConfig = {
  brandColor: string;
  logoUrl: string;
  headline: string;
  subHeadline: string;
  description: string;
  campaignTitle: string;
  campaignBody: string;
  notes: string;
  ctaLabel: string;
};

const DEFAULT_CONFIG: EntryScreenConfig = {
  brandColor: "#e11d48",
  logoUrl: "",
  headline: "FIT365 旭川アモール店",
  subHeadline: "24時間営業 / マシン特化型ジム",
  description:
    "通いやすさと続けやすさを追求したフィットネスジムです。スタッフ常駐時間以外もご利用いただけます。",
  campaignTitle: "今月の入会キャンペーン",
  campaignBody: "事務手数料 0円 + 当月会費無料！",
  notes:
    "・入会には本人確認書類が必要です。\n・クレジットカードまたは口座振替がご利用いただけます。",
  ctaLabel: "Web入会を始める",
};

function EntryScreenSettingsPage({ clubCode }: { clubCode: string }) {
  const [config, setConfig] = useState<EntryScreenConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // 保存済み設定を取得 (未保存クラブは既定値)
  useEffect(() => {
    let alive = true;
    fetch(`/api/store-settings/entry-screen?clubCode=${encodeURIComponent(clubCode)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.config) return;
        const c = d.config;
        setConfig({
          brandColor: c.brandColor ?? DEFAULT_CONFIG.brandColor,
          logoUrl: c.logoUrl ?? "",
          headline: c.headline ?? "",
          subHeadline: c.subHeadline ?? "",
          description: c.description ?? "",
          campaignTitle: c.campaignTitle ?? "",
          campaignBody: c.campaignBody ?? "",
          notes: c.notes ?? "",
          ctaLabel: c.ctaLabel ?? DEFAULT_CONFIG.ctaLabel,
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [clubCode]);

  const update = <K extends keyof EntryScreenConfig>(key: K, value: EntryScreenConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/store-settings/entry-screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubCode, ...config }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "保存に失敗しました");
      setSavedAt(new Date().toLocaleTimeString("ja-JP"));
    } catch (e: any) {
      alert(e?.message || "保存エラー");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm("初期値に戻します。よろしいですか？")) setConfig(DEFAULT_CONFIG);
  };

  return (
    <div className="es-root">
      <header className="es-header">
        <div className="es-header-inner">
          <Link href="/store-settings" className="es-back">← 店舗アプリ設定へ戻る</Link>
          <div className="es-title-group">
            <h1 className="es-title">入会画面設定</h1>
            <p className="es-subtitle">Web入会画面の表示内容を編集し、右側でプレビュー確認できます</p>
          </div>
          <div className="es-actions">
            {savedAt && <span className="es-saved">保存しました ({savedAt})</span>}
            <button className="es-btn es-btn-ghost" onClick={handleReset} disabled={saving}>初期化</button>
            <button className="es-btn es-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存する"}
            </button>
          </div>
        </div>
      </header>

      <main className="es-main">
        <div className="es-layout">
          {/* 左：設定フォーム */}
          <section className="es-form">
            <FormSection title="ブランド設定">
              <Field label="メインカラー">
                <div className="es-color-row">
                  <input
                    type="color"
                    value={config.brandColor}
                    onChange={(e) => update("brandColor", e.target.value)}
                    className="es-color-input"
                  />
                  <input
                    type="text"
                    value={config.brandColor}
                    onChange={(e) => update("brandColor", e.target.value)}
                    className="es-text-input"
                    placeholder="#e11d48"
                  />
                </div>
              </Field>
              <Field label="ロゴ画像URL（任意）">
                <input
                  type="text"
                  value={config.logoUrl}
                  onChange={(e) => update("logoUrl", e.target.value)}
                  className="es-text-input"
                  placeholder="https://example.com/logo.png"
                />
              </Field>
            </FormSection>

            <FormSection title="ヘッダーコピー">
              <Field label="メインキャッチコピー">
                <input
                  type="text"
                  value={config.headline}
                  onChange={(e) => update("headline", e.target.value)}
                  className="es-text-input"
                  maxLength={40}
                />
              </Field>
              <Field label="サブキャッチコピー">
                <input
                  type="text"
                  value={config.subHeadline}
                  onChange={(e) => update("subHeadline", e.target.value)}
                  className="es-text-input"
                  maxLength={60}
                />
              </Field>
            </FormSection>

            <FormSection title="店舗紹介文">
              <Field label="本文">
                <textarea
                  value={config.description}
                  onChange={(e) => update("description", e.target.value)}
                  className="es-textarea"
                  rows={4}
                />
              </Field>
            </FormSection>

            <FormSection title="キャンペーン">
              <Field label="キャンペーンタイトル">
                <input
                  type="text"
                  value={config.campaignTitle}
                  onChange={(e) => update("campaignTitle", e.target.value)}
                  className="es-text-input"
                />
              </Field>
              <Field label="キャンペーン本文">
                <input
                  type="text"
                  value={config.campaignBody}
                  onChange={(e) => update("campaignBody", e.target.value)}
                  className="es-text-input"
                />
              </Field>
            </FormSection>

            <FormSection title="注意事項">
              <Field label="注意事項本文（改行可）">
                <textarea
                  value={config.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  className="es-textarea"
                  rows={4}
                />
              </Field>
            </FormSection>

            <FormSection title="CTAボタン">
              <Field label="ボタンラベル">
                <input
                  type="text"
                  value={config.ctaLabel}
                  onChange={(e) => update("ctaLabel", e.target.value)}
                  className="es-text-input"
                  maxLength={20}
                />
              </Field>
            </FormSection>
          </section>

          {/* 右：プレビュー */}
          <aside className="es-preview-pane">
            <div className="es-preview-label">
              <span className="es-preview-dot" />
              リアルタイムプレビュー
            </div>
            <div className="es-phone-frame">
              <div className="es-phone-notch" />
              <div className="es-phone-screen">
                <PreviewContent config={config} />
              </div>
            </div>
          </aside>
        </div>
      </main>

      <style jsx global>{`
        .es-root { background: #f8fafc; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .es-header { background: #fff; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 50; }
        .es-header-inner { max-width: 1280px; margin: 0 auto; padding: 16px 24px; display: grid; grid-template-columns: 180px 1fr auto; align-items: center; gap: 16px; }
        .es-back { font-size: 13px; font-weight: 600; color: #64748b; text-decoration: none; }
        .es-back:hover { color: #14b8a6; }
        .es-title-group { line-height: 1.3; }
        .es-title { font-size: 18px; font-weight: 800; margin: 0; }
        .es-subtitle { font-size: 12px; color: #64748b; margin: 2px 0 0; }
        .es-actions { display: flex; align-items: center; gap: 12px; }
        .es-saved { font-size: 12px; color: #059669; font-weight: 600; }
        .es-btn { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; border: none; transition: 0.2s; }
        .es-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .es-btn-ghost { background: #f1f5f9; color: #475569; }
        .es-btn-ghost:hover:not(:disabled) { background: #e2e8f0; }
        .es-btn-primary { background: #14b8a6; color: #fff; }
        .es-btn-primary:hover:not(:disabled) { background: #0d9488; }

        .es-main { max-width: 1280px; margin: 0 auto; padding: 32px 24px; }
        .es-layout { display: grid; grid-template-columns: 1fr 400px; gap: 32px; align-items: start; }
        @media (max-width: 1024px) { .es-layout { grid-template-columns: 1fr; } }

        .es-form { display: flex; flex-direction: column; gap: 16px; }
        .es-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px 24px; }
        .es-section-title { font-size: 13px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 16px; }
        .es-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .es-field:last-child { margin-bottom: 0; }
        .es-field-label { font-size: 12px; font-weight: 700; color: #334155; }
        .es-text-input, .es-textarea { width: 100%; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; font-family: inherit; color: #0f172a; background: #fff; box-sizing: border-box; }
        .es-text-input:focus, .es-textarea:focus { outline: none; border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
        .es-textarea { resize: vertical; min-height: 80px; }
        .es-color-row { display: flex; gap: 8px; align-items: center; }
        .es-color-input { width: 44px; height: 38px; padding: 0; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; background: #fff; }

        .es-preview-pane { position: sticky; top: 96px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .es-preview-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #64748b; }
        .es-preview-dot { width: 8px; height: 8px; background: #14b8a6; border-radius: 50%; box-shadow: 0 0 0 4px rgba(20,184,166,0.18); }
        .es-phone-frame { width: 360px; height: 720px; background: #0f172a; border-radius: 40px; padding: 14px; box-shadow: 0 20px 40px -10px rgba(0,0,0,0.25); position: relative; }
        .es-phone-notch { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); width: 110px; height: 22px; background: #0f172a; border-radius: 0 0 14px 14px; z-index: 2; }
        .es-phone-screen { width: 100%; height: 100%; background: #fff; border-radius: 28px; overflow-y: auto; overflow-x: hidden; }

        /* プレビュー内のスタイル */
        .pv-header { padding: 40px 20px 20px; color: #fff; }
        .pv-logo { height: 32px; margin-bottom: 16px; object-fit: contain; }
        .pv-logo-placeholder { height: 32px; display: flex; align-items: center; font-weight: 800; font-size: 16px; margin-bottom: 16px; }
        .pv-headline { font-size: 22px; font-weight: 800; margin: 0 0 6px; line-height: 1.3; }
        .pv-sub { font-size: 13px; opacity: 0.85; margin: 0; }
        .pv-body { padding: 20px; }
        .pv-desc { font-size: 13px; line-height: 1.7; color: #334155; margin: 0 0 20px; white-space: pre-wrap; }
        .pv-campaign { border-radius: 12px; padding: 16px; margin-bottom: 20px; color: #fff; }
        .pv-campaign-title { font-size: 11px; font-weight: 700; opacity: 0.9; margin: 0 0 4px; letter-spacing: 0.05em; }
        .pv-campaign-body { font-size: 16px; font-weight: 800; margin: 0; line-height: 1.4; }
        .pv-notes { background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 12px 14px; border-radius: 6px; font-size: 12px; color: #475569; line-height: 1.7; white-space: pre-wrap; margin-bottom: 20px; }
        .pv-cta { width: 100%; padding: 14px; border: none; border-radius: 12px; color: #fff; font-size: 15px; font-weight: 800; cursor: pointer; }
      `}</style>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="es-section">
      <h3 className="es-section-title">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="es-field">
      <span className="es-field-label">{label}</span>
      {children}
    </label>
  );
}

function PreviewContent({ config }: { config: EntryScreenConfig }) {
  return (
    <>
      <div className="pv-header" style={{ background: config.brandColor }}>
        {config.logoUrl ? (
          <img src={config.logoUrl} alt="logo" className="pv-logo" />
        ) : (
          <div className="pv-logo-placeholder">LOGO</div>
        )}
        <h2 className="pv-headline">{config.headline || "（メインキャッチコピー）"}</h2>
        <p className="pv-sub">{config.subHeadline || "（サブキャッチコピー）"}</p>
      </div>
      <div className="pv-body">
        <p className="pv-desc">{config.description || "（店舗紹介文）"}</p>
        {(config.campaignTitle || config.campaignBody) && (
          <div className="pv-campaign" style={{ background: config.brandColor }}>
            <p className="pv-campaign-title">{config.campaignTitle}</p>
            <p className="pv-campaign-body">{config.campaignBody}</p>
          </div>
        )}
        {config.notes && <div className="pv-notes">{config.notes}</div>}
        <button className="pv-cta" style={{ background: config.brandColor }}>
          {config.ctaLabel || "Web入会を始める"}
        </button>
      </div>
    </>
  );
}

function EntryScreenRouter() {
  const sp = useSearchParams();
  const clubCode = sp.get("clubCode");
  if (!clubCode) {
    return (
      <StoreSelector
        basePath="/store-settings/entry-screen"
        title="入会画面設定 - 店舗選択"
        backHref="/store-settings"
        backLabel="メニューへ戻る"
      />
    );
  }
  return <EntryScreenSettingsPage clubCode={clubCode} />;
}

export default function EntryScreenPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>読み込み中…</div>}>
      <EntryScreenRouter />
    </Suspense>
  );
}
