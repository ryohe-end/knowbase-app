// components/bi/BiKit.tsx — v5デザイン準拠の共通部品。フィルタはグローバル(BiShell)＋localStorage連動。
"use client";

import React, { useMemo, useState, useEffect } from "react";

export const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#5598e7", "#1c5cab", "#c98500", "#d55181", "#199e70"];
// 後方互換(既存ボードが参照)。値はbi.cssの:root変数に対応。
export const T = { accent: "#2a78d6", good: "#0ca30c", crit: "#d03b3b", ink: "#111620", ink2: "#4b5566", ink3: "#848d9c", line: "#dfe3ea", grid: "#e6e9ef", surface: "#fff", surface2: "#f7f8fa", mono: 'var(--mono)' };

export const fmt = (n: number | null | undefined) => (n == null || isNaN(Number(n)) ? "—" : Number(n).toLocaleString());
export const pct = (n: number | null | undefined) => (n == null || isNaN(Number(n)) ? "—" : (Number(n) * 100).toFixed(1) + "%");
export const yen = (n: number | null | undefined) => (n == null ? "—" : "¥" + Number(n).toLocaleString());
export const ymLabel = (ym: any) => { const s = String(ym ?? ""); return s.length === 6 ? `${s.slice(0, 4)}/${s.slice(4)}` : s; };
export const ymToInput = (ym: string) => (ym && /^\d{6}$/.test(ym) ? `${ym.slice(0, 4)}-${ym.slice(4)}` : "");
export const inputToYm = (v: string) => (v && /^\d{4}-\d{2}$/.test(v) ? v.replace("-", "") : "");

export type BiFiltersState = { brand: string; gyotai: string; area: string; company: string; gyosha: string; club: string; memberType: string; from: string; to: string };
export type BiOptions = { brands: string[]; gyotais: string[]; areas: string[]; companies: string[]; gyoshas: string[]; clubs: { code: number; name: string }[]; memberTypes: string[] };
export type BiMeta = { source?: string; conditions?: string[]; sql?: string[] };

const FILTER_KEY = "kb_bi_filters";
const DEFAULT_FILTERS: BiFiltersState = { brand: "", gyotai: "", area: "", company: "", gyosha: "", club: "", memberType: "", from: "", to: "" };
function loadSharedFilters(): BiFiltersState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") }; } catch { return DEFAULT_FILTERS; }
}

