// lib/highlight.ts
//
// 検索キーワードのヒット箇所を <span className="kb-hit-value"> で囲む共通ユーティリティ。
// 単一語にも複数トークンにも対応。重複/隣接範囲は自動マージ。

import React from "react";

type Range = { start: number; end: number };

/**
 * 文字列内の各トークン出現箇所を span でラップして React ノードを返す。
 * 大文字小文字を区別しない。空のトークンは無視。
 */
export function highlightTokens(text: string, rawTokens: string[]): React.ReactNode {
  if (!text) return text;
  const tokens = Array.from(
    new Set(rawTokens.map((t) => (t || "").trim().toLowerCase()).filter((t) => t.length > 0))
  );
  if (tokens.length === 0) return text;

  const lower = text.toLowerCase();
  const ranges: Range[] = [];

  for (const tok of tokens) {
    let from = 0;
    while (from < lower.length) {
      const pos = lower.indexOf(tok, from);
      if (pos < 0) break;
      ranges.push({ start: pos, end: pos + tok.length });
      from = pos + tok.length;
    }
  }

  if (ranges.length === 0) return text;

  // 開始位置でソートし、重なり / 隣接するレンジをマージ
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i].start <= last.end) {
      last.end = Math.max(last.end, ranges[i].end);
    } else {
      merged.push(ranges[i]);
    }
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach((r, i) => {
    if (r.start > cursor) parts.push(text.slice(cursor, r.start));
    parts.push(
      <span key={`hit-${i}-${r.start}`} className="kb-hit-value">
        {text.slice(r.start, r.end)}
      </span>
    );
    cursor = r.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
}

/** 単一キーワード版 (内部的に highlightTokens を使う) */
export function highlightText(text: string, keyword: string): React.ReactNode {
  return highlightTokens(text, [keyword]);
}
