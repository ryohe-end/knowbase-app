"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StoreSelector from "@/components/StoreSelector";
import { runAiAnalysis } from "@/lib/aiPoll";
import AiSpinner from "@/components/AiSpinner";

type OptionItem = { code: string; name: string; brand: string; repeatable: boolean; price: number | null };
type CatalogStatus = "on" | "stopped" | "scheduled" | "off";
type CatalogItem = { code: string; name: string; repeatable: boolean; price: number | null; status: CatalogStatus; startDate: string | null; endDate: string | null };
type CatalogData = { ok: boolean; clubName?: string; brand?: string; items: CatalogItem[]; error?: string };
type MonthlySale = { ym: string; count: number; income: number };
type Purchase = { option: string; memberId: string | null; boughtAt: string | null; usedAt: string | null };
type OptionData = {
  ok: boolean;
  options: OptionItem[];
  sales: { monthly: MonthlySale[]; totalCount: number; totalIncome: number; months: number };
  purchases?: Purchase[];
  source?: string;
  error?: string;
};

const yen = (n: number | null) => (n == null ? "—" : `¥${n.toLocaleString("ja-JP")}`);
const dt = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 簡易Markdown描画
function AiMd({ text }: { text: string }) {
  const inline = (s: string, k: number) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return <span key={k}>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p))}</span>;
  };
  return (
    <div className="ou-ai-md">
      {text.split("\n").map((ln, i) => {
        const t = ln.trim();
        if (!t) return null;
        if (t.startsWith("## ")) return <h4 key={i} className="ou-ai-h">{t.slice(3)}</h4>;
        if (/^\d+\.\s/.test(t) || t.startsWith("- ")) return <div key={i} className="ou-ai-li">{inline(t.replace(/^- /, ""), i)}</div>;
        return <p key={i} className="ou-ai-p">{inline(t, i)}</p>;
      })}
    </div>
  );
}