// グローバルフィルタ(BiShell)の変更に追随して再取得する
export function useBi<T2 = any>(endpoint: string) {
  const [f, setFState] = useState<BiFiltersState>(DEFAULT_FILTERS);
  const [data, setData] = useState<T2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const reload = () => setFState(loadSharedFilters());
    reload();
    window.addEventListener("kb-bi-filter", reload);
    window.addEventListener("storage", (e) => { if ((e as StorageEvent).key === FILTER_KEY) reload(); });
    return () => { window.removeEventListener("kb-bi-filter", reload); };
  }, []);
  const setF = (v: BiFiltersState) => { setFState(v); try { localStorage.setItem(FILTER_KEY, JSON.stringify(v)); } catch {} window.dispatchEvent(new CustomEvent("kb-bi-filter")); };
  const query = useMemo(() => { const p = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => v && p.set(k, v)); return p.toString(); }, [f]);
  useEffect(() => {
    let abort = false; setLoading(true); setErr(null);
    const sep = endpoint.includes("?") ? "&" : "?";
    fetch(`${endpoint}${sep}${query}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (abort) return; if (!ok) setErr(j?.detail || j?.error || "取得失敗"); else setData(j); })
      .catch((e) => !abort && setErr(String(e))).finally(() => !abort && setLoading(false));
    return () => { abort = true; };
  }, [endpoint, query]);
  return { f, setF, data, loading, err };
}

// v5: 個別KPIカードは .p パネル。tone で数値色。
export function KpiCard({ label, value, sub, tone = "neutral" }:
  { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "neutral" | "ok" | "bad" }) {
  const col = tone === "ok" ? "var(--good)" : tone === "bad" ? "var(--crit)" : "var(--ink)";
  return (
    <div className="p" style={{ flex: "1 1 150px", minWidth: 150, gridColumn: "auto" }}>
      <div style={{ fontSize: 10.5, color: "var(--ink-2)", fontFamily: "var(--disp)" }}>{label}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 23, fontWeight: 600, letterSpacing: "-.01em", marginTop: 3, color: col, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 10, marginTop: 4, color: "var(--ink-2)", fontFamily: "var(--mono)" }}>{sub}</div>}
    </div>
  );
}

export function yoy(cur?: number | null, prev?: number | null) {
  if (cur == null || prev == null || prev === 0) return null;
  const d = (cur - prev) / Math.abs(prev); const up = d >= 0;
  return <span className={up ? "dd up" : "dd down"} style={{ color: up ? "var(--pos)" : "var(--neg)" }}>{up ? "▲" : "▼"}{(Math.abs(d) * 100).toFixed(1)}%<i style={{ fontStyle: "normal", color: "var(--ink-3)", marginLeft: 3, fontFamily: "var(--sans)", fontSize: 9.5 }}>前年</i></span>;
}

// グローバル化により per-page FilterBar は不要(BiShellが担う)。後方互換で何も描画しない。
export function FilterBar(_: any) { return null; }

export function ConditionsPanel({ f, meta, extra }: { f: BiFiltersState; meta?: BiMeta; extra?: Record<string, string | undefined> }) {
  const [open, setOpen] = useState(false);
  const applied = [
    ...Object.entries(extra || {}).map(([k, v]) => (v ? `${k}=${v}` : "")),
    f.brand && `ブランド=${f.brand}`, f.gyotai && `業態=${f.gyotai}`, f.area && `エリア=${f.area}`,
    f.company && `カンパニー=${f.company}`, f.gyosha && `企業=${f.gyosha}`,
    f.club && `クラブ=${f.club.split(",").filter(Boolean).length}店`, f.memberType && `会員種別=${f.memberType}`,
    f.from && `From=${f.from}`, f.to && `To=${f.to}`,
  ].filter(Boolean) as string[];
  return (
    <div className="p c12" style={{ marginBottom: 11, padding: 0 }}>
      <button onClick={() => setOpen(!open)} style={{ width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", fontSize: 11.5, color: "var(--ink-2)", fontFamily: "var(--disp)", fontWeight: 700 }}>
        {open ? "▲" : "▼"} 条件・定義{!open && <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>（{applied.length ? applied.join(" / ") : "全体"}）</span>}
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px", fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
          <div><b>適用中:</b> {applied.length ? applied.join(" / ") : "全体集計"}</div>
          {meta?.source && <div><b>出典:</b> <code>{meta.source}</code></div>}
          {meta?.conditions?.map((c, i) => <div key={i}>・{c}</div>)}
          {meta?.sql && meta.sql.length > 0 && (
            <details><summary style={{ cursor: "pointer", color: "var(--accent)" }}>実行SQL（{meta.sql.length}本）</summary>
              <pre style={{ fontFamily: "var(--mono)", fontSize: 10.5, background: "#0f1720", color: "#cfe0f5", padding: 10, borderRadius: 4, overflowX: "auto", whiteSpace: "pre-wrap" }}>{meta.sql.join(";\n\n")}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// v5: ボード=.board、見出し=.bh。子はそのまま(KPI行/パネル)。
export function BiLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="board">
      <div className="bh">
        <h2>{title}</h2>
        {subtitle && <dl><dd style={{ margin: 0, color: "var(--ink-2)" }}>{subtitle}</dd></dl>}
      </div>
      {children}
    </section>
  );
}

// v5: パネル=.p + ヘッダ .ph(id chip + title) + 任意 .spec。
export function Card({ title, children, id, spec, right }: { title: string; children: React.ReactNode; id?: string; spec?: string; right?: React.ReactNode }) {
  return (
    <div className="p" style={{ marginBottom: 11 }}>
      <div className="ph">
        {id && <span className="id">{id}</span>}
        <h3>{title}</h3>
        {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
      </div>
      {children}
      {spec && <div className="spec"><span className="lb">仕様</span><span>{spec}</span></div>}
    </div>
  );
}
