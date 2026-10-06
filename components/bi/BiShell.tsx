// components/bi/BiShell.tsx
// BIの共通シェル(v5デザイン準拠)。固定ドキュメントヘッダ + グローバルフィルタ帯 + 左レールナビ。
// フィルタは localStorage('kb_bi_filters') に保存し、同タブは 'kb-bi-filter' イベントで全ボードへ伝播。
"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const KEY = "kb_bi_filters";
export type GF = { brand: string; gyotai: string; area: string; company: string; gyosha: string; club: string; memberType: string; from: string; to: string };
const DEF: GF = { brand: "", gyotai: "", area: "", company: "", gyosha: "", club: "", memberType: "", from: "", to: "" };

const BOARDS = [
  { href: "/admin/bi/executive", k: "★", t: "経営ダッシュボード" },
  { href: "/admin/bi/member-summary", k: "D1", t: "会員数サマリー" },
  { href: "/admin/bi/club-comparison", k: "D2", t: "勝ち負け店舗比較" },
  { href: "/admin/bi/family", k: "D3", t: "家族会員" },
  { href: "/admin/bi/traffic", k: "D4", t: "来館・混雑" },
  { href: "/admin/bi/spot-usage", k: "D5", t: "都度利用" },
  { href: "/admin/bi/sales-budget", k: "D6", t: "売上・予実" },
  { href: "/admin/bi/distribution", k: "D7", t: "会員分布" },
];

const ymToInput = (ym: string) => (ym && /^\d{6}$/.test(ym) ? `${ym.slice(0, 4)}-${ym.slice(4)}` : "");
const inputToYm = (v: string) => (v && /^\d{4}-\d{2}$/.test(v) ? v.replace("-", "") : "");

function load(): GF { if (typeof window === "undefined") return DEF; try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEF; } }

function ClubPick({ value, onChange, clubs }: { value: string; onChange: (v: string) => void; clubs: any[] }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const sel = new Set(value ? value.split(",").filter(Boolean) : []);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const fl = (clubs || []).filter((c) => !q || c.name.includes(q) || String(c.code).includes(q));
  const tog = (c: string) => { const s = new Set(sel); s.has(c) ? s.delete(c) : s.add(c); onChange(Array.from(s).join(",")); };
  return (
    <div className="f" ref={ref} style={{ position: "relative" }}>
      <b>クラブ</b>
      <button type="button" className="ctl" onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>{sel.size ? `${sel.size}店` : "すべて"} ▾</button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, marginTop: 4, width: 240, maxHeight: 280, background: "var(--surface)", border: "1px solid var(--line-2)", borderRadius: 4, boxShadow: "0 4px 14px rgba(0,0,0,.14)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: 6, borderBottom: "1px solid var(--line)", display: "flex", gap: 6 }}>
            <input autoFocus className="ctl" placeholder="店舗/コード" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
            {sel.size > 0 && <button type="button" className="ctl" onClick={() => onChange("")} style={{ cursor: "pointer" }}>×</button>}
          </div>
          <div style={{ overflowY: "auto", padding: 4 }}>
            {fl.slice(0, 400).map((c) => (
              <label key={c.code} style={{ display: "flex", gap: 7, alignItems: "center", padding: "4px 6px", fontSize: 11.5, cursor: "pointer" }}>
                <input type="checkbox" checked={sel.has(String(c.code))} onChange={() => tog(String(c.code))} />{c.name}<span style={{ color: "var(--ink-3)", fontSize: 9.5 }}>{c.code}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BiShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [f, setF] = useState<GF>(DEF);
  const [opts, setOpts] = useState<any>(null);
  useEffect(() => { setF(load()); fetch("/api/bi/options").then((r) => r.ok ? r.json() : null).then((j) => j && setOpts(j.options)).catch(() => {}); }, []);
  const update = (nf: GF) => { setF(nf); try { localStorage.setItem(KEY, JSON.stringify(nf)); } catch {} window.dispatchEvent(new CustomEvent("kb-bi-filter")); };
  const Sel = ({ k, label, items }: { k: keyof GF; label: string; items: string[] }) => (
    <div className="f"><b>{label}</b>
      <select className="ctl" value={f[k]} onChange={(e) => update({ ...f, [k]: e.target.value })}>
        <option value="">すべて</option>{(items || []).map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
  const any = Object.values(f).some(Boolean);
  return (
    <>
      <header className="dochead"><div className="dochead-in">
        <h1>Knowbase BI</h1>
        <div className="docmeta"><span><i>出典</i> OPENFLOW_DB.MART</span><span><i>接続</i> KB_BI_USER(読取)</span></div>
      </div></header>
      <div className="gfilter"><div className="gfilter-in">
        <span className="tag">GLOBAL FILTER</span>
        <Sel k="brand" label="ブランド" items={opts?.brands} />
        <Sel k="gyotai" label="業態" items={opts?.gyotais} />
        <Sel k="area" label="エリア" items={opts?.areas} />
        <Sel k="company" label="カンパニー" items={opts?.companies} />
        <Sel k="gyosha" label="企業" items={opts?.gyoshas} />
        <ClubPick value={f.club} onChange={(v) => update({ ...f, club: v })} clubs={opts?.clubs} />
        <Sel k="memberType" label="会員種別" items={opts?.memberTypes} />
        <div className="f"><b>期間</b>
          <input type="month" className="ctl" value={ymToInput(f.from)} onChange={(e) => update({ ...f, from: inputToYm(e.target.value) })} />
          <span className="ar">〜</span>
          <input type="month" className="ctl" value={ymToInput(f.to)} onChange={(e) => update({ ...f, to: inputToYm(e.target.value) })} />
        </div>
        {any && <button type="button" className="ctl" style={{ cursor: "pointer" }} onClick={() => update({ ...DEF })}>クリア</button>}
      </div></div>
      <div className="shell">
        <nav className="rail" aria-label="ボード一覧">
          <div className="rl">DASHBOARDS</div>
          <div className="navlist">
            {BOARDS.map((b) => (
              <Link key={b.href} href={b.href}><button aria-current={path === b.href}><span className="k">{b.k}</span>{b.t}</button></Link>
            ))}
          </div>
        </nav>
        <div id="host">{children}</div>
      </div>
    </>
  );
}
