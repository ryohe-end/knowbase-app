"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { runAiAnalysis } from "@/lib/aiPoll";
import AiSpinner from "@/components/AiSpinner";

type Provider = { provider: string; orders: number; sales: number };
type Product = { product: string; count: number; sales: number };
type Brand = { brand: string; orders: number; sales: number };
type Monthly = { ym: string; orders: number; sales: number };
type WpData = {
  ok: boolean; monthly: Monthly[]; totalOrders: number; totalSales: number;
  byProvider: Provider[]; byProduct: Product[]; byBrand: Brand[]; source?: string; error?: string;
};

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function WpMd({ text }: { text: string }) {
  const inline = (s: string, k: number) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return <span key={k}>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p))}</span>;
  };
  return <div className="wp-ai-md">{text.split("\n").map((ln, i) => {
    const t = ln.trim(); if (!t) return null;
    if (t.startsWith("## ")) return <h4 key={i} className="wp-ai-h">{t.slice(3)}</h4>;
    if (/^\d+\.\s/.test(t) || t.startsWith("- ")) return <div key={i} className="wp-ai-li">{inline(t.replace(/^- /, ""), i)}</div>;
    return <p key={i} className="wp-ai-p">{inline(t, i)}</p>;
  })}</div>;
}

export default function WellnessPassPage() {
  const [data, setData] = useState<WpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiForecast, setAiForecast] = useState<{ ym: string; sales: number }[]>([]);
  const [aiTrend, setAiTrend] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/wellness-pass");
        const d = await res.json();
        if (res.ok && d.ok) setData(d); else setErr(d?.error || "取得に失敗しました");
      } catch { setErr("取得に失敗しました"); } finally { setLoading(false); }
    })();
  }, []);

  const genAi = useCallback(async () => {
    setAiLoading(true); setAiErr(null); setAiText(null);
    const r = await runAiAnalysis("/api/wellness-pass/ai-analysis", (d) => { setAiForecast(d.forecast || []); setAiTrend(d.trend || null); });
    if (r.analysis) setAiText(r.analysis); else setAiErr(r.error || "AI分析の生成に失敗しました");
    setAiLoading(false);
  }, []);

  const maxProv = Math.max(1, ...(data?.byProvider.map((p) => p.sales) ?? []));
  const maxMonth = Math.max(1, ...(data?.monthly.map((m) => m.sales) ?? []));

  return (
    <div className="wp-root">
      <header className="wp-header">
        <div className="wp-header-inner">
          <Link href="/" className="wp-back">← ホームへ</Link>
          <h1 className="wp-title">法人ウェルネスパス <span className="wp-sub">福利厚生・外部販売</span></h1>
          <span className="wp-badge">全社 / 参照専用</span>
        </div>
      </header>

      <main className="wp-main">
        {loading && <div className="wp-card wp-muted">読み込み中…</div>}
        {err && !loading && <div className="wp-card wp-err">{err}</div>}

        {data && !loading && (
          <>
            <section className="wp-kpis">
              <div className="wp-kpi"><div className="wp-kpi-l">販売数（直近13ヶ月）</div><div className="wp-kpi-v">{data.totalOrders.toLocaleString("ja-JP")}<span className="wp-kpi-u">件</span></div></div>
              <div className="wp-kpi"><div className="wp-kpi-l">売上（税込）</div><div className="wp-kpi-v income">{yen(data.totalSales)}</div></div>
              <div className="wp-kpi"><div className="wp-kpi-l">提供元</div><div className="wp-kpi-v">{data.byProvider.length}<span className="wp-kpi-u">社</span></div></div>
            </section>

            {/* AI分析 */}
            <section className="wp-ai-card">
              <div className="wp-ai-head">
                <div className="wp-ai-title"><span className="wp-ai-badge">AI</span>全社売上分析
                  {aiTrend && <span className="wp-ai-trend">トレンド: {aiTrend}</span>}
                </div>
                <button className="wp-ai-btn" onClick={genAi} disabled={aiLoading}>{aiLoading ? "分析中…" : aiText ? "再分析" : "AIで分析する"}</button>
              </div>
              {aiErr && <div className="wp-err inline">{aiErr}</div>}
              {aiForecast.length > 0 && (
                <div className="wp-fc-cards">{aiForecast.map((f) => (<div key={f.ym} className="wp-fc"><div className="wp-fc-ym">{f.ym} 予測</div><div className="wp-fc-v">{yen(f.sales)}</div></div>))}</div>
              )}
              {aiLoading ? <AiSpinner /> : aiText ? <WpMd text={aiText} /> : (!aiErr && <div className="wp-muted inline">提供元別動向・移動平均・売上予測・施策提案をAIが分析します。</div>)}
            </section>

            {/* 月次推移 */}
            <section className="wp-card">
              <h2 className="wp-h">月次売上推移</h2>
              <div className="wp-chart">
                {data.monthly.map((m) => (
                  <div key={m.ym} className="wp-bar-col" title={`${m.ym}: ${m.orders}件 / ${yen(m.sales)}`}>
                    <div className="wp-bar" style={{ height: `${(m.sales / maxMonth) * 100}%` }} />
                    <div className="wp-bar-l">{m.ym.slice(5)}月</div>
                  </div>
                ))}
              </div>
            </section>

            <div className="wp-grid">
              {/* 提供元別 */}
              <section className="wp-card">
                <h2 className="wp-h">提供元別（売上）</h2>
                <div className="wp-bd">
                  {data.byProvider.slice(0, 10).map((p) => (
                    <div key={p.provider} className="wp-bd-row">
                      <span className="wp-bd-name">{p.provider}</span>
                      <div className="wp-bd-track"><div className="wp-bd-fill" style={{ width: `${(p.sales / maxProv) * 100}%` }} /></div>
                      <span className="wp-bd-val">{yen(p.sales)}<span className="wp-bd-sub"> / {p.orders}件</span></span>
                    </div>
                  ))}
                </div>
              </section>

              {/* 商品別 */}
              <section className="wp-card">
                <h2 className="wp-h">商品別</h2>
                <table className="wp-table">
                  <thead><tr><th>商品</th><th style={{ textAlign: "right" }}>販売数</th><th style={{ textAlign: "right" }}>売上</th></tr></thead>
                  <tbody>
                    {data.byProduct.map((p) => (
                      <tr key={p.product}><td>{p.product}</td><td className="wp-num">{p.count.toLocaleString("ja-JP")}</td><td className="wp-num">{yen(p.sales)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="wp-brands">
                  {data.byBrand.map((b) => <span key={b.brand} className="wp-brand">{b.brand}: {b.orders}件</span>)}
                </div>
              </section>
            </div>
            {data.source && <div className="wp-src">データ: {data.source}（料金・販売設定は外部販売側で管理・参照専用）</div>}
          </>
        )}
      </main>

      <style jsx global>{`
        .wp-root { background: linear-gradient(160deg, #eff6ff 0%, #f8fafc 40%, #dbeafe 100%); min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif; color: #0f172a; }
        .wp-header { height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(180%); border-bottom: 1px solid rgba(226,232,240,0.8); position: sticky; top: 0; z-index: 200; }
        .wp-header-inner { max-width: 1200px; margin: 0 auto; padding: 0 24px; height: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .wp-back { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .wp-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; display: flex; align-items: baseline; gap: 10px; }
        .wp-sub { font-size: 11px; font-weight: 600; color: #94a3b8; }
        .wp-badge { font-size: 11px; font-weight: 700; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; padding: 5px 12px; border-radius: 99px; }
        .wp-main { max-width: 1200px; margin: 0 auto; padding: 24px; }
        .wp-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .wp-muted { color: #64748b; text-align: center; } .wp-muted.inline { text-align: left; font-size: 13px; margin-top: 12px; line-height: 1.7; }
        .wp-err { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 12px; font-size: 13px; } .wp-err.inline { margin-top: 12px; }
        .wp-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 16px; }
        .wp-kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; }
        .wp-kpi-l { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .wp-kpi-v { font-size: 24px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
        .wp-kpi-v.income { color: #1d4ed8; }
        .wp-kpi-u { font-size: 12px; color: #94a3b8; margin-left: 4px; }
        .wp-h { margin: 0 0 14px; font-size: 15px; font-weight: 800; color: #1e293b; }
        .wp-chart { display: flex; align-items: flex-end; gap: 6px; height: 150px; }
        .wp-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; height: 100%; justify-content: flex-end; }
        .wp-bar { width: 62%; min-height: 2px; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, #60a5fa, #2563eb); }
        .wp-bar-l { font-size: 10px; color: #94a3b8; font-weight: 600; }
        .wp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } @media (max-width: 860px) { .wp-grid { grid-template-columns: 1fr; } .wp-kpis { grid-template-columns: 1fr; } }
        .wp-bd { display: flex; flex-direction: column; gap: 10px; }
        .wp-bd-row { display: grid; grid-template-columns: 120px 1fr auto; gap: 12px; align-items: center; font-size: 12px; }
        .wp-bd-name { font-weight: 700; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wp-bd-track { height: 8px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .wp-bd-fill { height: 100%; background: linear-gradient(90deg, #93c5fd, #2563eb); border-radius: 99px; }
        .wp-bd-val { font-weight: 800; color: #1e293b; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .wp-bd-sub { font-weight: 600; color: #94a3b8; }
        .wp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .wp-table th { text-align: left; padding: 8px 10px; font-size: 11px; color: #64748b; font-weight: 700; border-bottom: 1px solid #e2e8f0; text-transform: uppercase; }
        .wp-table td { padding: 10px; border-bottom: 1px solid #f1f5f9; }
        .wp-num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
        .wp-brands { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
        .wp-brand { font-size: 11px; font-weight: 700; color: #1d4ed8; background: #eff6ff; padding: 4px 10px; border-radius: 99px; }
        .wp-src { font-size: 11px; color: #94a3b8; margin-top: 8px; }
        .wp-ai-card { background: linear-gradient(160deg, #faf5ff 0%, #fff 60%); border: 1px solid #e9d5ff; border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; }
        .wp-ai-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .wp-ai-title { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 800; color: #1e293b; }
        .wp-ai-badge { font-size: 11px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #a855f7, #7c3aed); padding: 3px 9px; border-radius: 6px; }
        .wp-ai-trend { font-size: 11px; font-weight: 700; color: #7c3aed; background: #f3e8ff; padding: 3px 10px; border-radius: 99px; }
        .wp-ai-btn { padding: 8px 18px; border-radius: 10px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, #a855f7, #7c3aed); color: #fff; border: none; cursor: pointer; }
        .wp-ai-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .wp-fc-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
        .wp-fc { background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px; padding: 10px; text-align: center; }
        .wp-fc-ym { font-size: 11px; font-weight: 700; color: #7c3aed; } .wp-fc-v { font-size: 15px; font-weight: 800; color: #6d28d9; margin-top: 3px; }
        .wp-ai-md { margin-top: 14px; } .wp-ai-h { font-size: 13px; font-weight: 800; color: #7c3aed; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #f1e8fc; }
        .wp-ai-p, .wp-ai-li { font-size: 13px; color: #334155; line-height: 1.75; margin: 4px 0; } .wp-ai-li { margin-left: 8px; } .wp-ai-md strong { color: #0f172a; font-weight: 800; }
      `}</style>
    </div>
  );
}
