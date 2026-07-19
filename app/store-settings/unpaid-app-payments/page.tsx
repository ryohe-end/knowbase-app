"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";

type ByShop = { casioShopId: string; shopName: string; count: number; amount: number; brand: string };
type DetailRow = { memberNo: string; amount: number; date: string; time: string; orderId: string; shopName: string; brand: string };

const yen = (n: number) => `¥${(n || 0).toLocaleString("ja-JP")}`;
const fmtDate = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}` : d);
const fmtTime = (t: string) => (/^\d{6}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : t);

export default function UnpaidAppPaymentsPage() {
  const [tab, setTab] = useState<"summary" | "detail">("summary");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [memberNo, setMemberNo] = useState("");
  const [shopFilter, setShopFilter] = useState(""); // casioShopId

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [summary, setSummary] = useState<{ totalCount: number; totalAmount: number; byShop: ByShop[] } | null>(null);

  const [detail, setDetail] = useState<{ rows: DetailRow[]; totalCount: number; totalAmount: number; page: number; pageSize: number } | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  const qs = useCallback((extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return p.toString();
  }, [from, to]);

  const loadSummary = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/store-settings/unpaid-app-payments?${qs({ view: "summary" })}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "取得に失敗しました");
      setIsAdmin(!!d.isAdmin);
      setSummary({ totalCount: d.totalCount, totalAmount: d.totalAmount, byShop: d.byShop || [] });
    } catch (e: any) { setError(e?.message || "取得に失敗しました"); }
    finally { setLoading(false); }
  }, [qs]);

  const loadDetail = useCallback(async (pg: number) => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/store-settings/unpaid-app-payments?${qs({ view: "detail", memberNo, clubCode: shopFilter, page: String(pg), pageSize: "50" })}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "取得に失敗しました");
      setDetail({ rows: d.rows || [], totalCount: d.totalCount, totalAmount: d.totalAmount, page: d.page, pageSize: d.pageSize });
      setPage(d.page);
    } catch (e: any) { setError(e?.message || "取得に失敗しました"); }
    finally { setLoading(false); }
  }, [qs, memberNo, shopFilter]);

  useEffect(() => { if (tab === "summary") loadSummary(); else loadDetail(1); /* eslint-disable-next-line */ }, [tab]);

  const applyFilters = () => { if (tab === "summary") loadSummary(); else loadDetail(1); };
  const totalPages = detail ? Math.max(1, Math.ceil(detail.totalCount / detail.pageSize)) : 1;

  const shopOptions = useMemo(() => summary?.byShop || [], [summary]);

  return (
    <div className="uap-root">
      <AdminLoadingOverlay visible={loading} text="APP未納金支払い実績を読み込み中..." />
      <header className="uap-header">
        <div className="uap-header-inner">
          <Link href="/store-settings" className="uap-back">← メニューへ戻る</Link>
          <h1>APP未納金支払い実績<span className="uap-badge">FIT365 / JOYFIT</span></h1>
          <span className="uap-src">入会DB (fit365entry / ecojoy)</span>
        </div>
      </header>

      <main className="uap-main">
        {/* フィルタ */}
        <div className="uap-filters">
          <div className="uap-field"><label>期間(自)</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="uap-field"><label>期間(至)</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {tab === "detail" && (
            <>
              <div className="uap-field"><label>会員番号</label><input type="text" placeholder="完全一致" value={memberNo} onChange={(e) => setMemberNo(e.target.value)} /></div>
              <div className="uap-field"><label>店舗</label>
                <select value={shopFilter} onChange={(e) => setShopFilter(e.target.value)}>
                  <option value="">全店舗（担当内）</option>
                  {shopOptions.map((s) => <option key={s.casioShopId} value={s.casioShopId}>{s.shopName}</option>)}
                </select>
              </div>
            </>
          )}
          <button className="uap-apply" onClick={applyFilters}>絞り込む</button>
        </div>

        <div className="uap-tabs">
          <button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>サマリー</button>
          <button className={tab === "detail" ? "active" : ""} onClick={() => setTab("detail")}>明細</button>
        </div>

        {error && <div className="uap-error">{error}</div>}

        {tab === "summary" && summary && (
          <>
            <div className="uap-cards">
              <div className="uap-card"><div className="uap-card-label">支払い総額</div><div className="uap-card-value">{yen(summary.totalAmount)}</div></div>
              <div className="uap-card"><div className="uap-card-label">支払い件数</div><div className="uap-card-value">{summary.totalCount.toLocaleString("ja-JP")}<small>件</small></div></div>
              <div className="uap-card"><div className="uap-card-label">対象店舗数</div><div className="uap-card-value">{summary.byShop.length}<small>店</small></div></div>
            </div>
            <div className="uap-table-wrap">
              <table className="uap-table">
                <thead><tr><th>ブランド</th><th>店舗</th><th className="r">件数</th><th className="r">金額</th></tr></thead>
                <tbody>
                  {summary.byShop.map((s) => (
                    <tr key={`${s.brand}-${s.casioShopId}`}><td><span className={`uap-brand ${s.brand === "JOYFIT" ? "j" : "f"}`}>{s.brand}</span></td><td>{s.shopName}<code className="uap-code">{s.casioShopId}</code></td><td className="r">{s.count.toLocaleString("ja-JP")}</td><td className="r">{yen(s.amount)}</td></tr>
                  ))}
                  {summary.byShop.length === 0 && <tr><td colSpan={4} className="uap-empty">該当データなし</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "detail" && detail && (
          <>
            <div className="uap-detail-head">
              <span>該当 <b>{detail.totalCount.toLocaleString("ja-JP")}</b> 件 / 合計 <b>{yen(detail.totalAmount)}</b></span>
            </div>
            <div className="uap-table-wrap">
              <table className="uap-table">
                <thead><tr><th>支払日時</th><th>ブランド</th><th>会員番号</th><th>店舗</th><th className="r">金額</th><th>注文ID</th></tr></thead>
                <tbody>
                  {detail.rows.map((r, i) => (
                    <tr key={`${r.orderId}-${i}`}>
                      <td className="uap-nowrap">{fmtDate(r.date)} {fmtTime(r.time)}</td>
                      <td><span className={`uap-brand ${r.brand === "JOYFIT" ? "j" : "f"}`}>{r.brand}</span></td>
                      <td><code className="uap-code">{r.memberNo}</code></td>
                      <td>{r.shopName}</td>
                      <td className="r">{yen(r.amount)}</td>
                      <td><code className="uap-order">{r.orderId}</code></td>
                    </tr>
                  ))}
                  {detail.rows.length === 0 && <tr><td colSpan={6} className="uap-empty">該当データなし</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="uap-pager">
              <button disabled={page <= 1} onClick={() => loadDetail(page - 1)}>← 前へ</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => loadDetail(page + 1)}>次へ →</button>
            </div>
          </>
        )}
      </main>

      <style jsx global>{`
        .uap-root { background: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; }
        .uap-header { background: #fff; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 50; }
        .uap-header-inner { max-width: 1200px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 16px; }
        .uap-back { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .uap-header h1 { font-size: 18px; font-weight: 800; margin: 0; display: flex; align-items: center; gap: 8px; }
        .uap-badge { font-size: 10px; font-weight: 800; color: #be185d; background: #fce7f3; border: 1px solid #fbcfe8; padding: 2px 8px; border-radius: 99px; }
        .uap-src { margin-left: auto; font-size: 11px; color: #94a3b8; font-family: monospace; }
        .uap-main { max-width: 1200px; margin: 0 auto; padding: 20px 24px; }
        .uap-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
        .uap-field { display: flex; flex-direction: column; gap: 4px; }
        .uap-field label { font-size: 11px; font-weight: 700; color: #64748b; }
        .uap-field input, .uap-field select { padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; }
        .uap-apply { margin-left: auto; padding: 9px 20px; background: #0f172a; color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; }
        .uap-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
        .uap-tabs button { padding: 8px 20px; border: 1px solid #e2e8f0; background: #fff; border-radius: 99px; font-weight: 700; font-size: 13px; color: #64748b; cursor: pointer; }
        .uap-tabs button.active { background: #0f172a; color: #fff; border-color: #0f172a; }
        .uap-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; font-size: 13px; }
        .uap-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
        .uap-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; }
        .uap-card-label { font-size: 11px; font-weight: 700; color: #94a3b8; }
        .uap-card-value { font-size: 26px; font-weight: 800; margin-top: 6px; }
        .uap-card-value small { font-size: 13px; font-weight: 700; margin-left: 3px; color: #64748b; }
        .uap-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: auto; }
        .uap-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .uap-table th { text-align: left; padding: 11px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 800; color: #64748b; white-space: nowrap; }
        .uap-table td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
        .uap-table th.r, .uap-table td.r { text-align: right; }
        .uap-table tr:last-child td { border-bottom: none; }
        .uap-nowrap { white-space: nowrap; }
        .uap-code { font-family: monospace; font-size: 11px; color: #64748b; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
        .uap-order { font-family: monospace; font-size: 11px; color: #94a3b8; }
        .uap-brand { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 99px; }
        .uap-brand.f { color: #be185d; background: #fce7f3; } .uap-brand.j { color: #1d4ed8; background: #dbeafe; }
        .uap-empty { text-align: center; color: #94a3b8; padding: 28px; }
        .uap-detail-head { font-size: 13px; color: #475569; margin-bottom: 10px; }
        .uap-pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 16px; font-size: 13px; }
        .uap-pager button { padding: 7px 16px; border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; font-weight: 700; cursor: pointer; }
        .uap-pager button:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
