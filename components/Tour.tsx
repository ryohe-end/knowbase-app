"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type TourStep = {
  /** data-tour 属性の値、または CSS セレクタ */
  selector: string;
  title: string;
  description: string;
  /** ツールチップ表示位置の優先指定 (省略時は自動) */
  placement?: "top" | "bottom" | "left" | "right";
};

type Props = {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
};

const TOOLTIP_W = 360;
const TOOLTIP_GAP = 12;

export default function Tour({ steps, open, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipSize, setTooltipSize] = useState<{ w: number; h: number }>({ w: TOOLTIP_W, h: 0 });

  // ツールチップ実寸を計測 (ステップ切替やリサイズで再計測)
  useLayoutEffect(() => {
    if (!open || !tooltipRef.current) return;
    const measure = () => {
      const el = tooltipRef.current;
      if (!el) return;
      setTooltipSize({ w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(tooltipRef.current);
    return () => ro.disconnect();
  }, [open, idx]);

  // open になったら最初のステップから
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  // 選択中ステップのターゲット要素を測定
  useLayoutEffect(() => {
    if (!open || idx >= steps.length) {
      setRect(null);
      return;
    }
    const step = steps[idx];
    const sel = step.selector.startsWith("[") || step.selector.startsWith(".") || step.selector.startsWith("#")
      ? step.selector
      : `[data-tour="${step.selector}"]`;
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect(r);
    };
    // スクロール完了を待ってから測定
    const t1 = setTimeout(measure, 300);
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      clearTimeout(t1);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, idx, steps]);

  // キーボード操作
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(steps.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, steps.length]);

  if (!open) return null;
  const step = steps[idx];
  if (!step) return null;

  // ツールチップ位置の算出 (ビューポート内に収まるようクランプ・フォールバック)
  const MARGIN = 16;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const tw = Math.min(tooltipSize.w || TOOLTIP_W, vw - MARGIN * 2);
  const th = tooltipSize.h || 200; // 初回 (未計測) は概算

  let tooltipTop = MARGIN;
  let tooltipLeft = MARGIN;
  let measured = tooltipSize.h > 0; // 初回 fade で flicker を避けたい

  if (rect) {
    const spaceBelow = vh - rect.bottom - TOOLTIP_GAP - MARGIN;
    const spaceAbove = rect.top - TOOLTIP_GAP - MARGIN;
    const preferred = step.placement ?? (spaceBelow >= th ? "bottom" : "top");

    if (preferred === "bottom" && spaceBelow >= th) {
      tooltipTop = rect.bottom + TOOLTIP_GAP;
    } else if (preferred === "top" && spaceAbove >= th) {
      tooltipTop = rect.top - th - TOOLTIP_GAP;
    } else if (spaceBelow >= th) {
      tooltipTop = rect.bottom + TOOLTIP_GAP;
    } else if (spaceAbove >= th) {
      tooltipTop = rect.top - th - TOOLTIP_GAP;
    } else {
      // 上下どちらにも収まらない場合は画面中央に
      tooltipTop = Math.max(MARGIN, (vh - th) / 2);
    }
    // 縦クランプ (念のため)
    tooltipTop = Math.max(MARGIN, Math.min(tooltipTop, vh - th - MARGIN));

    // 横は要素の左端寄せ + 画面内クランプ
    tooltipLeft = Math.max(MARGIN, Math.min(rect.left, vw - tw - MARGIN));
  } else {
    // ターゲットが見つからないときは画面中央
    tooltipTop = Math.max(MARGIN, (vh - th) / 2);
    tooltipLeft = Math.max(MARGIN, (vw - tw) / 2);
  }

  return (
    <div className="kb-tour-root">
      {/* スポットライト (box-shadow で外側を暗くする) */}
      {rect ? (
        <div
          className="kb-tour-spotlight"
          style={{
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
          }}
        />
      ) : (
        <div className="kb-tour-backdrop" onClick={onClose} />
      )}

      {/* ツールチップ */}
      <div
        ref={tooltipRef}
        className="kb-tour-tooltip"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          width: tw,
          maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
          overflowY: "auto",
          opacity: measured ? 1 : 0, // 初回計測前は非表示で flicker 防止
        }}
      >
        <div className="kb-tour-step-indicator">
          ステップ {idx + 1} / {steps.length}
        </div>
        <h3 className="kb-tour-title">{step.title}</h3>
        <p className="kb-tour-desc">{step.description}</p>
        <div className="kb-tour-progress">
          {steps.map((_, i) => (
            <span key={i} className={"kb-tour-dot" + (i === idx ? " active" : i < idx ? " done" : "")} />
          ))}
        </div>
        <div className="kb-tour-actions">
          <button className="kb-tour-btn ghost" onClick={onClose}>スキップ</button>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="kb-tour-btn"
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
            >
              戻る
            </button>
            {idx < steps.length - 1 ? (
              <button className="kb-tour-btn primary" onClick={() => setIdx((i) => i + 1)}>
                次へ →
              </button>
            ) : (
              <button className="kb-tour-btn primary" onClick={onClose}>完了</button>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .kb-tour-root {
          position: fixed;
          inset: 0;
          z-index: 99999;
          pointer-events: none;
        }
        .kb-tour-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(2px);
          pointer-events: auto;
        }
        .kb-tour-spotlight {
          position: fixed;
          border-radius: 12px;
          box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.6),
            0 0 0 3px rgba(59, 130, 246, 0.8),
            0 0 30px rgba(59, 130, 246, 0.4);
          transition: top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease;
          pointer-events: none;
        }
        .kb-tour-tooltip {
          position: fixed;
          background: #fff;
          border-radius: 14px;
          padding: 18px 20px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
          pointer-events: auto;
          animation: kb-tour-fade-in 0.25s ease;
          transition: opacity 0.15s ease, top 0.2s ease, left 0.2s ease;
          box-sizing: border-box;
        }
        @keyframes kb-tour-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .kb-tour-step-indicator {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 800;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }
        .kb-tour-title {
          margin: 0 0 8px;
          font-size: 17px;
          font-weight: 800;
          color: #0f172a;
        }
        .kb-tour-desc {
          margin: 0 0 16px;
          font-size: 13px;
          color: #475569;
          line-height: 1.7;
        }
        .kb-tour-progress {
          display: flex;
          gap: 6px;
          margin-bottom: 16px;
        }
        .kb-tour-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #e2e8f0;
        }
        .kb-tour-dot.done { background: #93c5fd; }
        .kb-tour-dot.active { background: #2563eb; transform: scale(1.2); }
        .kb-tour-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .kb-tour-btn {
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 700;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #475569;
          cursor: pointer;
          transition: 0.15s;
        }
        .kb-tour-btn:hover:not(:disabled) {
          border-color: #3b82f6;
          color: #3b82f6;
        }
        .kb-tour-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .kb-tour-btn.primary {
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          border-color: transparent;
          color: #fff;
        }
        .kb-tour-btn.primary:hover { filter: brightness(1.05); }
        .kb-tour-btn.ghost {
          background: transparent;
          border-color: transparent;
          color: #94a3b8;
        }
        .kb-tour-btn.ghost:hover { color: #475569; }
      `}</style>
    </div>
  );
}