function OptionUsageInner({ clubCode }: { clubCode: string }) {
  const [data, setData] = useState<OptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // AI分析
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiMonth, setAiMonth] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiForecast, setAiForecast] = useState<{ ym: string; income: number }[]>([]);
  const [aiTrend, setAiTrend] = useState<string | null>(null);
  const genAi = useCallback(async () => {
    setAiLoading(true); setAiErr(null); setAiText(null);
    const r = await runAiAnalysis(`/api/store-settings/option-usage/ai-analysis?clubCode=${clubCode}`, (d) => {
      setAiMonth(d.month); setAiForecast(d.forecast || []); setAiTrend(d.trend || null);
    });
    if (r.analysis) setAiText(r.analysis); else setAiErr(r.error || "AI分析の生成に失敗しました");
    setAiLoading(false);
  }, [clubCode]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/store-settings/option-usage?clubCode=${clubCode}`);
      const d = await res.json();
      if (res.ok && d.ok) setData(d);
      else setErr(d?.error || "取得に失敗しました");
    } catch { setErr("取得に失敗しました"); }
    finally { setLoading(false); }
  }, [clubCode]);
  useEffect(() => { load(); }, [load]);

  // 提供オプションの管理（追加=ON専用）
  const [cat, setCat] = useState<CatalogData | null>(null);
  const [catLoading, setCatLoading] = useState(true);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  // 追加(ON)時の開始日/終了日入力
  const [editCode, setEditCode] = useState<string | null>(null);
  const [startInput, setStartInput] = useState("");   // YYYY-MM-DD
  const [endInput, setEndInput] = useState("");        // YYYY-MM-DD
  const [noEnd, setNoEnd] = useState(true);            // 無期限
  const todayIso = () => { const j = new Date(Date.now() + 9 * 3600 * 1000); return j.toISOString().slice(0, 10); };
  const openEnable = (code: string) => { setEditCode(code); setStartInput(todayIso()); setEndInput(""); setNoEnd(true); setToast(null); };
  const loadCatalog = useCallback(async () => {
    setCatLoading(true); setCatErr(null);
    try {
      const res = await fetch(`/api/store-settings/option-usage/catalog?clubCode=${clubCode}`);
      const d = await res.json();
      if (res.ok && d.ok) setCat(d);
      else setCatErr(d?.error || "カタログの取得に失敗しました");
    } catch { setCatErr("カタログの取得に失敗しました"); }
    finally { setCatLoading(false); }
  }, [clubCode]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  const enableOption = useCallback(async (code: string, name: string) => {
    const startDate = startInput.replace(/-/g, "");
    const endDate = noEnd ? "99999999" : endInput.replace(/-/g, "");
    if (!/^\d{8}$/.test(startDate)) { setToast({ kind: "err", msg: "開始日を入力してください" }); return; }
    if (!noEnd && !/^\d{8}$/.test(endDate)) { setToast({ kind: "err", msg: "終了日を入力してください（無期限にチェックでもOK）" }); return; }
    if (endDate < startDate) { setToast({ kind: "err", msg: "終了日は開始日以降にしてください" }); return; }
    const endLabel = noEnd ? "無期限" : endInput;
    if (!window.confirm(`「${name}」を提供開始（ON）します。\n開始日: ${startInput}\n終了日: ${endLabel}\n※停止はデジタルチケット側で行います。`)) return;
    setBusyCode(code); setToast(null);
    try {
      const res = await fetch(`/api/store-settings/option-usage/catalog`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubCode, optionCode: code, startDate, endDate }),
      });
      const d = await res.json();
      if (res.ok && d.ok) { setToast({ kind: "ok", msg: `「${name}」の提供を開始しました（${startInput}〜${endLabel}）` }); setEditCode(null); await loadCatalog(); }
      else setToast({ kind: "err", msg: d?.error || "提供開始に失敗しました" });
    } catch { setToast({ kind: "err", msg: "提供開始に失敗しました" }); }
    finally { setBusyCode(null); }
  }, [clubCode, loadCatalog, startInput, endInput, noEnd]);

  const maxIncome = Math.max(1, ...(data?.sales.monthly.map((m) => m.income) ?? []));

  return (
    <div className="ou-root">
      <header className="ou-header">
        <div className="ou-header-inner">
          <Link href={`/store-settings/basic?clubCode=${clubCode}`} className="ou-back-link">
            <span>←</span><span>メニューへ戻る</span>
          </Link>
          <h1 className="ou-page-title">オプション都度利用</h1>
          <span className="ou-readonly">参照のみ（デジタルチケット管理）</span>
        </div>
      </header>

      <main className="ou-main">
        <section className="ou-store-card">
          <div className="ou-store-info">
            <span className="ou-store-label">対象店舗</span>
            <span className="ou-store-code">{clubCode}</span>
          </div>
          {data?.source && <span className="ou-src">{data.source}</span>}
        </section>

        {loading && <div className="ou-card ou-muted">読み込み中…</div>}
        {err && !loading && <div className="ou-card ou-err">{err}</div>}

        {data && !loading && (
          <>
            {/* 販売サマリー */}
            <section className="ou-summary">
              <div className="ou-kpi">
                <div className="ou-kpi-label">オプション都度販売（直近12ヶ月）</div>
                <div className="ou-kpi-row">
                  <div><div className="ou-kpi-v">{data.sales.totalCount.toLocaleString("ja-JP")}</div><div className="ou-kpi-u">件</div></div>
                  <div><div className="ou-kpi-v income">{yen(data.sales.totalIncome)}</div><div className="ou-kpi-u">店舗収入</div></div>
                </div>
              </div>
              {data.sales.monthly.length > 0 ? (
                <div className="ou-chart">
                  {data.sales.monthly.map((m) => (
                    <div key={m.ym} className="ou-bar-col" title={`${m.ym}: ${m.count}件 / ${yen(m.income)}`}>
                      <div className="ou-bar" style={{ height: `${(m.income / maxIncome) * 100}%` }} />
                      <div className="ou-bar-lbl">{m.ym.slice(5)}月</div>
                    </div>
                  ))}
                </div>
              ) : <div className="ou-muted-inline">この期間の販売実績はありません。</div>}
            </section>

            {/* AI分析 */}
            <section className="ou-ai-card">
              <div className="ou-ai-head">
                <div className="ou-ai-title"><span className="ou-ai-badge">AI</span>オプション売上分析（この店舗）
                  {aiMonth && <span className="ou-ai-month">対象月 {aiMonth}</span>}
                  {aiTrend && <span className="ou-ai-trend">収入トレンド: {aiTrend}</span>}
                </div>
                <button type="button" className="ou-ai-btn" onClick={genAi} disabled={aiLoading}>{aiLoading ? "分析中…" : aiText ? "再分析" : "AIで分析する"}</button>
              </div>
              {aiErr && <div className="ou-ai-err">{aiErr}</div>}
              {aiForecast.length > 0 && (
                <div className="ou-fc-cards">
                  {aiForecast.map((f) => (
                    <div key={f.ym} className="ou-fc-fcard"><div className="ou-fc-ym">{f.ym} 予測収入</div><div className="ou-fc-v">{yen(f.income)}</div></div>
                  ))}
                </div>
              )}
              {aiLoading ? <AiSpinner /> : aiText ? <AiMd text={aiText} /> : (!aiErr && <div className="ou-ai-empty">夜間集計をもとに、売れ筋オプション・収入トレンド・移動平均・予測・施策提案をAIが分析します。</div>)}
            </section>

            {/* 提供オプション一覧 */}
            <section className="ou-card">
              <div className="ou-list-head">
                <h2 className="ou-list-title">提供オプション <span className="ou-count">{data.options.length}</span></h2>
              </div>
              {data.options.length === 0 ? (
                <div className="ou-muted-inline">この店舗で提供中のオプションはありません。</div>
              ) : (
                <div className="ou-table-wrap">
                  <table className="ou-table">
                    <thead><tr><th>オプション</th><th>ブランド</th><th>利用</th><th style={{ textAlign: "right" }}>都度料金</th></tr></thead>
                    <tbody>
                      {data.options.map((o) => (
                        <tr key={o.code + o.brand}>
                          <td className="ou-name">{o.name}<span className="ou-code">{o.code}</span></td>
                          <td><span className={`ou-brand ${o.brand === "F365" ? "f365" : "jfit"}`}>{o.brand === "F365" ? "FIT365" : o.brand === "JFIT" ? "JOYFIT" : o.brand}</span></td>
                          <td>{o.repeatable ? <span className="ou-rep">繰り返し可</span> : <span className="ou-once">1回のみ</span>}</td>
                          <td className="ou-price">{yen(o.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="ou-note">料金・提供設定はデジタルチケット側で管理されています（この画面は参照専用）。</div>
            </section>

            {/* 提供オプションの管理（追加=ON専用） */}
            <section className="ou-card">
              <div className="ou-list-head">
                <h2 className="ou-list-title">提供オプションの管理
                  {cat?.brand && <span className={`ou-brand ${cat.brand === "F365" ? "f365" : "jfit"}`} style={{ marginLeft: 4 }}>{cat.brand === "F365" ? "FIT365" : "JOYFIT"}</span>}
                </h2>
                <span className="ou-manage-hint">追加（提供開始）のみ可能</span>
              </div>
              {toast && <div className={`ou-toast ${toast.kind}`}>{toast.msg}</div>}
              {catLoading && <div className="ou-muted-inline">読み込み中…</div>}
              {catErr && !catLoading && <div className="ou-card ou-err" style={{ margin: 0 }}>{catErr}</div>}
              {cat && !catLoading && (
                <div className="ou-table-wrap">
                  <table className="ou-table">
                    <thead><tr><th>オプション</th><th>利用</th><th style={{ textAlign: "right" }}>都度料金</th><th>状態</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
                    <tbody>
                      {cat.items.map((o) => (
                        <React.Fragment key={o.code}>
                        <tr>
                          <td className="ou-name">{o.name}<span className="ou-code">{o.code}</span></td>
                          <td>{o.repeatable ? <span className="ou-rep">繰り返し可</span> : <span className="ou-once">1回のみ</span>}</td>
                          <td className="ou-price">{yen(o.price)}</td>
                          <td>
                            {o.status === "on" && <span className="ou-st on">提供中</span>}
                            {o.status === "stopped" && <span className="ou-st stopped">停止中</span>}
                            {o.status === "scheduled" && <span className="ou-st sched">開始前</span>}
                            {o.status === "off" && <span className="ou-st off">未提供</span>}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {o.status === "off" ? (
                              editCode === o.code
                                ? <button type="button" className="ou-off-btn" onClick={() => setEditCode(null)} style={{ cursor: "pointer", color: "#64748b" }}>キャンセル</button>
                                : <button type="button" className="ou-on-btn" disabled={busyCode === o.code} onClick={() => openEnable(o.code)}>追加（ON）</button>
                            ) : o.status === "on" ? (
                              <button type="button" className="ou-off-btn" disabled title="停止はデジタルチケット側で行います">停止（不可）</button>
                            ) : (
                              <span className="ou-muted-cell" title="再開はデジタルチケット側で行います">—</span>
                            )}
                          </td>
                        </tr>
                        {editCode === o.code && (
                          <tr className="ou-edit-row">
                            <td colSpan={5}>
                              <div className="ou-edit-panel">
                                <span className="ou-edit-title">提供期間を設定</span>
                                <label className="ou-edit-fld">開始日<input type="date" value={startInput} onChange={(e) => setStartInput(e.target.value)} /></label>
                                <label className="ou-edit-fld">終了日<input type="date" value={endInput} disabled={noEnd} onChange={(e) => setEndInput(e.target.value)} /></label>
                                <label className="ou-edit-chk"><input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} />無期限</label>
                                <button type="button" className="ou-on-btn" disabled={busyCode === o.code} onClick={() => enableOption(o.code, o.name)}>
                                  {busyCode === o.code ? "処理中…" : "この内容で提供開始"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="ou-note">「追加（ON）」で即時に提供開始します。<strong>停止・再開はデジタルチケット側</strong>で行ってください（この画面から停止はできません）。</div>
            </section>

            {/* 誰が買っていつ使ったか */}
            <section className="ou-card">
              <div className="ou-list-head">
                <h2 className="ou-list-title">購入・利用明細 <span className="ou-count">直近{data.purchases?.length ?? 0}件</span></h2>
              </div>
              {!data.purchases || data.purchases.length === 0 ? (
                <div className="ou-muted-inline">購入・利用の記録はありません。</div>
              ) : (
                <div className="ou-table-wrap">
                  <table className="ou-table">
                    <thead><tr><th>会員番号</th><th>オプション</th><th>購入日時</th><th>利用日時</th><th>状態</th></tr></thead>
                    <tbody>
                      {data.purchases.map((p, i) => (
                        <tr key={i}>
                          <td className="ou-name">{p.memberId ?? <span className="ou-muted-cell">—</span>}</td>
                          <td>{p.option}</td>
                          <td className="ou-dt">{dt(p.boughtAt) ?? "—"}</td>
                          <td className="ou-dt">{dt(p.usedAt) ?? <span className="ou-muted-cell">未使用</span>}</td>
                          <td>{p.usedAt ? <span className="ou-rep">利用済</span> : <span className="ou-once">未使用</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <style jsx global>{`
        .ou-root { background: linear-gradient(160deg, #f5f3ff 0%, #f8fafc 40%, #ede9fe 100%); min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif; color: #0f172a; }
        .ou-header { height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(180%); border-bottom: 1px solid rgba(226,232,240,0.8); position: sticky; top: 0; z-index: 200; }
        .ou-header-inner { max-width: 1140px; margin: 0 auto; padding: 0 24px; height: 100%; display: flex; align-items: center; justify-content: space-between; }
        .ou-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; padding: 6px 12px; border-radius: 8px; display: flex; align-items: center; gap: 6px; }
        .ou-back-link:hover { background: #f1f5f9; color: #334155; }
        .ou-page-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; }
        .ou-readonly { font-size: 11px; font-weight: 700; color: #6d28d9; background: #f3e8ff; border: 1px solid #e9d5ff; padding: 5px 12px; border-radius: 99px; }
        .ou-main { max-width: 1140px; margin: 0 auto; padding: 24px 24px 80px; }
        .ou-store-card { display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px 20px; margin-bottom: 16px; }
        .ou-store-info { display: flex; align-items: center; gap: 10px; }
        .ou-store-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .ou-store-code { background: #1e293b; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-family: "SF Mono", monospace; font-weight: 700; }
        .ou-src { font-size: 11px; color: #94a3b8; font-weight: 600; }
        .ou-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 16px; }
        .ou-muted { color: #64748b; font-size: 14px; text-align: center; }
        .ou-err { color: #b91c1c; background: #fef2f2; border-color: #fecaca; font-size: 13px; }
        .ou-muted-inline { color: #94a3b8; font-size: 13px; padding: 16px; text-align: center; }
        .ou-summary { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .ou-kpi-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .ou-kpi-row { display: flex; gap: 36px; }
        .ou-kpi-v { font-size: 24px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
        .ou-kpi-v.income { color: #6d28d9; }
        .ou-kpi-u { font-size: 11px; color: #94a3b8; font-weight: 600; }
        .ou-chart { display: flex; align-items: flex-end; gap: 6px; height: 120px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #f1f5f9; }
        .ou-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
        .ou-bar { width: 60%; min-height: 2px; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, #a78bfa, #7c3aed); }
        .ou-bar-lbl { font-size: 10px; color: #94a3b8; font-weight: 600; }
        .ou-list-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
        .ou-list-title { margin: 0; font-size: 16px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 10px; }
        .ou-count { background: #f1f5f9; color: #64748b; font-size: 12px; padding: 2px 10px; border-radius: 99px; font-weight: 700; }
        .ou-table-wrap { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
        .ou-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .ou-table th { background: #f8fafc; text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; }
        .ou-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .ou-table tr:last-child td { border-bottom: none; }
        .ou-name { font-weight: 700; color: #1e293b; }
        .ou-code { margin-left: 8px; font-size: 10px; color: #94a3b8; font-family: "SF Mono", monospace; font-weight: 600; }
        .ou-brand { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 99px; }
        .ou-brand.f365 { color: #be185d; background: #fdf2f8; }
        .ou-brand.jfit { color: #1d4ed8; background: #eff6ff; }
        .ou-rep { font-size: 11px; color: #047857; background: #ecfdf5; padding: 3px 9px; border-radius: 99px; font-weight: 700; }
        .ou-once { font-size: 11px; color: #64748b; background: #f1f5f9; padding: 3px 9px; border-radius: 99px; font-weight: 700; }
        .ou-price { text-align: right; font-weight: 800; color: #6d28d9; font-variant-numeric: tabular-nums; }
        .ou-note { font-size: 11px; color: #94a3b8; margin-top: 12px; }
        .ou-manage-hint { font-size: 11px; font-weight: 700; color: #6d28d9; background: #f3e8ff; border: 1px solid #e9d5ff; padding: 4px 10px; border-radius: 99px; }
        .ou-toast { font-size: 13px; font-weight: 600; padding: 10px 14px; border-radius: 10px; margin-bottom: 12px; }
        .ou-toast.ok { color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; }
        .ou-toast.err { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; }
        .ou-st { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 99px; }
        .ou-st.on { color: #047857; background: #ecfdf5; }
        .ou-st.stopped { color: #b45309; background: #fffbeb; }
        .ou-st.sched { color: #1d4ed8; background: #eff6ff; }
        .ou-st.off { color: #64748b; background: #f1f5f9; }
        .ou-on-btn { padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #34d399, #059669); color: #fff; border: none; cursor: pointer; box-shadow: 0 2px 5px rgba(5,150,105,0.25); }
        .ou-on-btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
        .ou-off-btn { padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; background: #f1f5f9; color: #cbd5e1; border: none; cursor: not-allowed; }
        .ou-edit-row td { background: #f8fafc; padding: 14px !important; }
        .ou-edit-panel { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .ou-edit-title { font-size: 12px; font-weight: 800; color: #6d28d9; }
        .ou-edit-fld { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #475569; }
        .ou-edit-fld input[type="date"] { padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 13px; color: #0f172a; }
        .ou-edit-fld input[type="date"]:disabled { background: #f1f5f9; color: #cbd5e1; }
        .ou-edit-chk { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: #475569; cursor: pointer; }
        .ou-dt { font-size: 12px; color: #475569; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .ou-muted-cell { color: #cbd5e1; }
        .ou-ai-card { background: linear-gradient(160deg, #faf5ff 0%, #fff 60%); border: 1px solid #e9d5ff; border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; }
        .ou-ai-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .ou-ai-title { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 800; color: #1e293b; flex-wrap: wrap; }
        .ou-ai-badge { font-size: 11px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #a855f7, #7c3aed); padding: 3px 9px; border-radius: 6px; }
        .ou-ai-month, .ou-ai-trend { font-size: 11px; font-weight: 700; color: #7c3aed; background: #f3e8ff; padding: 3px 10px; border-radius: 99px; }
        .ou-ai-btn { padding: 8px 18px; border-radius: 10px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, #a855f7, #7c3aed); color: #fff; border: none; cursor: pointer; box-shadow: 0 2px 6px rgba(124,58,237,0.3); }
        .ou-ai-btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
        .ou-ai-empty { font-size: 13px; color: #64748b; margin-top: 12px; line-height: 1.7; }
        .ou-ai-err { font-size: 12px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; margin-top: 12px; }
        .ou-fc-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
        .ou-fc-fcard { background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px; padding: 10px 12px; text-align: center; }
        .ou-fc-ym { font-size: 11px; font-weight: 700; color: #7c3aed; }
        .ou-fc-v { font-size: 16px; font-weight: 800; color: #6d28d9; margin-top: 3px; font-variant-numeric: tabular-nums; }
        .ou-ai-md { margin-top: 14px; }
        .ou-ai-h { font-size: 13px; font-weight: 800; color: #7c3aed; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #f1e8fc; }
        .ou-ai-p, .ou-ai-li { font-size: 13px; color: #334155; line-height: 1.75; margin: 4px 0; }
        .ou-ai-li { margin-left: 8px; }
        .ou-ai-md strong { color: #0f172a; font-weight: 800; }
        @media (max-width: 640px) { .ou-fc-cards { grid-template-columns: 1fr; } }
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
