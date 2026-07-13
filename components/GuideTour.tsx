// components/GuideTour.tsx
// 依存ライブラリ不要の軽量ガイドツアー。対象要素をスポットライト表示し、
// ツールチップで手順を案内する。右下の「使い方」ボタンで開始でき、初回訪問時は自動起動。
"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type TourStep = {
  selector?: string;   // ハイライトする要素の CSS セレクタ (無ければ中央表示)
  title: string;
  body: string;
};

export default function GuideTour({
  steps,
  storageKey,
  label = "使い方",
}: {
  steps: TourStep[];
  storageKey?: string;       // 指定すると初回のみ自動起動 + 完了を記憶
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // 初回自動起動
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (!localStorage.getItem(storageKey)) {
        const t = setTimeout(() => setOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch { /* noop */ }
  }, [storageKey]);

  const measure = useCallback(() => {
    const sel = steps[i]?.selector;
    if (!sel) { setRect(null); return; }
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setRect(el.getBoundingClientRect());
  }, [steps, i]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const t = setTimeout(measure, 350); // scroll 後に再計測
    const onWin = () => measure();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => { clearTimeout(t); window.removeEventListener("resize", onWin); window.removeEventListener("scroll", onWin, true); };
  }, [open, measure]);

  const finish = () => {
    setOpen(false); setI(0);
    if (storageKey) { try { localStorage.setItem(storageKey, "1"); } catch { /* noop */ } }
  };
  const start = () => { setI(0); setOpen(true); };

  if (steps.length === 0) return null;

  const step = steps[i];
  const pad = 8;
  const box = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;
  // ツールチップ位置: 対象の下、収まらなければ上、無ければ中央
  let tip: React.CSSProperties;
  if (box) {
    const below = box.top + box.height + 12;
    const showAbove = below + 180 > window.innerHeight;
    tip = showAbove
      ? { top: Math.max(12, box.top - 12), left: Math.min(Math.max(12, box.left), window.innerWidth - 360), transform: "translateY(-100%)" }
      : { top: below, left: Math.min(Math.max(12, box.left), window.innerWidth - 360) };
  } else {
    tip = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return (
    <>
      <button type="button" className="gt-fab" onClick={start} title="使い方ガイド">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" /><path d="M12 17h.01" /></svg>
        {label}
      </button>

      {open && (
        <div className="gt-ov" onClick={(e) => { if (e.target === e.currentTarget) finish(); }}>
          {box && <div className="gt-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />}
          <div className="gt-tip" style={tip}>
            <div className="gt-tip-step">STEP {i + 1} / {steps.length}</div>
            <div className="gt-tip-title">{step.title}</div>
            <div className="gt-tip-body">{step.body}</div>
            <div className="gt-tip-nav">
              <button type="button" className="gt-skip" onClick={finish}>スキップ</button>
              <div className="gt-nav-r">
                {i > 0 && <button type="button" className="gt-btn ghost" onClick={() => setI(i - 1)}>戻る</button>}
                {i < steps.length - 1
                  ? <button type="button" className="gt-btn" onClick={() => setI(i + 1)}>次へ</button>
                  : <button type="button" className="gt-btn" onClick={finish}>完了</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .gt-fab { position: fixed; right: 20px; bottom: 20px; z-index: 900; display: inline-flex; align-items: center; gap: 6px;
          background: #4f46e5; color: #fff; border: none; border-radius: 999px; padding: 10px 16px; font-size: 13px; font-weight: 800;
          box-shadow: 0 6px 18px rgba(79,70,229,0.4); cursor: pointer; }
        .gt-fab:hover { background: #4338ca; }
        .gt-ov { position: fixed; inset: 0; z-index: 950; }
        .gt-spot { position: fixed; border-radius: 10px; box-shadow: 0 0 0 9999px rgba(15,23,42,0.62); transition: all 0.25s ease; pointer-events: none; border: 2px solid #818cf8; }
        .gt-tip { position: fixed; z-index: 960; width: 340px; max-width: calc(100vw - 24px); background: #fff; border-radius: 14px; padding: 16px 18px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); }
        .gt-tip-step { font-size: 11px; font-weight: 800; color: #6366f1; letter-spacing: 0.05em; }
        .gt-tip-title { font-size: 16px; font-weight: 800; color: #0f172a; margin: 4px 0 6px; }
        .gt-tip-body { font-size: 13px; color: #475569; line-height: 1.7; white-space: pre-wrap; }
        .gt-tip-nav { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; }
        .gt-skip { border: none; background: none; color: #94a3b8; font-size: 12px; font-weight: 700; cursor: pointer; }
        .gt-nav-r { display: flex; gap: 8px; }
        .gt-btn { border: none; background: #4f46e5; color: #fff; border-radius: 8px; padding: 7px 16px; font-size: 13px; font-weight: 800; cursor: pointer; }
        .gt-btn:hover { background: #4338ca; }
        .gt-btn.ghost { background: #f1f5f9; color: #475569; }
      `}</style>
    </>
  );
}
