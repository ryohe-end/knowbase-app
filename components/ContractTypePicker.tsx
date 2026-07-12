// components/ContractTypePicker.tsx
// ターゲット抽出の契約種別(会員区分)を選ぶ検索付きマルチセレクト。
// 店舗に属する契約種別が多くても検索で絞り込める。選択はチップ表示。
"use client";

import React, { useMemo, useState } from "react";

export type ContractTypeOption = { name: string; activeCount?: number; totalCount?: number };

export default function ContractTypePicker({
  options,
  selected,
  onChange,
  loading = false,
  emptyHint = "店舗を選択すると契約種別が表示されます",
}: {
  options: ContractTypeOption[];
  selected: string[];
  onChange: (names: string[]) => void;
  loading?: boolean;
  emptyHint?: string;
}) {
  const [q, setQ] = useState("");
  const selSet = useMemo(() => new Set(selected), [selected]);
  const kw = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (kw ? options.filter((o) => o.name.toLowerCase().includes(kw)) : options),
    [options, kw]
  );
  const allSelected = options.length > 0 && options.every((o) => selSet.has(o.name));

  const toggle = (name: string) =>
    onChange(selSet.has(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  return (
    <div className="ctp">
      <div className="ctp-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="契約種別を検索…"
          aria-label="契約種別を検索"
        />
        {q && (
          <button type="button" className="ctp-clear" onClick={() => setQ("")} title="クリア">×</button>
        )}
      </div>

      <div className="ctp-toolbar">
        <span className="ctp-count">
          {loading ? "読み込み中…" : `${selected.length} / ${options.length} 選択中`}
        </span>
        <div className="ctp-bulk">
          <button
            type="button"
            className={allSelected ? "is-off" : ""}
            onClick={() => onChange(options.map((o) => o.name))}
            disabled={options.length === 0}
          >
            全選択
          </button>
          <span className="ctp-bulk-sep">·</span>
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={selected.length === 0}
          >
            解除
          </button>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="ctp-chips">
          {selected.map((n) => (
            <span className="ctp-chip" key={n}>
              {n}
              <button type="button" onClick={() => toggle(n)} title="除外">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="ctp-list">
        {loading ? (
          <div className="ctp-empty">契約種別を読み込んでいます…</div>
        ) : options.length === 0 ? (
          <div className="ctp-empty">{emptyHint}</div>
        ) : filtered.length === 0 ? (
          <div className="ctp-empty">「{q}」に一致する契約種別はありません</div>
        ) : (
          filtered.map((o) => {
            const on = selSet.has(o.name);
            return (
              <button
                type="button"
                key={o.name}
                className={`ctp-opt${on ? " on" : ""}`}
                onClick={() => toggle(o.name)}
              >
                <span className="ctp-opt-check">{on ? "✓" : ""}</span>
                <span className="ctp-opt-name">{o.name}</span>
                {typeof o.activeCount === "number" && o.activeCount > 0 && (
                  <span className="ctp-opt-badge">在籍 {o.activeCount.toLocaleString()}</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
