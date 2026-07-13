// components/StorePicker.tsx
// DM/Push の配信先店舗を複数選択するピッカー。
// 管理者(店舗数が多い)向けに ブランド(JOYFIT/FIT365)・運営(直営/FC)・エリア で絞り込める。
"use client";

import React, { useMemo, useState } from "react";

export type StoreItem = {
  clubCode: string;
  clubName: string;
  brand?: string;
  brandGroup?: string; // "JOYFIT" | "FIT365"
  ownership?: string;  // "直営" | "FC"
  area?: string;       // companyGroup
};

export default function StorePicker({
  stores,
  selected,
  onChange,
}: {
  stores: StoreItem[];
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");     // "" = すべて
  const [ownership, setOwnership] = useState("");
  const [area, setArea] = useState("");

  const selSet = useMemo(() => new Set(selected), [selected]);
  const showFilters = stores.length > 8; // 店舗が多い(管理者)ときだけ絞り込みを出す

  const areas = useMemo(
    () => [...new Set(stores.map((s) => s.area).filter(Boolean))].sort() as string[],
    [stores]
  );

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return stores.filter((s) => {
      if (brand && (s.brandGroup || "") !== brand) return false;
      if (ownership && (s.ownership || "") !== ownership) return false;
      if (area && (s.area || "") !== area) return false;
      if (kw && !(`${s.clubCode} ${s.clubName}`.toLowerCase().includes(kw))) return false;
      return true;
    });
  }, [stores, q, brand, ownership, area]);

  const toggle = (code: string) =>
    onChange(selSet.has(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selSet.has(s.clubCode));

  return (
    <div className="sp">
      {showFilters && (
        <div className="sp-filters">
          <Seg label="ブランド" value={brand} setValue={setBrand} options={[["", "すべて"], ["JOYFIT", "JOYFIT"], ["FIT365", "FIT365"]]} />
          <Seg label="運営" value={ownership} setValue={setOwnership} options={[["", "すべて"], ["直営", "直営"], ["FC", "FC"]]} />
          {areas.length > 1 && (
            <div className="sp-seg">
              <span className="sp-seg-l">エリア</span>
              <select className="sp-area" value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">すべて</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      <div className="sp-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="店舗名・コードで検索…" />
      </div>
      <div className="sp-toolbar">
        <span className="sp-count">{selected.length} 店舗を選択中（表示 {filtered.length}）</span>
        <div className="sp-bulk">
          <button type="button" onClick={() => onChange([...new Set([...selected, ...filtered.map((s) => s.clubCode)])])} disabled={filtered.length === 0}>表示中を全選択</button>
          <span>·</span>
          <button type="button" onClick={() => onChange(selected.filter((c) => !filtered.some((s) => s.clubCode === c)))} disabled={!filtered.some((s) => selSet.has(s.clubCode))}>解除</button>
        </div>
      </div>
      <div className="sp-list">
        {filtered.length === 0 ? (
          <div className="sp-empty">該当する店舗がありません</div>
        ) : (
          filtered.map((s) => {
            const on = selSet.has(s.clubCode);
            return (
              <button type="button" key={s.clubCode} className={`sp-opt${on ? " on" : ""}`} onClick={() => toggle(s.clubCode)}>
                <span className="sp-check">{on ? "✓" : ""}</span>
                <span className="sp-name">{s.clubName}<small>{s.clubCode}</small></span>
                {s.brandGroup && <span className={`sp-tag ${s.brandGroup === "FIT365" ? "f365" : "joy"}`}>{s.brandGroup}</span>}
                {s.ownership && <span className="sp-tag own">{s.ownership}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function Seg({ label, value, setValue, options }: { label: string; value: string; setValue: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="sp-seg">
      <span className="sp-seg-l">{label}</span>
      <div className="sp-seg-btns">
        {options.map(([v, l]) => (
          <button key={v} type="button" className={value === v ? "on" : ""} onClick={() => setValue(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}
