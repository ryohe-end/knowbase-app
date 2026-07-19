"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import StoreSelector from "@/components/StoreSelector";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import { runAiAnalysis } from "@/lib/aiPoll";
import AiSpinner from "@/components/AiSpinner";
import { ToastProvider, useToast } from "@/components/Toast";

// --- 型 ---
type PricePeriod = {
  id: string;
  price: number;
  validFrom: string;
  validTo: string | null;
  label?: string;
  note?: string;
};

type DurationPrices = {
  durationMinutes: number;
  periods: PricePeriod[];
};

type StoreSummary = {
  clubCode: string;
  clubName: string;
  brand: string;
  businessType: string;
  prefecture: string;
};

type UnitType = "1day" | "30min";
type TabKey = "settings" | "dashboard" | "pricing";

type Confidence = "high" | "medium" | "low";
type DemandLevel = "low" | "mid" | "high";

type HourlySlot = { hour: number; count: number; sales: number };
type DayOfWeekSlot = { dayOfWeek: number; label: string; count: number; sales: number };
type DurationDemand = {
  durationMinutes: number;
  count: number;
  sales: number;
  occupancyRate: number;
  peakHour: number;
  peakDay: string;
  trend: "up" | "down" | "flat";
  trendPct: number;
};
type ClampFlag = "min" | "max" | null;
type SlotSuggestion = {
  id: string;
  label: string;
  schedule: string;
  daysLabel: string;
  demand: DemandLevel;
  demandIndex: number;
  suggestedPrice: number;
  changePct: number;
  rationale: string;
  recommendedLabel: string;
  wasClamped: ClampFlag;
};
type PriceSuggestion = {
  durationMinutes: number;
  currentPrice: number;
  basePrice: number;
  baseChangePct: number;
  baseClamped: ClampFlag;
  priceRange: { min: number; max: number } | null;
  confidence: Confidence;
  reasoning: string[];
  projectedRevenueDelta: number;
  projectedVolumeDelta: number;
  recommendedLabel: string;
  recommendedValidFrom: string;
  slots: SlotSuggestion[];
};
type SeasonType = "busy" | "quiet" | "normal";
type SeasonalDurationPrice = {
  durationMinutes: number;
  basePrice: number;
  seasonalPrice: number;
  changePct: number;
  wasClamped: ClampFlag;
  priceRange: { min: number; max: number } | null;
};
type SeasonalPeriod = {
  id: string;
  label: string;
  description: string;
  type: SeasonType;
  dateFrom: string;
  dateTo: string;
  multiplier: number;
  expectedDemandPct: number;
  durationPrices: SeasonalDurationPrice[];
  reasoning: string[];
};
type PricingFactor = {
  id: string;
  label: string;
  description: string;
  rangeText: string;
  exampleText: string;
};
type CalculationStep = {
  label: string;
  detail: string;
  operator: "×" | "+" | "→";
  factorText: string;
  beforePrice: number;
  afterPrice: number;
};
type CalculationExample = {
  durationMinutes: number;
  slotId: string;
  slotLabel: string;
  startPrice: number;
  finalPrice: number;
  totalChangePct: number;
  steps: CalculationStep[];
  note: string;
};
type PricingAnalysis = {
  insights: string[];
  hourly: HourlySlot[];
  dayOfWeek: DayOfWeekSlot[];
  durationDemand: DurationDemand[];
  suggestions: PriceSuggestion[];
  seasonalPeriods: SeasonalPeriod[];
  pricingFactors: PricingFactor[];
  calculationExamples: CalculationExample[];
  generatedAt: string;
  isDemo: boolean;
};

type PurchaseStatus = "purchased" | "used" | "expired" | "refunded";
type Gender = "male" | "female" | "other" | "unknown";
type AgeGroup = "u20" | "20s" | "30s" | "40s" | "50s" | "60plus";

type Purchase = {
  id: string;
  purchaserName: string;
  purchaserEmail: string | null;
  purchaserPhone: string | null;
  memberCode: string | null;
  gender: Gender;
  age: number;
  ageGroup: AgeGroup;
  isFirstPurchase: boolean;
  durationMinutes: number;
  price: number;
  purchasedAt: string;
  usedAt: string | null;
  status: PurchaseStatus;
  paymentMethod: string;
};

type PurchaseSummary = {
  rangeFrom: string;
  rangeTo: string;
  totalCount: number;
  totalSales: number;
  averagePrice: number;
  uniqueCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  repeatRate: number;
  byDuration: { durationMinutes: number; count: number; sales: number }[];
  byStatus: { status: PurchaseStatus; count: number }[];
  byGender: { gender: Gender; count: number; sales: number }[];
  byAgeGroup: { ageGroup: AgeGroup; count: number; sales: number; averageAge: number; male: number; female: number; other: number; unknown: number }[];
  byHour: { hour: number; count: number; sales: number }[];
  byDayOfWeek: { dayOfWeek: number; label: string; count: number; sales: number; usedCount: number }[];
  topCustomers: { memberCode: string | null; memberName: string; purchaseCount: number; totalSales: number; lastPurchasedAt: string }[];
};

// --- 定数 ---
const FIT365_DURATIONS = [1440];
const JOYFIT_DURATIONS = [30, 60, 90, 120, 150, 180, 210];

const STATUS_META: Record<PurchaseStatus, { label: string; color: string; bg: string }> = {
  purchased: { label: "未使用", color: "#1d4ed8", bg: "#dbeafe" },
  used: { label: "使用済", color: "#047857", bg: "#d1fae5" },
  expired: { label: "期限切れ", color: "#64748b", bg: "#e2e8f0" },
  refunded: { label: "返金", color: "#b45309", bg: "#fef3c7" },
};

const GENDER_META: Record<Gender, { label: string; color: string; bg: string }> = {
  male: { label: "男性", color: "#1d4ed8", bg: "#dbeafe" },
  female: { label: "女性", color: "#be185d", bg: "#fce7f3" },
  other: { label: "その他", color: "#7c3aed", bg: "#ede9fe" },
  unknown: { label: "未回答", color: "#64748b", bg: "#e2e8f0" },
};

const AGE_GROUP_META: Record<AgeGroup, { label: string; color: string }> = {
  u20: { label: "〜19歳", color: "#06b6d4" },
  "20s": { label: "20代", color: "#3b82f6" },
  "30s": { label: "30代", color: "#10b981" },
  "40s": { label: "40代", color: "#f59e0b" },
  "50s": { label: "50代", color: "#f97316" },
  "60plus": { label: "60歳〜", color: "#ef4444" },
};

// チケット操作 (t1pass への書き込み)
type TicketOp = "use" | "unuse" | "cancel";
const OP_META: Record<TicketOp, { label: string; title: string; desc: string; confirm: string; tone: "green" | "blue" | "amber" }> = {
  use: {
    label: "利用済み",
    title: "チケットを利用済みにする",
    desc: "このチケットを利用済（消し込み）にします。EnjoyTimePass の実データを更新します。",
    confirm: "利用済みにする",
    tone: "green",
  },
  unuse: {
    label: "未使用に戻す",
    title: "チケットを未使用に戻す",
    desc: "消し込み（利用済）を取り消し、未使用の状態に戻します。EnjoyTimePass の実データを更新します。",
    confirm: "未使用に戻す",
    tone: "blue",
  },
  cancel: {
    label: "取り消し",
    title: "チケットを取り消す",
    desc: "このチケットを返金ステータスにして無効化します。※実際の返金（入金処理）は行いません。EnjoyTimePass の実データを更新します。",
    confirm: "取り消す",
    tone: "amber",
  },
};

// --- ヘルパー ---
function isJoyfit(brand: string): boolean {
  return !!brand && brand.toUpperCase().startsWith("JOYFIT");
}
function deriveUnitType(brand: string): UnitType {
  return isJoyfit(brand) ? "30min" : "1day";
}
function getDurationsForBrand(brand: string): number[] {
  return isJoyfit(brand) ? JOYFIT_DURATIONS : FIT365_DURATIONS;
}

// 推奨価格レンジ (上下限) — フォームの入力範囲を制約する
const PRICE_RANGES: Record<number, { min: number; max: number }> = {
  1440: { min: 700, max: 1500 }, // FIT365 1day pass
};
function priceRangeFor(durationMinutes: number) {
  return PRICE_RANGES[durationMinutes];
}
function formatDuration(minutes: number): string {
  if (minutes === 1440) return "1日";
  return `${minutes}分`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// 現在時刻(JST)の datetime-local 文字列 'YYYY-MM-DDTHH:mm'
function nowJstLocal(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
// datetime-local(JST) に分を加算した datetime-local 文字列
function addMinutesJstLocal(local: string, minutes: number): string {
  const ms = Date.parse(local.replace(" ", "T") + "+09:00");
  if (!Number.isFinite(ms)) return local;
  const d = new Date(ms + minutes * 60 * 1000 + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function formatYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}
function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}
function periodStatus(p: PricePeriod): "current" | "upcoming" | "expired" {
  const today = todayISO();
  if (p.validFrom > today) return "upcoming";
  if (p.validTo && p.validTo < today) return "expired";
  return "current";
}

// --- 設定タブ (管理画面) ---
function SettingsTab({
  brand,
  durations,
  setDurations,
  readOnly = false,
}: {
  brand: string;
  durations: DurationPrices[];
  setDurations: React.Dispatch<React.SetStateAction<DurationPrices[]>>;
  readOnly?: boolean;
}) {
  const unitType = deriveUnitType(brand);
  const unitLabel = unitType === "30min" ? "30分単位" : "1日単位";

  const updatePeriod = useCallback(
    (durationMinutes: number, id: string, patch: Partial<PricePeriod>) => {
      setDurations((prev) =>
        prev.map((d) =>
          d.durationMinutes === durationMinutes
            ? { ...d, periods: d.periods.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
            : d
        )
      );
    },
    [setDurations]
  );

  const addPeriod = useCallback(
    (durationMinutes: number) => {
      setDurations((prev) =>
        prev.map((d) =>
          d.durationMinutes === durationMinutes
            ? {
                ...d,
                periods: [
                  ...d.periods,
                  {
                    id: uuidv4(),
                    price: 0,
                    validFrom: todayISO(),
                    validTo: null,
                    label: "",
                    note: "",
                  },
                ],
              }
            : d
        )
      );
    },
    [setDurations]
  );

  const removePeriod = useCallback(
    (durationMinutes: number, id: string) => {
      setDurations((prev) =>
        prev.map((d) =>
          d.durationMinutes === durationMinutes
            ? { ...d, periods: d.periods.filter((p) => p.id !== id) }
            : d
        )
      );
    },
    [setDurations]
  );

  return (
    <>
      <section className="otp-info-card">
        <div className="otp-info-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 24, height: 24 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
        </div>
        <div className="otp-info-body">
          <h3 className="otp-info-title">
            {isJoyfit(brand)
              ? "現在の時間別販売金額（30〜210分）"
              : "現在の1日利用権の販売金額"}
          </h3>
          <p className="otp-info-desc">
            EnjoyTimePass（決済システム）で管理されている現在の料金を表示しています。
            この画面は<strong>参照専用</strong>で、金額の変更は EnjoyTimePass 側で行います。
          </p>
        </div>
      </section>

      <div className="otp-duration-list">
        {durations.map((d) => (
          <DurationCard
            key={d.durationMinutes}
            duration={d}
            readOnly={readOnly}
            onAdd={() => addPeriod(d.durationMinutes)}
            onUpdate={(id, patch) => updatePeriod(d.durationMinutes, id, patch)}
            onRemove={(id) => removePeriod(d.durationMinutes, id)}
          />
        ))}
      </div>
    </>
  );
}

function DurationCard({
  duration,
  onAdd,
  onUpdate,
  onRemove,
  readOnly = false,
}: {
  duration: DurationPrices;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<PricePeriod>) => void;
  onRemove: (id: string) => void;
  readOnly?: boolean;
}) {
  const sorted = useMemo(() => {
    const w: Record<string, number> = { current: 0, upcoming: 1, expired: 2 };
    return [...duration.periods].sort((a, b) => {
      const wa = w[periodStatus(a)];
      const wb = w[periodStatus(b)];
      if (wa !== wb) return wa - wb;
      return a.validFrom.localeCompare(b.validFrom);
    });
  }, [duration.periods]);

  const current = sorted.find((p) => periodStatus(p) === "current");
  const range = priceRangeFor(duration.durationMinutes);

  return (
    <section className="otp-duration-card">
      <header className="otp-duration-header">
        <div className="otp-duration-title">
          <span className="otp-duration-label">{formatDuration(duration.durationMinutes)}</span>
          {current ? (
            <span className="otp-duration-current">
              現在価格: <strong>{formatYen(current.price)}</strong>
            </span>
          ) : (
            <span className="otp-duration-current empty">価格未設定</span>
          )}
          {range && (
            <span className="otp-duration-range">
              許容レンジ: ¥{range.min.toLocaleString("ja-JP")} 〜 ¥{range.max.toLocaleString("ja-JP")}
            </span>
          )}
        </div>
        {!readOnly && (
          <button type="button" className="otp-add-btn" onClick={onAdd}>
            <span className="otp-add-icon">+</span>
            期間を追加
          </button>
        )}
      </header>

      {sorted.length === 0 ? (
        <div className="otp-empty-inline">価格が登録されていません。</div>
      ) : (
        <div className="otp-period-list">
          {sorted.map((p) => {
            const status = periodStatus(p);
            return (
              <div key={p.id} className={`otp-period-row status-${status}`}>
                <span className={`otp-status-pill status-${status}`}>
                  {status === "current" ? "適用中" : status === "upcoming" ? "適用予定" : "終了"}
                </span>
                <div className="otp-field">
                  <label className="otp-label">適用開始日 *</label>
                  <input
                    type="date"
                    className="otp-input"
                    value={p.validFrom}
                    disabled={readOnly}
                    onChange={(e) => onUpdate(p.id, { validFrom: e.target.value })}
                  />
                </div>
                <div className="otp-field">
                  <label className="otp-label">適用終了日</label>
                  <input
                    type="date"
                    className="otp-input"
                    value={p.validTo ?? ""}
                    min={p.validFrom || undefined}
                    disabled={readOnly}
                    onChange={(e) => onUpdate(p.id, { validTo: e.target.value || null })}
                  />
                </div>
                <div className="otp-field">
                  <label className="otp-label">販売金額 *</label>
                  <div className="otp-price-wrap">
                    <span className="otp-price-prefix">¥</span>
                    <input
                      type="number"
                      min={range?.min ?? 0}
                      max={range?.max}
                      step={10}
                      disabled={readOnly}
                      className={`otp-input otp-price-input ${!readOnly && range && (p.price < range.min || p.price > range.max) ? "out-of-range" : ""}`}
                      value={Number.isFinite(p.price) ? p.price : 0}
                      onChange={(e) =>
                        onUpdate(p.id, { price: Math.max(0, Number(e.target.value) || 0) })
                      }
                    />
                  </div>
                </div>
                <div className="otp-field">
                  <label className="otp-label">ラベル</label>
                  <input
                    type="text"
                    className="otp-input"
                    placeholder="—"
                    value={p.label ?? ""}
                    disabled={readOnly}
                    onChange={(e) => onUpdate(p.id, { label: e.target.value })}
                  />
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="otp-remove-btn"
                    onClick={() => onRemove(p.id)}
                    aria-label="削除"
                  >
                    削除
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// --- ダッシュボードタブ ---
function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const toS = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const f = new Date(now);
  f.setDate(f.getDate() - 29);
  const fromS = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
  return { from: fromS, to: toS };
}

function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type RangePreset = "7d" | "30d" | "90d" | "thisMonth" | "lastMonth" | "custom";

function presetRange(preset: RangePreset): { from: string; to: string } {
  const now = new Date();
  if (preset === "7d") return { from: isoDate(addDays(now, -6)), to: isoDate(now) };
  if (preset === "30d") return { from: isoDate(addDays(now, -29)), to: isoDate(now) };
  if (preset === "90d") return { from: isoDate(addDays(now, -89)), to: isoDate(now) };
  if (preset === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: isoDate(start), to: isoDate(now) };
  }
  if (preset === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: isoDate(start), to: isoDate(end) };
  }
  return defaultDateRange();
}

function rangeDays(from: string, to: string): number {
  const f = new Date(from);
  const t = new Date(to);
  return Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
}

// 簡易Markdown描画 (## 見出し / **強調** / 番号リスト / 段落)
function AiMarkdown({ text }: { text: string }) {
  const renderInline = (s: string, key: number) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return <span key={key}>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p))}</span>;
  };
  const lines = text.split("\n");
  return (
    <div className="otp-ai-md">
      {lines.map((ln, i) => {
        const t = ln.trim();
        if (!t) return null;
        if (t.startsWith("## ")) return <h4 key={i} className="otp-ai-h">{t.slice(3)}</h4>;
        if (/^\d+\.\s/.test(t)) return <div key={i} className="otp-ai-li">{renderInline(t, i)}</div>;
        if (t.startsWith("- ")) return <div key={i} className="otp-ai-li">{renderInline(t.slice(2), i)}</div>;
        return <p key={i} className="otp-ai-p">{renderInline(t, i)}</p>;
      })}
    </div>
  );
}

// 売上チャート: 実績(棒) + 3ヶ月移動平均(線) + 予測(点線+レンジ帯)
function ForecastChart({
  monthly,
  forecast,
}: {
  monthly: { ym: string; sales: number; ma: number | null }[];
  forecast: { ym: string; sales: number; low: number; high: number }[];
}) {
  const W = 760, H = 210, padL = 8, padR = 8, padT = 14, padB = 26;
  const pts = [...monthly.map((m) => ({ ym: m.ym, sales: m.sales, ma: m.ma, fc: false })),
               ...forecast.map((f) => ({ ym: f.ym, sales: f.sales, ma: null as number | null, fc: true, low: f.low, high: f.high }))];
  const n = pts.length;
  const maxY = Math.max(1, ...pts.map((p) => p.sales), ...forecast.map((f) => f.high), ...monthly.map((m) => m.ma ?? 0));
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v: number) => H - padB - (v / maxY) * (H - padT - padB);
  const bw = ((W - padL - padR) / n) * 0.55;
  const splitX = x(monthly.length - 1) + (x(1) - x(0)) / 2;

  const maPath = monthly.map((m, i) => (m.ma == null ? null : `${i === 0 || monthly[i - 1].ma == null ? "M" : "L"}${x(i)},${y(m.ma)}`)).filter(Boolean).join(" ");
  const fcStart = monthly.length - 1;
  const fcLine = [{ x: x(fcStart), y: y(monthly[monthly.length - 1].sales) }, ...forecast.map((f, i) => ({ x: x(fcStart + 1 + i), y: y(f.sales) }))];
  const fcPath = fcLine.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const band = forecast.length
    ? `M${x(fcStart + 1)},${y(forecast[0].high)} ` + forecast.map((f, i) => `L${x(fcStart + 1 + i)},${y(f.high)}`).join(" ") + " " +
      forecast.map((f, i) => `L${x(fcStart + forecast.length - i)},${y(forecast[forecast.length - 1 - i].low)}`).join(" ") + " Z"
    : "";

  return (
    <svg className="otp-fc-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {band && <path d={band} fill="rgba(168,85,247,0.12)" stroke="none" />}
      {/* 実績棒 */}
      {monthly.map((m, i) => (
        <rect key={i} x={x(i) - bw / 2} y={y(m.sales)} width={bw} height={Math.max(0, H - padB - y(m.sales))} rx={2} fill="#fcd34d" />
      ))}
      {/* 予測棒 */}
      {forecast.map((f, i) => (
        <rect key={`f${i}`} x={x(fcStart + 1 + i) - bw / 2} y={y(f.sales)} width={bw} height={Math.max(0, H - padB - y(f.sales))} rx={2} fill="rgba(168,85,247,0.35)" />
      ))}
      {maPath && <path d={maPath} fill="none" stroke="#64748b" strokeWidth={1.6} strokeDasharray="4 3" />}
      {fcPath && <path d={fcPath} fill="none" stroke="#7c3aed" strokeWidth={2} strokeDasharray="2 3" />}
      <line x1={splitX} y1={padT - 8} x2={splitX} y2={H - padB} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
      {pts.map((p, i) => (i % 2 === 0 || p.fc) && (
        <text key={`t${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill={p.fc ? "#7c3aed" : "#94a3b8"}>{p.ym.slice(5)}月</text>
      ))}
    </svg>
  );
}

function DashboardTab({ clubCode, brand }: { clubCode: string; brand: string }) {
  const { showToast } = useToast();
  const def = defaultDateRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [preset, setPreset] = useState<RangePreset>("30d");

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // チケット操作 (利用済み / 未使用に戻す / 取り消し)
  const [opTarget, setOpTarget] = useState<{ p: Purchase; op: TicketOp } | null>(null);
  const [opBusy, setOpBusy] = useState(false);
  // 消し込み(use)の利用期間 (JST datetime-local)。終了は開始+利用時間を初期値に。
  const [opStartDt, setOpStartDt] = useState("");
  const [opEndDt, setOpEndDt] = useState("");
  useEffect(() => {
    if (opTarget?.op === "use") {
      const start = nowJstLocal();
      setOpStartDt(start);
      setOpEndDt(addMinutesJstLocal(start, opTarget.p.durationMinutes || 0));
    }
  }, [opTarget]);
  // 開始変更時は終了を「開始+利用時間」に追従
  const onChangeOpStart = (v: string) => {
    setOpStartDt(v);
    if (opTarget) setOpEndDt(addMinutesJstLocal(v, opTarget.p.durationMinutes || 0));
  };
  const [statusFilter, setStatusFilter] = useState<"all" | PurchaseStatus>("all");
  const [durationFilter, setDurationFilter] = useState<number | "all">("all");
  const [genderFilter, setGenderFilter] = useState<"all" | Gender>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | AgeGroup>("all");

  // AI売上分析 + 統計予測 (店舗単位・事前集計ベース)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiMonth, setAiMonth] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiMonthly, setAiMonthly] = useState<{ ym: string; sales: number; count: number; ma: number | null }[]>([]);
  const [aiForecast, setAiForecast] = useState<{ ym: string; sales: number; count: number; low: number; high: number }[]>([]);
  const [aiTrend, setAiTrend] = useState<string | null>(null);
  const genAi = useCallback(async () => {
    setAiLoading(true); setAiErr(null); setAiText(null);
    const r = await runAiAnalysis(`/api/store-settings/onetime-pass/ai-analysis?clubCode=${clubCode}`, (d) => {
      setAiMonth(d.month); setAiMonthly(d.monthly || []); setAiForecast(d.forecast || []); setAiTrend(d.trend || null);
    });
    if (r.analysis) setAiText(r.analysis); else setAiErr(r.error || "AI分析の生成に失敗しました");
    setAiLoading(false);
  }, [clubCode]);

  const fetchData = useCallback(
    async (rangeFrom: string, rangeTo: string) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ clubCode, brand, from: rangeFrom, to: rangeTo });
        const res = await fetch(`/api/store-settings/onetime-pass/purchases?${q}`);
        if (res.ok) {
          const data = await res.json();
          setPurchases(data.purchases || []);
          setSummary(data.summary || null);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [clubCode, brand]
  );

  useEffect(() => {
    fetchData(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubCode, brand, from, to]);

  // チケット操作の実行 (t1pass への書き込み)
  const runOp = useCallback(async () => {
    if (!opTarget) return;
    const { p, op } = opTarget;
    setOpBusy(true);
    try {
      const res = await fetch("/api/store-settings/onetime-pass/checkoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubCode, ticketId: p.id, action: op, startDt: op === "use" ? opStartDt : undefined, endDt: op === "use" ? opEndDt : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "操作に失敗しました");
      setPurchases((prev) =>
        prev.map((x) =>
          x.id === p.id
            ? { ...x, status: data.status ?? x.status, usedAt: data.usedAt !== undefined ? data.usedAt : x.usedAt }
            : x
        )
      );
      showToast(`${p.purchaserName} さんのチケットを「${OP_META[op].label}」しました。`, "success");
      setOpTarget(null);
    } catch (e: any) {
      showToast(e?.message || "操作に失敗しました。", "error");
    } finally {
      setOpBusy(false);
    }
  }, [opTarget, clubCode, showToast, opStartDt, opEndDt]);

  // 返金 (入金処理の繋ぎこみは後日 — 現状はボタンのみ)
  const handleRefundClick = useCallback(() => {
    showToast("返金（入金処理）は現在準備中です（後日連携予定）。", "info");
  }, [showToast]);

  const applyPreset = (p: RangePreset) => {
    setPreset(p);
    if (p === "custom") return;
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  };

  const filtered = useMemo(() => {
    return purchases.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (durationFilter !== "all" && p.durationMinutes !== durationFilter) return false;
      if (genderFilter !== "all" && p.gender !== genderFilter) return false;
      if (ageFilter !== "all" && p.ageGroup !== ageFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          p.purchaserName.toLowerCase().includes(q) ||
          (p.purchaserEmail?.toLowerCase().includes(q) ?? false) ||
          (p.purchaserPhone?.toLowerCase().includes(q) ?? false) ||
          (p.memberCode?.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      return true;
    });
  }, [purchases, statusFilter, durationFilter, genderFilter, ageFilter, search]);

  const durations = getDurationsForBrand(brand);
  const days = rangeDays(from, to);
  const dailyAvgSales = summary ? Math.round(summary.totalSales / days) : 0;
  const totalGenderSales = summary ? summary.byGender.reduce((s, x) => s + x.sales, 0) : 0;

  return (
    <>
      <AdminLoadingOverlay visible={loading} text="購入データを読み込み中..." />

      {/* AI売上分析 (店舗単位・事前集計ベース / 相手DB負荷なし) */}
      <section className="otp-ai-card">
        <div className="otp-ai-head">
          <div className="otp-ai-title">
            <span className="otp-ai-badge">AI</span>
            売上分析（この店舗）
            {aiMonth && <span className="otp-ai-month">対象月 {aiMonth}</span>}
          </div>
          <button type="button" className="otp-ai-btn" onClick={genAi} disabled={aiLoading}>
            {aiLoading ? "分析中…" : aiText ? "再分析" : "AIで分析する"}
          </button>
        </div>
        {aiErr && <div className="otp-ai-err">{aiErr}</div>}

        {aiMonthly.length > 0 && (
          <div className="otp-fc-wrap">
            <div className="otp-fc-legend">
              <span className="otp-fc-lg"><span className="otp-fc-swatch bar" />実績売上</span>
              <span className="otp-fc-lg"><span className="otp-fc-swatch ma" />3ヶ月移動平均</span>
              <span className="otp-fc-lg"><span className="otp-fc-swatch fc" />予測（次3ヶ月）</span>
              {aiTrend && <span className="otp-fc-trend">トレンド: {aiTrend}</span>}
            </div>
            <ForecastChart monthly={aiMonthly} forecast={aiForecast} />
            {aiForecast.length > 0 && (
              <div className="otp-fc-cards">
                {aiForecast.map((f) => (
                  <div key={f.ym} className="otp-fc-fcard">
                    <div className="otp-fc-fym">{f.ym} 予測</div>
                    <div className="otp-fc-fsales">{formatYen(f.sales)}</div>
                    <div className="otp-fc-frange">{f.count}件 / ¥{f.low.toLocaleString("ja-JP")}〜¥{f.high.toLocaleString("ja-JP")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {aiLoading ? (
          <AiSpinner />
        ) : aiText ? (
          <AiMarkdown text={aiText} />
        ) : (
          !aiErr && <div className="otp-ai-empty">夜間集計データをもとに、移動平均・売上予測とAIの推測（傾向・需要・客層・施策）を組み合わせて分析します。</div>
        )}
      </section>

      {/* 期間フィルター */}
      <section className="otp-range-bar">
        <div className="otp-range-left">
          <div className="otp-range-label">分析期間</div>
          <div className="otp-range-presets">
            {[
              { id: "7d", label: "過去7日" },
              { id: "30d", label: "過去30日" },
              { id: "90d", label: "過去90日" },
              { id: "thisMonth", label: "今月" },
              { id: "lastMonth", label: "先月" },
              { id: "custom", label: "カスタム" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={`otp-range-preset ${preset === p.id ? "active" : ""}`}
                onClick={() => applyPreset(p.id as RangePreset)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="otp-range-dates">
            <input
              type="date"
              className="otp-input otp-range-date"
              value={from}
              max={to}
              onChange={(e) => {
                setPreset("custom");
                setFrom(e.target.value);
              }}
            />
            <span className="otp-range-sep">〜</span>
            <input
              type="date"
              className="otp-input otp-range-date"
              value={to}
              min={from}
              onChange={(e) => {
                setPreset("custom");
                setTo(e.target.value);
              }}
            />
            <span className="otp-range-days">{days}日間</span>
          </div>
        </div>
      </section>

      {/* サマリー */}
      <section className="otp-summary-grid">
        <SummaryCard
          label="期間内 売上"
          value={summary ? formatYen(summary.totalSales) : "—"}
          sub={summary ? `日次平均 ${formatYen(dailyAvgSales)}` : ""}
          color="#10b981"
          loading={loading}
        />
        <SummaryCard
          label="購入件数"
          value={summary ? summary.totalCount.toString() + "件" : "—"}
          sub={summary ? `平均単価 ${formatYen(summary.averagePrice)}` : ""}
          color="#3b82f6"
          loading={loading}
        />
        <SummaryCard
          label="ユニーク顧客数"
          value={summary ? summary.uniqueCustomers.toString() + "名" : "—"}
          sub={summary ? `新規 ${summary.newCustomers} / 既存 ${summary.returningCustomers}` : ""}
          color="#8b5cf6"
          loading={loading}
        />
        <SummaryCard
          label="リピート率"
          value={summary ? `${summary.repeatRate}%` : "—"}
          sub={summary && summary.uniqueCustomers > 0
            ? `1人あたり ${(summary.totalCount / summary.uniqueCustomers).toFixed(1)}回`
            : ""}
          color="#f59e0b"
          loading={loading}
        />
      </section>

      {/* デモグラフィック: 性別 + 年代 */}
      <section className="otp-demo-grid">
        <div className="otp-demo-card">
          <h3 className="otp-section-title">性別内訳</h3>
          {summary && summary.byGender.length > 0 ? (
            <>
              <div className="otp-gender-bar">
                {summary.byGender.map((g) => {
                  const pct = totalGenderSales > 0 ? (g.sales / totalGenderSales) * 100 : 0;
                  return (
                    <div
                      key={g.gender}
                      className="otp-gender-seg"
                      style={{ width: `${pct}%`, background: GENDER_META[g.gender].color }}
                      title={`${GENDER_META[g.gender].label}: ${pct.toFixed(1)}%`}
                    />
                  );
                })}
              </div>
              <div className="otp-gender-list">
                {summary.byGender.map((g) => {
                  const pct = summary.totalCount > 0 ? (g.count / summary.totalCount) * 100 : 0;
                  return (
                    <div key={g.gender} className="otp-gender-row">
                      <span
                        className="otp-gender-dot"
                        style={{ background: GENDER_META[g.gender].color }}
                      />
                      <span className="otp-gender-label">{GENDER_META[g.gender].label}</span>
                      <span className="otp-gender-count">{g.count}件 ({pct.toFixed(0)}%)</span>
                      <span className="otp-gender-sales">{formatYen(g.sales)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="otp-mini-empty">データがありません</div>
          )}
        </div>

        <div className="otp-demo-card">
          <div className="otp-section-title-row">
            <h3 className="otp-section-title">年代内訳（男女別）</h3>
            <div className="otp-agender-legend">
              <span><i style={{ background: GENDER_META.male.color }} />男性</span>
              <span><i style={{ background: GENDER_META.female.color }} />女性</span>
              <span><i style={{ background: GENDER_META.unknown.color }} />その他</span>
            </div>
          </div>
          {summary && summary.byAgeGroup.length > 0 ? (
            <div className="otp-age-grid">
              {summary.byAgeGroup.map((a) => {
                const max = Math.max(...summary.byAgeGroup.map((x) => x.count), 1);
                const totalH = (a.count / max) * 100;
                const otherCnt = a.other + a.unknown;
                return (
                  <div key={a.ageGroup} className="otp-age-col">
                    <div className="otp-age-bar-wrap">
                      <span className="otp-age-count">{a.count}</span>
                      <div className="otp-age-stack" style={{ height: `${totalH}%` }}>
                        {a.male > 0 && (
                          <div className="otp-age-seg" style={{ flex: a.male, background: GENDER_META.male.color }} title={`男性 ${a.male}件`} />
                        )}
                        {a.female > 0 && (
                          <div className="otp-age-seg" style={{ flex: a.female, background: GENDER_META.female.color }} title={`女性 ${a.female}件`} />
                        )}
                        {otherCnt > 0 && (
                          <div className="otp-age-seg" style={{ flex: otherCnt, background: GENDER_META.unknown.color }} title={`その他 ${otherCnt}件`} />
                        )}
                      </div>
                    </div>
                    <span className="otp-age-label">{AGE_GROUP_META[a.ageGroup].label}</span>
                    <span className="otp-age-gsplit">♂{a.male}・♀{a.female}</span>
                    <span className="otp-age-sales">{formatYen(a.sales)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="otp-mini-empty">データがありません</div>
          )}
        </div>
      </section>

      {/* 時間帯別 購入数 (視認性強化: 件数ラベル + ピーク強調 + 2時間毎軸) */}
      <section className="otp-demo-card otp-hour-section">
        <div className="otp-section-title-row">
          <h3 className="otp-section-title">時間帯別 購入数</h3>
          {summary && summary.byHour.some((h) => h.count > 0) && (() => {
            const peak = summary.byHour.reduce((a, b) => (b.count > a.count ? b : a));
            return <span className="otp-hour-peak-tag">ピーク {peak.hour}時台（{peak.count}件）</span>;
          })()}
        </div>
        {summary && summary.byHour.some((h) => h.count > 0) ? (
          <>
            <div className="otp-hour-chart2">
              {(() => {
                const max = Math.max(...summary.byHour.map((x) => x.count), 1);
                return summary.byHour.map((h) => {
                  const heightPct = (h.count / max) * 100;
                  const isPeak = h.count === max && h.count > 0;
                  return (
                    <div key={h.hour} className="otp-hour-col2" title={`${h.hour}時台: ${h.count}件 / ${formatYen(h.sales)}`}>
                      <span className="otp-hour-num">{h.count > 0 ? h.count : ""}</span>
                      <div className="otp-hour-track2">
                        <div
                          className={`otp-hour-fill2 ${isPeak ? "peak" : ""}`}
                          style={{ height: `${h.count > 0 ? Math.max(heightPct, 5) : 0}%` }}
                        />
                      </div>
                      <span className="otp-hour-hr">{h.hour % 2 === 0 ? h.hour : ""}</span>
                    </div>
                  );
                });
              })()}
            </div>
            <div className="otp-hour-axis-note">時間帯（0〜23時）</div>
          </>
        ) : (
          <div className="otp-mini-empty">データがありません</div>
        )}
      </section>

      {/* 曜日別 購入数 + 利用数 */}
      <section className="otp-demo-card">
        <div className="otp-section-title-row">
          <h3 className="otp-section-title">曜日別 購入数・利用数</h3>
          <div className="otp-agender-legend">
            <span><i style={{ background: "#f59e0b" }} />購入</span>
            <span><i style={{ background: "#10b981" }} />利用</span>
          </div>
        </div>
        {summary && summary.byDayOfWeek.some((d) => d.count > 0 || d.usedCount > 0) ? (
          <div className="otp-dow-dual">
            {(() => {
              const max = Math.max(...summary.byDayOfWeek.flatMap((x) => [x.count, x.usedCount]), 1);
              return summary.byDayOfWeek.map((d) => (
                <div key={d.dayOfWeek} className="otp-dow-dual-row">
                  <span className={`otp-dow-day ${d.dayOfWeek === 0 ? "sun" : d.dayOfWeek === 6 ? "sat" : ""}`}>{d.label}</span>
                  <div className="otp-dow-dual-bars">
                    <div className="otp-dow-dual-line">
                      <div className="otp-dow-dual-track"><div className="otp-dow-dual-fill buy" style={{ width: `${(d.count / max) * 100}%` }} /></div>
                      <span className="otp-dow-dual-val">{d.count}<small>購入</small></span>
                    </div>
                    <div className="otp-dow-dual-line">
                      <div className="otp-dow-dual-track"><div className="otp-dow-dual-fill use" style={{ width: `${(d.usedCount / max) * 100}%` }} /></div>
                      <span className="otp-dow-dual-val">{d.usedCount}<small>利用</small></span>
                    </div>
                  </div>
                </div>
              ));
            })()}
          </div>
        ) : (
          <div className="otp-mini-empty">データがありません</div>
        )}
      </section>

      {/* 新規 vs リピーター + トップ顧客 */}
      <section className="otp-demo-grid">
        <div className="otp-demo-card">
          <h3 className="otp-section-title">新規 vs リピーター</h3>
          {summary && summary.uniqueCustomers > 0 ? (
            <div className="otp-newrep">
              <div className="otp-newrep-donut">
                <svg viewBox="0 0 36 36" className="otp-donut">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="4"
                    strokeDasharray={`${(summary.returningCustomers / summary.uniqueCustomers) * 100} ${100 - (summary.returningCustomers / summary.uniqueCustomers) * 100}`}
                    strokeDashoffset="25"
                    transform="rotate(-90 18 18)"
                  />
                  <text x="18" y="17" textAnchor="middle" className="otp-donut-num">
                    {summary.repeatRate}%
                  </text>
                  <text x="18" y="23" textAnchor="middle" className="otp-donut-sub">
                    リピート
                  </text>
                </svg>
              </div>
              <div className="otp-newrep-stats">
                <div className="otp-newrep-row">
                  <span className="otp-newrep-dot" style={{ background: "#10b981" }} />
                  <div className="otp-newrep-info">
                    <span className="otp-newrep-label">新規顧客</span>
                    <span className="otp-newrep-count">{summary.newCustomers}名</span>
                  </div>
                </div>
                <div className="otp-newrep-row">
                  <span className="otp-newrep-dot" style={{ background: "#3b82f6" }} />
                  <div className="otp-newrep-info">
                    <span className="otp-newrep-label">既存リピーター</span>
                    <span className="otp-newrep-count">{summary.returningCustomers}名</span>
                  </div>
                </div>
                <div className="otp-newrep-row">
                  <span className="otp-newrep-dot" style={{ background: "#94a3b8" }} />
                  <div className="otp-newrep-info">
                    <span className="otp-newrep-label">合計</span>
                    <span className="otp-newrep-count">{summary.uniqueCustomers}名</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="otp-mini-empty">データがありません</div>
          )}
        </div>

        <div className="otp-demo-card">
          <h3 className="otp-section-title">トップ顧客 TOP 5</h3>
          {summary && summary.topCustomers.length > 0 ? (
            <ol className="otp-top-cust-list">
              {summary.topCustomers.map((c, idx) => (
                <li key={(c.memberCode ?? c.memberName) + idx} className="otp-top-cust-row">
                  <span className={`otp-top-rank rank-${idx + 1}`}>{idx + 1}</span>
                  <div className="otp-top-cust-info">
                    <span className="otp-top-cust-name">{c.memberName}</span>
                    <div className="otp-top-cust-meta">
                      {c.memberCode ? (
                        <code className="otp-top-cust-code">{c.memberCode}</code>
                      ) : (
                        <span className="otp-na">ゲスト</span>
                      )}
                      <span className="otp-top-cust-days">{c.purchaseCount}回 / 最終 {formatDate(c.lastPurchasedAt)}</span>
                    </div>
                  </div>
                  <span className="otp-top-cust-sales">{formatYen(c.totalSales)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="otp-mini-empty">データがありません</div>
          )}
        </div>
      </section>

      {/* 期間別 + ステータス */}
      <section className="otp-breakdown-grid">
        <div className="otp-breakdown-card">
          <h3 className="otp-breakdown-title">利用時間別 売上</h3>
          {summary && summary.byDuration.length > 0 ? (
            <div className="otp-breakdown-list">
              {summary.byDuration.map((d) => {
                const max = Math.max(...summary.byDuration.map((x) => x.sales), 1);
                const w = (d.sales / max) * 100;
                return (
                  <div key={d.durationMinutes} className="otp-bar-row">
                    <span className="otp-bar-label">{formatDuration(d.durationMinutes)}</span>
                    <div className="otp-bar-track">
                      <div className="otp-bar-fill" style={{ width: `${w}%` }} />
                    </div>
                    <span className="otp-bar-value">
                      {d.count}件 / {formatYen(d.sales)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="otp-mini-empty">データがありません</div>
          )}
        </div>

        <div className="otp-breakdown-card">
          <h3 className="otp-breakdown-title">ステータス内訳</h3>
          {summary && summary.byStatus.length > 0 ? (
            <div className="otp-status-list">
              {summary.byStatus.map((s) => (
                <div key={s.status} className="otp-status-row">
                  <span
                    className="otp-status-chip"
                    style={{ color: STATUS_META[s.status].color, background: STATUS_META[s.status].bg }}
                  >
                    {STATUS_META[s.status].label}
                  </span>
                  <span className="otp-status-count">{s.count}件</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="otp-mini-empty">データがありません</div>
          )}
        </div>
      </section>

      {/* 購入者リスト */}
      <section className="otp-list-card">
        <div className="otp-list-header">
          <h2 className="otp-list-title">
            購入者一覧
            <span className="otp-count">{filtered.length}</span>
          </h2>
        </div>

        <div className="otp-filters">
          <input
            type="text"
            className="otp-search"
            placeholder="名前・メール・電話・会員番号で検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | PurchaseStatus)}
            className="otp-select"
          >
            <option value="all">全ステータス</option>
            <option value="purchased">未使用</option>
            <option value="used">使用済</option>
            <option value="expired">期限切れ</option>
            <option value="refunded">返金</option>
          </select>
          <select
            value={durationFilter === "all" ? "all" : String(durationFilter)}
            onChange={(e) =>
              setDurationFilter(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="otp-select"
          >
            <option value="all">全利用時間</option>
            {durations.map((d) => (
              <option key={d} value={d}>
                {formatDuration(d)}
              </option>
            ))}
          </select>
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value as "all" | Gender)}
            className="otp-select"
          >
            <option value="all">全性別</option>
            <option value="male">男性</option>
            <option value="female">女性</option>
            <option value="other">その他</option>
            <option value="unknown">未回答</option>
          </select>
          <select
            value={ageFilter}
            onChange={(e) => setAgeFilter(e.target.value as "all" | AgeGroup)}
            className="otp-select"
          >
            <option value="all">全年代</option>
            <option value="u20">〜19歳</option>
            <option value="20s">20代</option>
            <option value="30s">30代</option>
            <option value="40s">40代</option>
            <option value="50s">50代</option>
            <option value="60plus">60歳〜</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="otp-empty">
            <div className="otp-empty-text">
              {loading
                ? "読み込み中..."
                : purchases.length === 0
                ? "この期間の購入データはありません。"
                : "条件に一致する購入データがありません。"}
            </div>
          </div>
        ) : (
          <div className="otp-table-wrap">
            <table className="otp-table">
              <thead>
                <tr>
                  <th>購入者</th>
                  <th className="otp-th-center">性別</th>
                  <th>年齢</th>
                  <th>連絡先</th>
                  <th>会員番号</th>
                  <th>利用時間</th>
                  <th>金額</th>
                  <th>購入日時</th>
                  <th>利用日時</th>
                  <th>新規/既存</th>
                  <th>ステータス</th>
                  <th className="otp-th-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="otp-name-cell">{p.purchaserName}</td>
                    <td className="otp-gender-td">
                      <span
                        className="otp-gender-chip"
                        style={{ color: GENDER_META[p.gender].color, background: GENDER_META[p.gender].bg }}
                      >
                        {p.gender === "male" ? "♂" : p.gender === "female" ? "♀" : "•"} {GENDER_META[p.gender].label}
                      </span>
                    </td>
                    <td className="otp-age-cell">
                      {p.age}歳 <span className="otp-age-group-sub">({AGE_GROUP_META[p.ageGroup].label})</span>
                    </td>
                    <td>
                      <div className="otp-contact">
                        {p.purchaserEmail && <div>{p.purchaserEmail}</div>}
                        {p.purchaserPhone && <div className="otp-phone">{p.purchaserPhone}</div>}
                        {!p.purchaserEmail && !p.purchaserPhone && <span className="otp-na">—</span>}
                      </div>
                    </td>
                    <td>
                      {p.memberCode ? (
                        <code className="otp-mcode">{p.memberCode}</code>
                      ) : (
                        <span className="otp-na">ゲスト</span>
                      )}
                    </td>
                    <td className="otp-dur-cell">{formatDuration(p.durationMinutes)}</td>
                    <td className="otp-price-cell">{formatYen(p.price)}</td>
                    <td className="otp-date-cell">{formatDateTime(p.purchasedAt)}</td>
                    <td className="otp-date-cell">
                      {p.usedAt ? formatDateTime(p.usedAt) : <span className="otp-na">—</span>}
                    </td>
                    <td>
                      {p.isFirstPurchase ? (
                        <span className="otp-status-chip" style={{ color: "#047857", background: "#d1fae5" }}>新規</span>
                      ) : (
                        <span className="otp-status-chip" style={{ color: "#1d4ed8", background: "#dbeafe" }}>既存</span>
                      )}
                    </td>
                    <td>
                      <span
                        className="otp-status-chip"
                        style={{ color: STATUS_META[p.status].color, background: STATUS_META[p.status].bg }}
                      >
                        {STATUS_META[p.status].label}
                      </span>
                    </td>
                    <td className="otp-actions-td">
                      <div className="otp-row-actions">
                        {p.status === "purchased" && (
                          <button type="button" className="otp-act-btn use" title="このチケットを利用済にする（消し込み）"
                            onClick={() => setOpTarget({ p, op: "use" })}>
                            利用済み
                          </button>
                        )}
                        {p.status === "used" && (
                          <button type="button" className="otp-act-btn unuse" title="消し込みを取り消して未使用に戻す"
                            onClick={() => setOpTarget({ p, op: "unuse" })}>
                            未使用に戻す
                          </button>
                        )}
                        {p.status !== "refunded" && (
                          <button type="button" className="otp-act-btn cancel" title="チケットを取り消す（返金ステータス化・入金処理なし）"
                            onClick={() => setOpTarget({ p, op: "cancel" })}>
                            取り消し
                          </button>
                        )}
                        <button type="button" className="otp-act-btn refund" disabled={p.status === "refunded"}
                          title="返金（入金処理・準備中）" onClick={handleRefundClick}>
                          返金
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* チケット操作 確認モーダル */}
      {opTarget && (
        <div className="otp-modal-overlay" onClick={() => !opBusy && setOpTarget(null)}>
          <div className="otp-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="otp-modal-title">{OP_META[opTarget.op].title}</h3>
            <p className="otp-modal-desc">{OP_META[opTarget.op].desc}</p>
            <dl className="otp-modal-detail">
              <div><dt>購入者</dt><dd>{opTarget.p.purchaserName}</dd></div>
              <div><dt>会員番号</dt><dd>{opTarget.p.memberCode || "ゲスト"}</dd></div>
              <div><dt>利用時間</dt><dd>{formatDuration(opTarget.p.durationMinutes)}</dd></div>
              <div><dt>金額</dt><dd>{formatYen(opTarget.p.price)}</dd></div>
              <div><dt>購入日時</dt><dd>{formatDateTime(opTarget.p.purchasedAt)}</dd></div>
            </dl>
            {opTarget.op === "use" && (
              <div className="otp-modal-endfield">
                <label>利用した期間（利用時間 {formatDuration(opTarget.p.durationMinutes)}）</label>
                <div className="otp-period-row">
                  <input type="datetime-local" value={opStartDt} max={nowJstLocal()} onChange={(e) => onChangeOpStart(e.target.value)} />
                  <span className="otp-period-tilde">〜</span>
                  <input type="datetime-local" value={opEndDt} min={opStartDt} onChange={(e) => setOpEndDt(e.target.value)} />
                </div>
                <span className="otp-modal-hint">開始を選ぶと終了は「開始＋利用時間」に自動設定されます（終了は手動調整も可）。</span>
              </div>
            )}
            <div className="otp-modal-actions">
              <button type="button" className="otp-modal-cancel" disabled={opBusy} onClick={() => setOpTarget(null)}>
                キャンセル
              </button>
              <button type="button" className={`otp-modal-confirm tone-${OP_META[opTarget.op].tone}`} disabled={opBusy || (opTarget.op === "use" && (!opStartDt || !opEndDt))} onClick={runOp}>
                {opBusy ? "処理中…" : OP_META[opTarget.op].confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  color,
  loading,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="otp-summary-card">
      <div className="otp-summary-bar" style={{ background: color }} />
      <div className="otp-summary-body">
        <div className="otp-summary-label">{label}</div>
        <div className="otp-summary-value">{loading ? "—" : value}</div>
        {sub && <div className="otp-summary-sub">{sub}</div>}
      </div>
    </div>
  );
}

// --- プライシングタブ ---
function PricingTab({
  clubCode,
  brand,
  durations,
  onApplySuggestion,
  onApplySeasonal,
  onApplyAllSeasonal,
}: {
  clubCode: string;
  brand: string;
  durations: DurationPrices[];
  onApplySuggestion: (s: PriceSuggestion) => void;
  onApplySeasonal: (period: SeasonalPeriod, dp: SeasonalDurationPrice) => void;
  onApplyAllSeasonal: (period: SeasonalPeriod) => void;
}) {
  const { showToast } = useToast();
  const [analysis, setAnalysis] = useState<PricingAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  // 各 duration の「現価格」(適用中の期間があればその金額、なければ未設定)
  const currentPriceMap = useMemo(() => {
    const today = todayISO();
    const map = new Map<number, number>();
    durations.forEach((d) => {
      const current = d.periods.find((p) => {
        const fromOK = p.validFrom <= today;
        const toOK = !p.validTo || p.validTo >= today;
        return fromOK && toOK;
      });
      if (current) map.set(d.durationMinutes, current.price);
    });
    return map;
  }, [durations]);

  const runAnalysis = useCallback(
    async (demo: boolean) => {
      setLoading(true);
      try {
        const currentPrices = Array.from(currentPriceMap.entries()).map(([durationMinutes, price]) => ({
          durationMinutes,
          price,
        }));
        const res = await fetch("/api/store-settings/onetime-pass/pricing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clubCode, brand, demo, currentPrices }),
        });
        if (!res.ok) throw new Error("analysis failed");
        const data = await res.json();
        setAnalysis(data.analysis || null);
      } catch (e) {
        console.error(e);
        showToast("分析の取得に失敗しました。", "error");
      } finally {
        setLoading(false);
      }
    },
    [clubCode, brand, currentPriceMap, showToast]
  );

  useEffect(() => {
    runAnalysis(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubCode, brand]);

  const maxHourly = useMemo(
    () => (analysis ? Math.max(1, ...analysis.hourly.map((h) => h.count)) : 1),
    [analysis]
  );
  const maxDow = useMemo(
    () => (analysis ? Math.max(1, ...analysis.dayOfWeek.map((d) => d.count)) : 1),
    [analysis]
  );

  return (
    <>
      {/* インサイト */}
      <section className="otp-insight-card">
        <div className="otp-insight-header">
          <div className="otp-insight-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 22, height: 22 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
          </div>
          <div>
            <h3 className="otp-insight-title">分析サマリー</h3>
            <p className="otp-insight-sub">
              売上傾向と需要パターンに基づくダイナミックプライシングの提案です。
            </p>
          </div>
        </div>
        {analysis && analysis.insights.length > 0 ? (
          <ul className="otp-insight-list">
            {analysis.insights.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <div className="otp-mini-empty">
            {loading ? "分析中..." : "売上データがありません。"}
          </div>
        )}

        {/* 価格決定の要因 */}
        {analysis && analysis.pricingFactors.length > 0 && (
          <div className="otp-factors-block">
            <div className="otp-rationale-head">
              <span className="otp-rationale-icon">💡</span>
              <span className="otp-rationale-heading">価格決定の要因</span>
              <span className="otp-rationale-sub">この6つの要因を合成して提案価格を算出しています</span>
            </div>
            <div className="otp-factors-grid">
              {analysis.pricingFactors.map((f) => (
                <div key={f.id} className="otp-factor-card">
                  <div className="otp-factor-head">
                    <span className="otp-factor-label">{f.label}</span>
                    <span className="otp-factor-range">{f.rangeText}</span>
                  </div>
                  <p className="otp-factor-desc">{f.description}</p>
                  <p className="otp-factor-example">
                    <span className="otp-factor-example-label">例:</span> {f.exampleText}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 計算例 */}
        {analysis && analysis.calculationExamples.length > 0 && (
          <div className="otp-examples-block">
            <div className="otp-rationale-head">
              <span className="otp-rationale-icon">🧮</span>
              <span className="otp-rationale-heading">計算例</span>
              <span className="otp-rationale-sub">代表的なスロットでの価格算出ステップ</span>
            </div>
            <div className="otp-examples-grid">
              {analysis.calculationExamples.map((ex) => {
                const dir = ex.totalChangePct > 0 ? "up" : ex.totalChangePct < 0 ? "down" : "flat";
                return (
                  <div key={`${ex.durationMinutes}-${ex.slotId}`} className={`otp-example-card direction-${dir}`}>
                    <div className="otp-example-head">
                      <span className="otp-example-dur">{formatDuration(ex.durationMinutes)}</span>
                      <span className="otp-example-slot">{ex.slotLabel}</span>
                      <span className={`otp-example-total direction-${dir}`}>
                        {formatYen(ex.startPrice)} → {formatYen(ex.finalPrice)}
                        <span className="otp-example-pct">
                          ({ex.totalChangePct >= 0 ? "+" : ""}{ex.totalChangePct}%)
                        </span>
                      </span>
                    </div>
                    <ol className="otp-steps-list">
                      <li className="otp-step otp-step-start">
                        <div className="otp-step-marker">開始</div>
                        <div className="otp-step-body">
                          <div className="otp-step-label">現価格</div>
                          <div className="otp-step-price">{formatYen(ex.startPrice)}</div>
                        </div>
                      </li>
                      {ex.steps.map((st, i) => (
                        <li key={i} className="otp-step">
                          <div className={`otp-step-marker op-${st.operator === "×" ? "mul" : st.operator === "+" ? "add" : "op"}`}>
                            {st.operator}
                          </div>
                          <div className="otp-step-body">
                            <div className="otp-step-label">
                              {st.label}
                              <span className="otp-step-factor">{st.factorText}</span>
                            </div>
                            {st.detail && <div className="otp-step-detail">{st.detail}</div>}
                            <div className="otp-step-price">
                              <span className="otp-step-before">{formatYen(st.beforePrice)}</span>
                              <span className="otp-step-arrow">→</span>
                              <span className="otp-step-after">{formatYen(st.afterPrice)}</span>
                            </div>
                          </div>
                        </li>
                      ))}
                      <li className={`otp-step otp-step-final direction-${dir}`}>
                        <div className="otp-step-marker final">最終</div>
                        <div className="otp-step-body">
                          <div className="otp-step-label">提案価格</div>
                          <div className="otp-step-price-final">{formatYen(ex.finalPrice)}</div>
                        </div>
                      </li>
                    </ol>
                    {ex.note && <p className="otp-example-note">{ex.note}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* チャート: 時間帯 + 曜日 */}
      <section className="otp-pricing-charts">
        <div className="otp-chart-card">
          <h3 className="otp-section-title">時間帯別 販売件数</h3>
          {analysis && analysis.hourly.length > 0 ? (
            <div className="otp-hourly-chart">
              {analysis.hourly.map((h) => (
                <div key={h.hour} className="otp-hourly-bar">
                  <div
                    className="otp-hourly-fill"
                    style={{ height: `${(h.count / maxHourly) * 100}%` }}
                    title={`${h.hour}時: ${h.count}件 / ${formatYen(h.sales)}`}
                  />
                  <span className="otp-hourly-label">{h.hour % 3 === 0 ? h.hour : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="otp-mini-empty">データがありません</div>
          )}
        </div>

        <div className="otp-chart-card">
          <h3 className="otp-section-title">曜日別 販売件数</h3>
          {analysis && analysis.dayOfWeek.length > 0 ? (
            <div className="otp-dow-chart">
              {analysis.dayOfWeek.map((d) => (
                <div key={d.dayOfWeek} className="otp-dow-row">
                  <span className={`otp-dow-label ${d.dayOfWeek === 0 ? "sun" : d.dayOfWeek === 6 ? "sat" : ""}`}>{d.label}</span>
                  <div className="otp-dow-track">
                    <div
                      className="otp-dow-fill"
                      style={{ width: `${(d.count / maxDow) * 100}%` }}
                    />
                  </div>
                  <span className="otp-dow-value">{d.count}件</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="otp-mini-empty">データがありません</div>
          )}
        </div>
      </section>

      {/* 期間別需要 */}
      <section className="otp-demand-card">
        <h3 className="otp-section-title">期間別 需要分析</h3>
        {analysis && analysis.durationDemand.length > 0 ? (
          <div className="otp-table-wrap">
            <table className="otp-table">
              <thead>
                <tr>
                  <th>利用時間</th>
                  <th style={{ textAlign: "right" }}>販売件数</th>
                  <th style={{ textAlign: "right" }}>売上</th>
                  <th>占有率</th>
                  <th>ピーク時間</th>
                  <th>ピーク曜日</th>
                  <th>トレンド</th>
                </tr>
              </thead>
              <tbody>
                {analysis.durationDemand.map((d) => (
                  <tr key={d.durationMinutes}>
                    <td className="otp-dur-cell">{formatDuration(d.durationMinutes)}</td>
                    <td className="otp-price-cell">{d.count}件</td>
                    <td className="otp-price-cell">{formatYen(d.sales)}</td>
                    <td>
                      <div className="otp-occ-wrap">
                        <div className="otp-occ-track">
                          <div
                            className={`otp-occ-fill ${d.occupancyRate >= 0.75 ? "high" : d.occupancyRate < 0.45 ? "low" : "mid"}`}
                            style={{ width: `${d.occupancyRate * 100}%` }}
                          />
                        </div>
                        <span className="otp-occ-text">{Math.round(d.occupancyRate * 100)}%</span>
                      </div>
                    </td>
                    <td>{d.peakHour}時台</td>
                    <td>{d.peakDay}曜日</td>
                    <td>
                      <span className={`otp-trend-pill trend-${d.trend}`}>
                        {d.trend === "up" ? "↑" : d.trend === "down" ? "↓" : "→"}
                        {d.trendPct >= 0 ? "+" : ""}{d.trendPct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="otp-mini-empty">データがありません</div>
        )}
      </section>

      {/* 価格提案 (期間別) */}
      <section className="otp-suggest-section">
        <h3 className="otp-section-title">期間別 価格提案</h3>
        {analysis && analysis.suggestions.length > 0 ? (
          <div className="otp-suggest-grid">
            {analysis.suggestions.map((s) => {
              const baseDirection = s.baseChangePct > 0 ? "up" : s.baseChangePct < 0 ? "down" : "flat";
              return (
                <div key={s.durationMinutes} className={`otp-suggest-card direction-${baseDirection}`}>
                  <div className="otp-suggest-head">
                    <div className="otp-suggest-head-left">
                      <span className="otp-suggest-duration">{formatDuration(s.durationMinutes)}</span>
                      {s.priceRange && (
                        <span className="otp-range-pill">
                          許容レンジ ¥{s.priceRange.min.toLocaleString("ja-JP")} 〜 ¥{s.priceRange.max.toLocaleString("ja-JP")}
                        </span>
                      )}
                    </div>
                    <span className={`otp-conf-pill conf-${s.confidence}`}>
                      信頼度: {s.confidence === "high" ? "高" : s.confidence === "medium" ? "中" : "低"}
                    </span>
                  </div>

                  <div className="otp-base-compare">
                    <div className="otp-base-col">
                      <span className="otp-base-label">現価格</span>
                      <span className="otp-base-now">{formatYen(s.currentPrice)}</span>
                    </div>
                    <div className={`otp-base-arrow direction-${baseDirection}`}>
                      {baseDirection === "up" ? "↑" : baseDirection === "down" ? "↓" : "→"}
                      <span className="otp-base-delta">
                        {s.baseChangePct >= 0 ? "+" : ""}{s.baseChangePct}%
                      </span>
                    </div>
                    <div className="otp-base-col suggested">
                      <span className="otp-base-label">推奨ベース</span>
                      <span className={`otp-base-new direction-${baseDirection}`}>{formatYen(s.basePrice)}</span>
                      {s.baseClamped && (
                        <span className={`otp-clamp-pill clamp-${s.baseClamped}`}>
                          {s.baseClamped === "max" ? "上限到達" : "下限到達"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 期間別スロット */}
                  <div className="otp-slot-block">
                    <div className="otp-slot-block-label">期間別 推奨価格</div>
                    <div className="otp-slot-grid">
                      {s.slots.map((sl) => {
                        const dir = sl.changePct > 0 ? "up" : sl.changePct < 0 ? "down" : "flat";
                        return (
                          <div key={sl.id} className={`otp-slot-row direction-${dir} demand-${sl.demand} ${sl.wasClamped ? `clamped-${sl.wasClamped}` : ""}`}>
                            <div className="otp-slot-info">
                              <span className="otp-slot-label">
                                {sl.label}
                                <span className={`otp-slot-demand demand-${sl.demand}`}>
                                  {sl.demand === "high" ? "高" : sl.demand === "mid" ? "中" : "低"}
                                </span>
                                {sl.wasClamped && (
                                  <span className={`otp-clamp-pill clamp-${sl.wasClamped}`}>
                                    {sl.wasClamped === "max" ? "上限" : "下限"}
                                  </span>
                                )}
                              </span>
                              <span className="otp-slot-schedule">{sl.schedule}</span>
                            </div>
                            <div className="otp-slot-price-wrap">
                              <div className={`otp-slot-price direction-${dir}`}>
                                {formatYen(sl.suggestedPrice)}
                              </div>
                              <span className={`otp-slot-delta direction-${dir}`}>
                                {sl.changePct >= 0 ? "+" : ""}{sl.changePct}%
                              </span>
                            </div>
                            <button
                              type="button"
                              className="otp-slot-apply"
                              title={`${sl.label}の価格を管理画面に反映`}
                              onClick={() => {
                                onApplySuggestion({
                                  ...s,
                                  basePrice: sl.suggestedPrice,
                                  baseChangePct: sl.changePct,
                                  recommendedLabel: sl.recommendedLabel,
                                });
                                showToast(
                                  `${formatDuration(s.durationMinutes)} / ${sl.label} を管理画面に反映しました。`,
                                  "success"
                                );
                              }}
                            >
                              反映
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="otp-reasons">
                    <div className="otp-reasons-label">根拠</div>
                    <ul className="otp-reasons-list">
                      {s.reasoning.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="otp-impact-grid">
                    <div className="otp-impact-item">
                      <span className="otp-impact-label">月次売上見込み</span>
                      <span className={`otp-impact-value ${s.projectedRevenueDelta >= 0 ? "pos" : "neg"}`}>
                        {s.projectedRevenueDelta >= 0 ? "+" : ""}{formatYen(s.projectedRevenueDelta)}
                      </span>
                    </div>
                    <div className="otp-impact-item">
                      <span className="otp-impact-label">数量変化</span>
                      <span className={`otp-impact-value ${s.projectedVolumeDelta >= 0 ? "pos" : "neg"}`}>
                        {s.projectedVolumeDelta >= 0 ? "+" : ""}{s.projectedVolumeDelta}件
                      </span>
                    </div>
                  </div>

                  <div className="otp-suggest-footer">
                    <span className="otp-apply-label">
                      推奨ベースを {s.recommendedValidFrom}〜 で反映
                    </span>
                    <button
                      type="button"
                      className="otp-apply-btn"
                      onClick={() => {
                        onApplySuggestion(s);
                        showToast(
                          `${formatDuration(s.durationMinutes)} に推奨ベース価格を反映しました。`,
                          "success"
                        );
                      }}
                    >
                      ベース価格を反映
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="otp-mini-empty">
            {loading ? "分析中..." : "提案できるデータがありません。"}
          </div>
        )}
      </section>

      {/* 季節要因 (繁忙期 / 閑散期) */}
      <section className="otp-season-section">
        <h3 className="otp-section-title">季節要因 (繁忙期 / 閑散期)</h3>
        {analysis && analysis.seasonalPeriods.length > 0 ? (
          <div className="otp-season-list">
            {analysis.seasonalPeriods.map((sp) => (
              <div key={sp.id} className={`otp-season-card season-${sp.type}`}>
                <div className="otp-season-head">
                  <div className="otp-season-meta">
                    <span className={`otp-season-pill season-${sp.type}`}>
                      {sp.type === "busy" ? "繁忙期" : sp.type === "quiet" ? "閑散期" : "通常"}
                    </span>
                    <span className="otp-season-name">{sp.label}</span>
                    <span className="otp-season-dates">
                      {sp.dateFrom} 〜 {sp.dateTo}
                    </span>
                  </div>
                  <div className="otp-season-multiplier">
                    <span className="otp-mult-label">推奨倍率</span>
                    <span className={`otp-mult-value season-${sp.type}`}>
                      ×{sp.multiplier.toFixed(2)}
                    </span>
                  </div>
                </div>

                {(() => {
                  const rangedDps = sp.durationPrices.filter((dp) => dp.priceRange);
                  if (rangedDps.length === 0) return null;
                  const anyClamped = rangedDps.some((dp) => dp.wasClamped !== null);
                  // 全 duration が同じレンジを共有していると仮定 (現状 FIT365 1440 のみ)
                  const r = rangedDps[0].priceRange!;
                  return (
                    <div className="otp-season-range-row">
                      <span className="otp-range-pill">
                        許容レンジ ¥{r.min.toLocaleString("ja-JP")} 〜 ¥{r.max.toLocaleString("ja-JP")}
                      </span>
                      {anyClamped && (
                        <span className="otp-clamp-warn">
                          倍率適用で上下限に到達した期間があります
                        </span>
                      )}
                    </div>
                  );
                })()}

                <p className="otp-season-desc">{sp.description}</p>

                <div className="otp-season-stats">
                  <div className="otp-season-stat">
                    <span className="otp-season-stat-label">想定需要変化</span>
                    <span className={`otp-season-stat-value ${sp.expectedDemandPct >= 0 ? "pos" : "neg"}`}>
                      {sp.expectedDemandPct >= 0 ? "+" : ""}{sp.expectedDemandPct}%
                    </span>
                  </div>
                  <div className="otp-season-stat">
                    <span className="otp-season-stat-label">対象期間</span>
                    <span className="otp-season-stat-value plain">
                      {(() => {
                        const from = new Date(sp.dateFrom);
                        const to = new Date(sp.dateTo);
                        return `${Math.round((to.getTime() - from.getTime()) / (86400 * 1000)) + 1}日間`;
                      })()}
                    </span>
                  </div>
                </div>

                <div className="otp-season-prices">
                  <table className="otp-season-table">
                    <thead>
                      <tr>
                        <th>利用時間</th>
                        <th style={{ textAlign: "right" }}>通常価格</th>
                        <th style={{ textAlign: "right" }}>季節価格</th>
                        <th>差分</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sp.durationPrices.map((dp) => {
                        const dir = dp.changePct > 0 ? "up" : dp.changePct < 0 ? "down" : "flat";
                        return (
                          <tr key={dp.durationMinutes}>
                            <td className="otp-season-dur">{formatDuration(dp.durationMinutes)}</td>
                            <td className="otp-season-base">{formatYen(dp.basePrice)}</td>
                            <td className={`otp-season-new direction-${dir}`}>
                              {formatYen(dp.seasonalPrice)}
                              {dp.wasClamped && (
                                <span className={`otp-clamp-pill clamp-${dp.wasClamped}`} style={{ marginLeft: 6 }}>
                                  {dp.wasClamped === "max" ? "上限" : "下限"}
                                </span>
                              )}
                            </td>
                            <td>
                              <span className={`otp-season-delta direction-${dir}`}>
                                {dp.changePct >= 0 ? "+" : ""}{dp.changePct}%
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="otp-slot-apply"
                                onClick={() => {
                                  onApplySeasonal(sp, dp);
                                  showToast(
                                    `${formatDuration(dp.durationMinutes)} に「${sp.label}」価格を反映しました。`,
                                    "success"
                                  );
                                }}
                              >
                                反映
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="otp-season-reasons">
                  <div className="otp-reasons-label">根拠</div>
                  <ul className="otp-reasons-list">
                    {sp.reasoning.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>

                <div className="otp-season-footer">
                  <span className="otp-apply-label">
                    {sp.dateFrom} 〜 {sp.dateTo} で全期間に一括反映
                  </span>
                  <button
                    type="button"
                    className={`otp-season-apply-all season-${sp.type}`}
                    onClick={() => {
                      onApplyAllSeasonal(sp);
                      showToast(
                        `「${sp.label}」の季節価格を全期間に一括反映しました。`,
                        "success"
                      );
                    }}
                  >
                    全期間に一括反映
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="otp-mini-empty">
            {loading ? "分析中..." : "季節要因の情報がありません。"}
          </div>
        )}
      </section>
    </>
  );
}

// --- メインエディタ ---
function OneTimePassEditor({ clubCode, initialTab }: { clubCode: string; initialTab: TabKey }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [store, setStore] = useState<StoreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [durations, setDurations] = useState<DurationPrices[]>([]);
  const [initialDurations, setInitialDurations] = useState<DurationPrices[]>([]);

  const brand = store?.brand ?? "";
  const unitType = deriveUnitType(brand);

  // 店舗 + 設定の取得
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const [storesRes, configRes] = await Promise.all([
          fetch("/api/store-settings/stores"),
          fetch(`/api/store-settings/onetime-pass?clubCode=${clubCode}`),
        ]);

        if (cancelled) return;

        let storeBrand = "";
        if (storesRes.ok) {
          const data = await storesRes.json();
          const matched = (data.stores || []).find((s: StoreSummary) => s.clubCode === clubCode);
          if (matched) {
            setStore(matched);
            storeBrand = matched.brand;
          }
        }

        const allowed = getDurationsForBrand(storeBrand);
        const saved = (await configRes.json().catch(() => ({}))).config as
          | { durations?: DurationPrices[] }
          | null;
        const savedMap = new Map<number, PricePeriod[]>();
        (saved?.durations || []).forEach((d) => savedMap.set(d.durationMinutes, d.periods));

        // 必ず必要な期間枠は揃える (空配列で初期化)
        const built: DurationPrices[] = allowed.map((m) => ({
          durationMinutes: m,
          periods: savedMap.get(m) ?? [],
        }));
        setDurations(built);
        setInitialDurations(built);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [clubCode]);

  const isDirty = useMemo(
    () => JSON.stringify(durations) !== JSON.stringify(initialDurations),
    [durations, initialDurations]
  );

  const validate = (): string | null => {
    for (const d of durations) {
      const range = priceRangeFor(d.durationMinutes);
      for (const p of d.periods) {
        if (!p.validFrom) return `${formatDuration(d.durationMinutes)}: 適用開始日が未入力の期間があります。`;
        if (p.validTo && p.validTo < p.validFrom)
          return `${formatDuration(d.durationMinutes)}: 終了日は開始日以降である必要があります。`;
        if (!Number.isFinite(p.price) || p.price < 0)
          return `${formatDuration(d.durationMinutes)}: 価格は0以上の数値で入力してください。`;
        if (range && (p.price < range.min || p.price > range.max)) {
          return `${formatDuration(d.durationMinutes)}: 価格は ¥${range.min.toLocaleString("ja-JP")} 〜 ¥${range.max.toLocaleString("ja-JP")} の範囲で入力してください。`;
        }
      }
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      showToast(err, "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/store-settings/onetime-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubCode, brand, unitType, durations }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      const savedDurations: DurationPrices[] = data.config?.durations ?? durations;

      // 必須期間枠を補完
      const allowed = getDurationsForBrand(brand);
      const savedMap = new Map<number, PricePeriod[]>();
      savedDurations.forEach((d) => savedMap.set(d.durationMinutes, d.periods));
      const merged = allowed.map((m) => ({
        durationMinutes: m,
        periods: savedMap.get(m) ?? [],
      }));

      setDurations(merged);
      setInitialDurations(merged);
      showToast("価格設定を保存しました。", "success");
    } catch (e) {
      console.error(e);
      showToast("保存に失敗しました。", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleApplySuggestion = useCallback(
    (s: PriceSuggestion) => {
      setDurations((prev) =>
        prev.map((d) =>
          d.durationMinutes === s.durationMinutes
            ? {
                ...d,
                periods: [
                  ...d.periods,
                  {
                    id: uuidv4(),
                    price: s.basePrice,
                    validFrom: s.recommendedValidFrom,
                    validTo: null,
                    label: s.recommendedLabel,
                    note: `ダイナミックプライシング提案 (${s.baseChangePct >= 0 ? "+" : ""}${s.baseChangePct}%)`,
                  },
                ],
              }
            : d
        )
      );
    },
    []
  );

  const handleApplySeasonal = useCallback(
    (period: SeasonalPeriod, dp: SeasonalDurationPrice) => {
      setDurations((prev) =>
        prev.map((d) =>
          d.durationMinutes === dp.durationMinutes
            ? {
                ...d,
                periods: [
                  ...d.periods,
                  {
                    id: uuidv4(),
                    price: dp.seasonalPrice,
                    validFrom: period.dateFrom,
                    validTo: period.dateTo,
                    label: period.label,
                    note: `${period.type === "busy" ? "繁忙期" : period.type === "quiet" ? "閑散期" : "通常"}価格 (${dp.changePct >= 0 ? "+" : ""}${dp.changePct}%)`,
                  },
                ],
              }
            : d
        )
      );
    },
    []
  );

  const handleApplyAllSeasonal = useCallback(
    (period: SeasonalPeriod) => {
      setDurations((prev) =>
        prev.map((d) => {
          const dp = period.durationPrices.find((x) => x.durationMinutes === d.durationMinutes);
          if (!dp) return d;
          return {
            ...d,
            periods: [
              ...d.periods,
              {
                id: uuidv4(),
                price: dp.seasonalPrice,
                validFrom: period.dateFrom,
                validTo: period.dateTo,
                label: period.label,
                note: `${period.type === "busy" ? "繁忙期" : period.type === "quiet" ? "閑散期" : "通常"}価格 (${dp.changePct >= 0 ? "+" : ""}${dp.changePct}%)`,
              },
            ],
          };
        })
      );
    },
    []
  );

  return (
    <div className="otp-root">
      <AdminLoadingOverlay visible={loading || saving} text={saving ? "保存中..." : "読み込み中..."} />

      <header className="otp-header">
        <div className="otp-header-inner">
          <Link href={`/store-settings/basic?clubCode=${clubCode}`} className="otp-back-link">
            <span>←</span>
            <span>メニューへ戻る</span>
          </Link>
          <h1 className="otp-page-title">1dayパス / One Time Pass</h1>
          <div className="otp-header-right">
            {tab === "settings" && (
              <span className="otp-readonly-badge">参照のみ（EnjoyTimePass管理）</span>
            )}
          </div>
        </div>
      </header>

      <main className="otp-main">
        {/* 店舗概要 */}
        <section className="otp-store-card">
          <div className="otp-store-left">
            <span className="otp-store-label">対象店舗</span>
            <div className="otp-store-name-row">
              <span className="otp-store-code">{clubCode}</span>
              <span className="otp-store-name">{store?.clubName ?? "—"}</span>
            </div>
          </div>
          <div className="otp-store-right">
            <span className={`otp-brand-badge ${isJoyfit(brand) ? "joyfit" : "fit365"}`}>
              {brand || "—"}
            </span>
            <span className="otp-unit-badge">
              販売単位: <strong>{unitType === "30min" ? "30分単位" : "1日単位"}</strong>
            </span>
          </div>
        </section>

        {/* タブ */}
        <div className="otp-tabs">
          <button
            type="button"
            className={`otp-tab ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
            管理画面
          </button>
          <button
            type="button"
            className={`otp-tab ${tab === "dashboard" ? "active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            ダッシュボード
          </button>
          <button
            type="button"
            className={`otp-tab ${tab === "pricing" ? "active" : ""}`}
            onClick={() => setTab("pricing")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
            </svg>
            ダイナミックプライシング
          </button>
        </div>

        {tab === "settings" && (
          <SettingsTab
            brand={brand}
            durations={durations}
            setDurations={setDurations}
            readOnly
          />
        )}
        {tab === "dashboard" && <DashboardTab clubCode={clubCode} brand={brand} />}
        {tab === "pricing" && (
          <PricingTab
            clubCode={clubCode}
            brand={brand}
            durations={durations}
            onApplySuggestion={handleApplySuggestion}
            onApplySeasonal={handleApplySeasonal}
            onApplyAllSeasonal={handleApplyAllSeasonal}
          />
        )}
      </main>

      <style jsx global>{`
        .otp-root {
          background: linear-gradient(160deg, #fffbeb 0%, #f8fafc 40%, #fef3c7 100%);
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
          color: #0f172a;
        }
        .otp-header {
          height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(180%);
          border-bottom: 1px solid rgba(226,232,240,0.8); position: sticky; top: 0; z-index: 200;
        }
        .otp-header-inner { max-width: 1280px; margin: 0 auto; padding: 0 24px; height: 100%; display: flex; align-items: center; justify-content: space-between; }
        .otp-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; padding: 6px 12px; border-radius: 8px; transition: 0.15s; display: flex; align-items: center; gap: 6px; }
        .otp-back-link:hover { background: #f1f5f9; color: #334155; }
        .otp-page-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; }
        .otp-header-right { display: flex; align-items: center; gap: 12px; min-width: 80px; justify-content: flex-end; }
        .otp-unsaved { font-size: 11px; font-weight: 700; color: #b45309; background: #fef3c7; padding: 4px 10px; border-radius: 99px; }
        .otp-readonly-badge { font-size: 11px; font-weight: 700; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; padding: 5px 12px; border-radius: 99px; }
        .otp-input:disabled { background: #f8fafc; color: #334155; cursor: default; -webkit-text-fill-color: #334155; opacity: 1; }
        .otp-save-btn { padding: 8px 22px; border-radius: 10px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; border: none; cursor: pointer; box-shadow: 0 2px 6px rgba(245,158,11,0.35); transition: 0.15s; }
        .otp-save-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
        .otp-save-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245,158,11,0.45); }

        .otp-main { max-width: 1280px; margin: 0 auto; padding: 24px 24px 80px; }

        .otp-store-card {
          background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
          padding: 18px 24px; display: flex; justify-content: space-between; align-items: center;
          gap: 16px; flex-wrap: wrap; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .otp-store-left { display: flex; flex-direction: column; gap: 6px; }
        .otp-store-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .otp-store-name-row { display: flex; align-items: center; gap: 10px; }
        .otp-store-code { background: #1e293b; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-family: "SF Mono", monospace; font-weight: 700; }
        .otp-store-name { font-size: 16px; font-weight: 700; color: #1e293b; }
        .otp-store-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .otp-brand-badge { font-size: 12px; font-weight: 800; padding: 6px 14px; border-radius: 99px; border: 1.5px solid; }
        .otp-brand-badge.fit365 { color: #be185d; border-color: #f9a8d4; background: #fdf2f8; }
        .otp-brand-badge.joyfit { color: #1d4ed8; border-color: #93c5fd; background: #eff6ff; }
        .otp-unit-badge { font-size: 12px; font-weight: 600; color: #475569; background: #f1f5f9; padding: 6px 12px; border-radius: 99px; }
        .otp-unit-badge strong { color: #b45309; font-weight: 800; }

        /* タブ */
        .otp-tabs { display: flex; gap: 4px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px; margin-bottom: 20px; width: fit-content; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .otp-tab { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 9px; font-size: 13px; font-weight: 700; background: transparent; color: #64748b; border: none; cursor: pointer; transition: 0.15s; }
        .otp-tab:hover { color: #1e293b; background: #f8fafc; }
        .otp-tab.active { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; box-shadow: 0 2px 6px rgba(245,158,11,0.3); }
        .otp-tab.active:hover { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; }

        /* 情報カード */
        .otp-info-card {
          background: #fff; border: 1px solid #fde68a; border-left: 4px solid #f59e0b;
          border-radius: 14px; padding: 16px 20px; display: flex; gap: 14px; align-items: flex-start;
          margin-bottom: 24px;
        }
        .otp-info-icon { color: #f59e0b; flex-shrink: 0; padding-top: 2px; }
        .otp-info-title { margin: 0 0 6px 0; font-size: 14px; font-weight: 700; color: #1e293b; }
        .otp-info-desc { margin: 0; font-size: 13px; color: #64748b; line-height: 1.7; }

        /* 期間カード */
        .otp-duration-list { display: flex; flex-direction: column; gap: 18px; }
        .otp-duration-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .otp-duration-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
        .otp-duration-title { display: flex; align-items: center; gap: 14px; }
        .otp-duration-label { font-size: 18px; font-weight: 800; color: #1e293b; background: linear-gradient(135deg, #fef3c7, #fde68a); padding: 6px 14px; border-radius: 8px; min-width: 70px; text-align: center; }
        .otp-duration-current { font-size: 13px; font-weight: 600; color: #475569; }
        .otp-duration-current strong { color: #0f172a; font-size: 15px; font-weight: 800; margin-left: 4px; }
        .otp-duration-current.empty { color: #94a3b8; font-style: italic; }
        .otp-duration-range { font-size: 11px; font-weight: 700; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; padding: 3px 9px; border-radius: 99px; }
        .otp-price-input.out-of-range { border-color: #ef4444; background: #fef2f2; }
        .otp-price-input.out-of-range:focus { border-color: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,0.12); }
        .otp-range-warn { font-size: 10px; font-weight: 700; color: #b91c1c; margin-top: 2px; }

        .otp-add-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 9px; font-size: 12px; font-weight: 700; background: #fff7ed; color: #c2410c; border: 1.5px solid #fed7aa; cursor: pointer; transition: 0.15s; }
        .otp-add-btn:hover { background: #ffedd5; border-color: #fdba74; }
        .otp-add-icon { font-size: 15px; font-weight: 800; line-height: 1; }

        .otp-empty-inline { font-size: 13px; color: #94a3b8; padding: 16px; background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 10px; text-align: center; }

        .otp-period-list { display: flex; flex-direction: column; gap: 10px; }
        .otp-period-row {
          display: grid;
          grid-template-columns: 80px 1fr 1fr 1fr 1fr 60px;
          gap: 12px;
          align-items: end;
          padding: 12px 14px;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          background: #fff;
        }
        .otp-period-row.status-current { border-color: #86efac; background: #f0fdf4; }
        .otp-period-row.status-upcoming { border-color: #fcd34d; background: #fffbeb; }
        .otp-period-row.status-expired { border-color: #e2e8f0; background: #f8fafc; opacity: 0.85; }

        @media (max-width: 900px) {
          .otp-period-row { grid-template-columns: 1fr 1fr; }
        }

        .otp-status-pill { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; text-align: center; align-self: center; }
        .otp-status-pill.status-current { background: #d1fae5; color: #047857; }
        .otp-status-pill.status-upcoming { background: #fef3c7; color: #b45309; }
        .otp-status-pill.status-expired { background: #e2e8f0; color: #64748b; }

        .otp-field { display: flex; flex-direction: column; gap: 4px; }
        .otp-label { font-size: 11px; font-weight: 700; color: #475569; }
        .otp-input { width: 100%; padding: 7px 10px; border: 1.5px solid #e2e8f0; border-radius: 7px; font-size: 13px; background: #fff; outline: none; transition: 0.15s; font-family: inherit; }
        .otp-input:focus { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,0.08); }
        .otp-price-wrap { position: relative; display: flex; align-items: center; }
        .otp-price-prefix { position: absolute; left: 10px; font-size: 13px; font-weight: 700; color: #64748b; pointer-events: none; }
        .otp-price-input { padding-left: 24px; font-variant-numeric: tabular-nums; font-weight: 600; }
        .otp-remove-btn { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 6px 10px; border-radius: 7px; font-size: 11px; font-weight: 700; cursor: pointer; transition: 0.15s; align-self: end; }
        .otp-remove-btn:hover { background: #fee2e2; }

        /* ダッシュボード: サマリー */
        .otp-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .otp-summary-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; display: flex; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .otp-summary-bar { width: 4px; }
        .otp-summary-body { padding: 18px 20px; flex: 1; }
        .otp-summary-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .otp-summary-value { font-size: 26px; font-weight: 800; color: #0f172a; line-height: 1.2; font-variant-numeric: tabular-nums; }
        .otp-summary-sub { font-size: 12px; font-weight: 600; color: #64748b; margin-top: 4px; }

        /* ダッシュボード: 内訳 */
        .otp-breakdown-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 24px; }
        @media (max-width: 900px) { .otp-breakdown-grid { grid-template-columns: 1fr; } }
        .otp-breakdown-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .otp-breakdown-title { margin: 0 0 16px 0; font-size: 14px; font-weight: 800; color: #1e293b; }
        .otp-breakdown-list { display: flex; flex-direction: column; gap: 10px; }
        .otp-bar-row { display: grid; grid-template-columns: 60px 1fr 140px; gap: 12px; align-items: center; font-size: 12px; }
        .otp-bar-label { font-weight: 700; color: #475569; }
        .otp-bar-track { height: 8px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .otp-bar-fill { height: 100%; background: linear-gradient(90deg, #fbbf24, #d97706); border-radius: 99px; transition: width 0.3s; }
        .otp-bar-value { font-weight: 600; color: #1e293b; text-align: right; font-variant-numeric: tabular-nums; }
        .otp-status-list { display: flex; flex-direction: column; gap: 8px; }
        .otp-status-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 4px; }
        .otp-status-chip { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }
        .otp-status-count { font-size: 13px; font-weight: 700; color: #1e293b; }
        .otp-mini-empty { font-size: 12px; color: #94a3b8; padding: 16px; text-align: center; }

        /* ダッシュボード: リスト */
        .otp-list-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .otp-list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
        .otp-list-title { margin: 0; font-size: 16px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 10px; }
        .otp-count { background: #f1f5f9; color: #64748b; font-size: 12px; padding: 2px 10px; border-radius: 99px; font-weight: 700; }
        .otp-list-actions { display: flex; align-items: center; gap: 10px; }
        .otp-demo-badge { font-size: 11px; font-weight: 700; color: #1d4ed8; background: #eff6ff; border: 1px solid #93c5fd; padding: 4px 10px; border-radius: 99px; }
        .otp-demo-btn { background: #f8fafc; border: 1.5px solid #e2e8f0; color: #475569; padding: 7px 14px; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; transition: 0.15s; }
        .otp-demo-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }

        .otp-filters { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .otp-search { flex: 1; min-width: 240px; padding: 9px 14px; border: 1.5px solid #e2e8f0; border-radius: 9px; font-size: 13px; outline: none; transition: 0.15s; }
        .otp-search:focus { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,0.08); }
        .otp-select { padding: 9px 14px; border: 1.5px solid #e2e8f0; border-radius: 9px; font-size: 13px; font-weight: 600; background: #fff; color: #475569; outline: none; cursor: pointer; min-width: 140px; }
        .otp-select:focus { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,0.08); }

        .otp-empty { text-align: center; padding: 40px 20px; }
        .otp-empty-text { font-size: 14px; color: #94a3b8; margin-bottom: 16px; }
        .otp-empty-btn { background: #fff7ed; border: 1.5px solid #fed7aa; color: #c2410c; padding: 10px 22px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; transition: 0.15s; }
        .otp-empty-btn:hover { background: #ffedd5; }

        .otp-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
        .otp-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 1000px; }
        .otp-table th { background: #f8fafc; text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
        .otp-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .otp-table tr:last-child td { border-bottom: none; }
        .otp-table tbody tr:hover { background: #f8fafc; }
        .otp-name-cell { font-weight: 700; color: #1e293b; }
        .otp-contact { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: #64748b; }
        .otp-phone { color: #475569; }
        .otp-mcode { background: #f1f5f9; padding: 3px 7px; border-radius: 5px; font-size: 11px; font-family: "SF Mono", monospace; color: #475569; font-weight: 600; }
        .otp-na { color: #cbd5e1; }
        .otp-dur-cell { font-weight: 700; color: #b45309; white-space: nowrap; }
        .otp-price-cell { font-weight: 700; color: #1e293b; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .otp-date-cell { font-size: 12px; color: #475569; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .otp-pay-cell { font-size: 12px; color: #475569; white-space: nowrap; }

        /* プライシング: 共通 */
        .otp-section-title { margin: 0 0 14px 0; font-size: 14px; font-weight: 800; color: #1e293b; }

        /* インサイト */
        .otp-insight-card { background: linear-gradient(135deg, #fffbeb, #fef3c7); border: 1px solid #fde68a; border-radius: 14px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .otp-insight-header { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px; }
        .otp-insight-icon { width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .otp-insight-title { margin: 0 0 4px 0; font-size: 15px; font-weight: 800; color: #92400e; }
        .otp-insight-sub { margin: 0; font-size: 12px; color: #b45309; }
        .otp-insight-list { margin: 0; padding-left: 22px; color: #1e293b; font-size: 13px; line-height: 1.9; }
        .otp-insight-list li { padding: 2px 0; }

        /* 価格根拠サブセクション */
        .otp-factors-block, .otp-examples-block { margin-top: 20px; padding-top: 18px; border-top: 1px dashed #fde68a; }
        .otp-rationale-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
        .otp-rationale-icon { font-size: 18px; }
        .otp-rationale-heading { font-size: 14px; font-weight: 800; color: #92400e; }
        .otp-rationale-sub { font-size: 12px; color: #b45309; font-weight: 600; }

        /* 要因グリッド */
        .otp-factors-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
        .otp-factor-card { background: #fff; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); }
        .otp-factor-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
        .otp-factor-label { font-size: 13px; font-weight: 800; color: #1e293b; }
        .otp-factor-range { font-size: 11px; font-weight: 700; color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 99px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .otp-factor-desc { margin: 0 0 6px 0; font-size: 12px; color: #475569; line-height: 1.55; }
        .otp-factor-example { margin: 0; font-size: 11px; color: #64748b; background: #f8fafc; padding: 6px 10px; border-radius: 6px; line-height: 1.5; }
        .otp-factor-example-label { font-weight: 700; color: #b45309; margin-right: 4px; }

        /* 計算例 */
        .otp-examples-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; }
        .otp-example-card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); position: relative; overflow: hidden; }
        .otp-example-card.direction-up { border-color: #86efac; }
        .otp-example-card.direction-up::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #10b981, #047857); }
        .otp-example-card.direction-down { border-color: #fca5a5; }
        .otp-example-card.direction-down::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #ef4444, #b91c1c); }
        .otp-example-card.direction-flat { border-color: #cbd5e1; }

        .otp-example-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding-bottom: 10px; padding-left: 8px; border-bottom: 1px dashed #e2e8f0; flex-wrap: wrap; }
        .otp-example-dur { font-size: 14px; font-weight: 800; color: #b45309; background: #fef3c7; padding: 4px 10px; border-radius: 6px; min-width: 56px; text-align: center; }
        .otp-example-slot { font-size: 13px; font-weight: 700; color: #1e293b; }
        .otp-example-total { font-size: 12px; font-weight: 700; margin-left: auto; font-variant-numeric: tabular-nums; }
        .otp-example-total.direction-up { color: #047857; }
        .otp-example-total.direction-down { color: #b91c1c; }
        .otp-example-total.direction-flat { color: #1e293b; }
        .otp-example-pct { margin-left: 4px; font-weight: 800; }

        .otp-steps-list { list-style: none; padding: 0 0 0 8px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .otp-step { display: grid; grid-template-columns: 32px 1fr; gap: 10px; align-items: center; padding: 6px 0; position: relative; }
        .otp-step:not(:last-child)::after {
          content: "";
          position: absolute;
          left: 23px; top: 100%;
          width: 2px; height: 8px;
          background: #cbd5e1;
        }
        .otp-step-marker { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #fff; }
        .otp-step-marker.op-mul { background: linear-gradient(135deg, #fbbf24, #d97706); }
        .otp-step-marker.op-add { background: linear-gradient(135deg, #34d399, #10b981); }
        .otp-step-marker.op-op { background: linear-gradient(135deg, #94a3b8, #64748b); }
        .otp-step-marker.final { background: linear-gradient(135deg, #1e293b, #0f172a); font-size: 9px; }
        .otp-step-start .otp-step-marker { background: #f1f5f9; color: #64748b; font-size: 9px; }
        .otp-step-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .otp-step-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #1e293b; flex-wrap: wrap; }
        .otp-step-factor { font-size: 11px; font-weight: 800; color: #b45309; background: #fef3c7; padding: 1px 8px; border-radius: 99px; font-variant-numeric: tabular-nums; }
        .otp-step-detail { font-size: 11px; color: #64748b; }
        .otp-step-price { font-size: 12px; color: #475569; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 6px; }
        .otp-step-before { color: #94a3b8; }
        .otp-step-arrow { color: #cbd5e1; }
        .otp-step-after { color: #1e293b; font-weight: 700; }
        .otp-step-price-final { font-size: 18px; font-weight: 800; color: #047857; font-variant-numeric: tabular-nums; }
        .otp-step-final.direction-down .otp-step-price-final { color: #b91c1c; }
        .otp-step-final.direction-flat .otp-step-price-final { color: #1e293b; }
        .otp-example-note { margin: 12px 8px 0 8px; padding: 8px 12px; background: #f8fafc; border-left: 3px solid #cbd5e1; border-radius: 4px; font-size: 12px; color: #475569; line-height: 1.5; }

        /* チャート */
        .otp-pricing-charts { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 20px; }
        @media (max-width: 900px) { .otp-pricing-charts { grid-template-columns: 1fr; } }
        .otp-chart-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }

        .otp-hourly-chart { display: flex; align-items: flex-end; gap: 3px; height: 160px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
        .otp-hourly-bar { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
        .otp-hourly-fill { width: 100%; background: linear-gradient(180deg, #fcd34d, #f59e0b); min-height: 2px; border-radius: 3px 3px 0 0; transition: opacity 0.15s; }
        .otp-hourly-fill:hover { opacity: 0.75; }
        .otp-hourly-label { font-size: 9px; color: #94a3b8; font-weight: 600; height: 12px; }

        .otp-dow-chart { display: flex; flex-direction: column; gap: 8px; }
        .otp-dow-row { display: grid; grid-template-columns: 28px 1fr 60px; gap: 10px; align-items: center; font-size: 12px; }
        .otp-dow-label { font-weight: 800; color: #1e293b; text-align: center; }
        .otp-dow-label.sun { color: #dc2626; }
        .otp-dow-label.sat { color: #2563eb; }
        .otp-dow-track { height: 12px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .otp-dow-fill { height: 100%; background: linear-gradient(90deg, #fcd34d, #f59e0b); border-radius: 99px; transition: width 0.3s; }
        .otp-dow-value { font-weight: 600; color: #475569; text-align: right; font-variant-numeric: tabular-nums; }

        /* 需要分析 */
        .otp-demand-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; }
        .otp-occ-wrap { display: flex; align-items: center; gap: 8px; min-width: 110px; }
        .otp-occ-track { flex: 1; height: 8px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .otp-occ-fill { height: 100%; border-radius: 99px; transition: width 0.3s; }
        .otp-occ-fill.high { background: linear-gradient(90deg, #34d399, #10b981); }
        .otp-occ-fill.mid { background: linear-gradient(90deg, #fcd34d, #f59e0b); }
        .otp-occ-fill.low { background: linear-gradient(90deg, #fca5a5, #ef4444); }
        .otp-occ-text { font-size: 12px; font-weight: 700; color: #1e293b; font-variant-numeric: tabular-nums; min-width: 36px; }
        .otp-trend-pill { font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: 99px; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .otp-trend-pill.trend-up { background: #d1fae5; color: #047857; }
        .otp-trend-pill.trend-down { background: #fee2e2; color: #b91c1c; }
        .otp-trend-pill.trend-flat { background: #e2e8f0; color: #475569; }

        /* 価格提案カード */
        .otp-suggest-section { margin-bottom: 20px; }
        .otp-suggest-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(440px, 1fr)); gap: 16px; }
        @media (max-width: 540px) { .otp-suggest-grid { grid-template-columns: 1fr; } }
        .otp-suggest-card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); position: relative; overflow: hidden; transition: 0.15s; }
        .otp-suggest-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06); transform: translateY(-1px); }
        .otp-suggest-card.direction-up { border-color: #6ee7b7; }
        .otp-suggest-card.direction-up::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #10b981, #047857); }
        .otp-suggest-card.direction-down { border-color: #fca5a5; }
        .otp-suggest-card.direction-down::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #ef4444, #b91c1c); }
        .otp-suggest-card.direction-flat { border-color: #cbd5e1; }
        .otp-suggest-card.direction-flat::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #94a3b8, #64748b); }
        .otp-suggest-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; padding-left: 8px; }
        .otp-suggest-duration { font-size: 17px; font-weight: 800; color: #1e293b; background: linear-gradient(135deg, #fef3c7, #fde68a); padding: 5px 14px; border-radius: 8px; min-width: 80px; text-align: center; }
        .otp-conf-pill { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }
        .otp-conf-pill.conf-high { background: #d1fae5; color: #047857; }
        .otp-conf-pill.conf-medium { background: #fef3c7; color: #b45309; }
        .otp-conf-pill.conf-low { background: #f1f5f9; color: #64748b; }

        /* レンジ表示 + クランプバッジ */
        .otp-suggest-head-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .otp-range-pill { font-size: 11px; font-weight: 700; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; padding: 3px 10px; border-radius: 99px; white-space: nowrap; }
        .otp-clamp-pill { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 99px; white-space: nowrap; line-height: 1.5; }
        .otp-clamp-pill.clamp-max { background: linear-gradient(135deg, #fee2e2, #fecaca); color: #b91c1c; border: 1px solid #f87171; }
        .otp-clamp-pill.clamp-min { background: linear-gradient(135deg, #dbeafe, #bfdbfe); color: #1d4ed8; border: 1px solid #60a5fa; }
        .otp-slot-row.clamped-max { border-left: 3px solid #ef4444; }
        .otp-slot-row.clamped-min { border-left: 3px solid #3b82f6; }
        .otp-season-range-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 8px 0 8px; margin-bottom: 8px; }
        .otp-clamp-warn { font-size: 11px; color: #b91c1c; font-weight: 700; background: #fee2e2; padding: 3px 10px; border-radius: 99px; }

        .otp-base-compare { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; padding: 12px; background: #f8fafc; border-radius: 10px; margin-bottom: 14px; }
        .otp-base-col { display: flex; flex-direction: column; gap: 4px; align-items: center; }
        .otp-base-col.suggested { background: #fff; border: 1.5px solid #fde68a; border-radius: 8px; padding: 6px 8px; }
        .otp-base-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; }
        .otp-base-now { font-size: 16px; font-weight: 800; color: #64748b; font-variant-numeric: tabular-nums; text-decoration: line-through; text-decoration-color: #cbd5e1; }
        .otp-base-new { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .otp-base-new.direction-up { color: #047857; }
        .otp-base-new.direction-down { color: #b91c1c; }
        .otp-base-new.direction-flat { color: #1e293b; }
        .otp-base-arrow { font-size: 18px; font-weight: 800; display: flex; flex-direction: column; align-items: center; gap: 2px; line-height: 1; }
        .otp-base-arrow.direction-up { color: #10b981; }
        .otp-base-arrow.direction-down { color: #ef4444; }
        .otp-base-arrow.direction-flat { color: #94a3b8; }
        .otp-base-delta { font-size: 11px; font-weight: 700; }

        /* 期間別スロット */
        .otp-slot-block { margin: 0 0 14px 0; padding: 0 8px; }
        .otp-slot-block-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px; }
        .otp-slot-grid { display: flex; flex-direction: column; gap: 6px; }
        .otp-slot-row { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; transition: 0.15s; }
        .otp-slot-row.demand-high { border-color: #fcd34d; background: #fffbeb; }
        .otp-slot-row.demand-low { border-color: #cbd5e1; background: #f8fafc; }
        .otp-slot-row:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
        .otp-slot-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .otp-slot-label { font-size: 12px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 6px; }
        .otp-slot-demand { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 99px; line-height: 1.4; }
        .otp-slot-demand.demand-high { background: #fee2e2; color: #b91c1c; }
        .otp-slot-demand.demand-mid { background: #e2e8f0; color: #475569; }
        .otp-slot-demand.demand-low { background: #dbeafe; color: #1d4ed8; }
        .otp-slot-schedule { font-size: 10px; color: #64748b; font-weight: 500; }
        .otp-slot-price-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .otp-slot-price { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; }
        .otp-slot-price.direction-up { color: #047857; }
        .otp-slot-price.direction-down { color: #b91c1c; }
        .otp-slot-price.direction-flat { color: #1e293b; }
        .otp-slot-delta { font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .otp-slot-delta.direction-up { color: #10b981; }
        .otp-slot-delta.direction-down { color: #ef4444; }
        .otp-slot-delta.direction-flat { color: #94a3b8; }
        .otp-slot-apply { background: #fff; border: 1px solid #e2e8f0; color: #64748b; padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; transition: 0.15s; }
        .otp-slot-apply:hover { background: #f59e0b; border-color: #f59e0b; color: #fff; }

        .otp-reasons { padding-left: 8px; margin-bottom: 14px; }
        .otp-reasons-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px; }
        .otp-reasons-list { margin: 0; padding-left: 18px; font-size: 12px; color: #475569; line-height: 1.7; }
        .otp-reasons-list li { padding: 1px 0; }

        .otp-impact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; padding-left: 8px; }
        .otp-impact-item { background: #f8fafc; border-radius: 8px; padding: 8px 10px; }
        .otp-impact-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 2px; display: block; }
        .otp-impact-value { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .otp-impact-value.pos { color: #047857; }
        .otp-impact-value.neg { color: #b91c1c; }

        .otp-suggest-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 8px 0 8px; border-top: 1px dashed #e2e8f0; flex-wrap: wrap; }
        .otp-apply-label { font-size: 11px; color: #64748b; font-weight: 600; }
        .otp-apply-btn { padding: 7px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; border: none; cursor: pointer; box-shadow: 0 2px 6px rgba(245,158,11,0.3); transition: 0.15s; }
        .otp-apply-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(245,158,11,0.4); }

        /* 季節要因 */
        .otp-season-section { margin-bottom: 20px; }
        .otp-season-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 16px; }
        @media (max-width: 560px) { .otp-season-list { grid-template-columns: 1fr; } }
        .otp-season-card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); position: relative; overflow: hidden; transition: 0.15s; }
        .otp-season-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06); transform: translateY(-1px); }
        .otp-season-card.season-busy { border-color: #fca5a5; }
        .otp-season-card.season-busy::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #ef4444, #b91c1c); }
        .otp-season-card.season-quiet { border-color: #93c5fd; }
        .otp-season-card.season-quiet::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #3b82f6, #1d4ed8); }
        .otp-season-card.season-normal { border-color: #cbd5e1; }

        .otp-season-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; padding-left: 8px; flex-wrap: wrap; }
        .otp-season-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .otp-season-pill { font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 99px; }
        .otp-season-pill.season-busy { background: #fee2e2; color: #b91c1c; }
        .otp-season-pill.season-quiet { background: #dbeafe; color: #1d4ed8; }
        .otp-season-pill.season-normal { background: #e2e8f0; color: #475569; }
        .otp-season-name { font-size: 17px; font-weight: 800; color: #1e293b; }
        .otp-season-dates { font-size: 12px; font-weight: 600; color: #64748b; background: #f8fafc; padding: 4px 10px; border-radius: 6px; font-variant-numeric: tabular-nums; }

        .otp-season-multiplier { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .otp-mult-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; }
        .otp-mult-value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; }
        .otp-mult-value.season-busy { color: #b91c1c; }
        .otp-mult-value.season-quiet { color: #1d4ed8; }
        .otp-mult-value.season-normal { color: #475569; }

        .otp-season-desc { font-size: 12px; color: #475569; line-height: 1.6; margin: 0 0 12px 8px; }

        .otp-season-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; padding-left: 8px; }
        .otp-season-stat { background: #f8fafc; border-radius: 8px; padding: 8px 12px; }
        .otp-season-stat-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; display: block; margin-bottom: 2px; }
        .otp-season-stat-value { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .otp-season-stat-value.pos { color: #047857; }
        .otp-season-stat-value.neg { color: #b91c1c; }
        .otp-season-stat-value.plain { color: #1e293b; }

        .otp-season-prices { margin: 0 0 14px 8px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
        .otp-season-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .otp-season-table th { background: #f8fafc; padding: 8px 12px; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #e2e8f0; }
        .otp-season-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .otp-season-table tr:last-child td { border-bottom: none; }
        .otp-season-dur { font-weight: 800; color: #b45309; white-space: nowrap; }
        .otp-season-base { text-align: right; font-variant-numeric: tabular-nums; color: #64748b; text-decoration: line-through; text-decoration-color: #cbd5e1; white-space: nowrap; }
        .otp-season-new { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .otp-season-new.direction-up { color: #047857; }
        .otp-season-new.direction-down { color: #b91c1c; }
        .otp-season-new.direction-flat { color: #1e293b; }
        .otp-season-delta { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 99px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .otp-season-delta.direction-up { background: #d1fae5; color: #047857; }
        .otp-season-delta.direction-down { background: #fee2e2; color: #b91c1c; }
        .otp-season-delta.direction-flat { background: #e2e8f0; color: #64748b; }

        .otp-season-reasons { padding-left: 8px; margin-bottom: 14px; }

        .otp-season-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 8px 0 8px; border-top: 1px dashed #e2e8f0; flex-wrap: wrap; }
        .otp-season-apply-all { padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 700; color: #fff; border: none; cursor: pointer; transition: 0.15s; }
        .otp-season-apply-all.season-busy { background: linear-gradient(135deg, #ef4444, #b91c1c); box-shadow: 0 2px 6px rgba(239,68,68,0.3); }
        .otp-season-apply-all.season-busy:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(239,68,68,0.4); }
        .otp-season-apply-all.season-quiet { background: linear-gradient(135deg, #3b82f6, #1d4ed8); box-shadow: 0 2px 6px rgba(59,130,246,0.3); }
        .otp-season-apply-all.season-quiet:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(59,130,246,0.4); }
        .otp-season-apply-all.season-normal { background: linear-gradient(135deg, #64748b, #475569); }

        /* === ダッシュボード v2: 期間フィルター === */
        /* AI売上分析カード */
        .otp-ai-card { background: linear-gradient(160deg, #faf5ff 0%, #fff 60%); border: 1px solid #e9d5ff; border-radius: 16px; padding: 20px 22px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); }
        .otp-ai-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .otp-ai-title { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 800; color: #1e293b; }
        .otp-ai-badge { font-size: 11px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #a855f7, #7c3aed); padding: 3px 9px; border-radius: 6px; letter-spacing: 0.05em; }
        .otp-ai-month { font-size: 11px; font-weight: 700; color: #7c3aed; background: #f3e8ff; padding: 3px 10px; border-radius: 99px; }
        .otp-ai-btn { padding: 8px 18px; border-radius: 10px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, #a855f7, #7c3aed); color: #fff; border: none; cursor: pointer; box-shadow: 0 2px 6px rgba(124,58,237,0.3); transition: 0.15s; }
        .otp-ai-btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
        .otp-ai-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124,58,237,0.4); }
        .otp-ai-empty { font-size: 13px; color: #64748b; margin-top: 14px; line-height: 1.7; }
        .otp-ai-err { font-size: 12px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; margin-top: 12px; }
        .otp-ai-md { margin-top: 14px; }
        .otp-ai-h { font-size: 13px; font-weight: 800; color: #7c3aed; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #f1e8fc; }
        .otp-ai-p { font-size: 13px; color: #334155; line-height: 1.75; margin: 4px 0; }
        .otp-ai-li { font-size: 13px; color: #334155; line-height: 1.7; margin: 4px 0 4px 8px; }
        .otp-ai-md strong { color: #0f172a; font-weight: 800; }
        .otp-fc-wrap { margin-top: 16px; padding: 14px; background: #fff; border: 1px solid #f1e8fc; border-radius: 12px; }
        .otp-fc-legend { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
        .otp-fc-lg { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #64748b; }
        .otp-fc-swatch { width: 14px; height: 8px; border-radius: 2px; display: inline-block; }
        .otp-fc-swatch.bar { background: #fcd34d; }
        .otp-fc-swatch.ma { background: repeating-linear-gradient(90deg, #64748b 0 4px, transparent 4px 7px); height: 2px; }
        .otp-fc-swatch.fc { background: rgba(168,85,247,0.5); }
        .otp-fc-trend { margin-left: auto; font-size: 11px; font-weight: 700; color: #7c3aed; background: #f3e8ff; padding: 3px 10px; border-radius: 99px; }
        .otp-fc-svg { width: 100%; height: auto; display: block; }
        .otp-fc-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
        .otp-fc-fcard { background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px; padding: 10px 12px; text-align: center; }
        .otp-fc-fym { font-size: 11px; font-weight: 700; color: #7c3aed; }
        .otp-fc-fsales { font-size: 17px; font-weight: 800; color: #6d28d9; margin: 3px 0; font-variant-numeric: tabular-nums; }
        .otp-fc-frange { font-size: 10px; color: #94a3b8; }
        @media (max-width: 640px) { .otp-fc-cards { grid-template-columns: 1fr; } }

        .otp-range-bar { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 20px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
        .otp-range-left { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .otp-range-right { display: flex; align-items: center; gap: 10px; }
        .otp-range-label { font-size: 12px; font-weight: 800; color: #1e293b; }
        .otp-range-presets { display: flex; gap: 4px; flex-wrap: wrap; padding: 2px; background: #f1f5f9; border-radius: 10px; }
        .otp-range-preset { padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; background: transparent; color: #64748b; border: none; cursor: pointer; transition: 0.15s; }
        .otp-range-preset:hover { color: #1e293b; }
        .otp-range-preset.active { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; box-shadow: 0 2px 4px rgba(245,158,11,0.3); }
        .otp-range-dates { display: flex; align-items: center; gap: 6px; }
        .otp-range-date { width: 130px !important; padding: 6px 10px !important; font-size: 12px !important; }
        .otp-range-sep { color: #94a3b8; font-weight: 700; }
        .otp-range-days { font-size: 11px; font-weight: 700; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; padding: 4px 10px; border-radius: 99px; }

        /* === ダッシュボード v2: デモグラ === */
        .otp-demo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
        .otp-demo-grid-wide { grid-template-columns: 2fr 1fr; }
        @media (max-width: 900px) { .otp-demo-grid, .otp-demo-grid-wide { grid-template-columns: 1fr; } }
        .otp-demo-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }

        /* 性別 */
        .otp-gender-bar { display: flex; height: 12px; border-radius: 99px; overflow: hidden; background: #f1f5f9; margin-bottom: 16px; }
        .otp-gender-seg { transition: width 0.3s; }
        .otp-gender-list { display: flex; flex-direction: column; gap: 8px; }
        .otp-gender-row { display: grid; grid-template-columns: 16px 70px 1fr auto; gap: 10px; align-items: center; font-size: 13px; }
        .otp-gender-dot { width: 12px; height: 12px; border-radius: 4px; }
        .otp-gender-label { font-weight: 700; color: #1e293b; }
        .otp-gender-count { color: #64748b; font-size: 12px; font-variant-numeric: tabular-nums; }
        .otp-gender-sales { font-weight: 700; color: #0f172a; text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; }

        /* 年代 */
        .otp-age-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; height: 180px; align-items: end; padding: 8px 4px; }
        .otp-age-col { display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
        .otp-age-bar-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; width: 100%; justify-content: flex-end; }
        .otp-age-count { font-size: 11px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
        .otp-age-bar { width: 100%; min-height: 4px; border-radius: 4px 4px 0 0; transition: height 0.3s, opacity 0.15s; }
        .otp-age-bar:hover { opacity: 0.8; }
        .otp-age-label { font-size: 11px; font-weight: 700; color: #1e293b; }
        .otp-age-sub { font-size: 9px; color: #94a3b8; font-weight: 600; }
        .otp-age-sales { font-size: 10px; color: #64748b; font-weight: 700; font-variant-numeric: tabular-nums; }

        /* 時間帯 */
        .otp-hour-chart { display: flex; align-items: flex-end; gap: 3px; height: 140px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
        .otp-hour-bar { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; cursor: pointer; }
        .otp-hour-fill { width: 100%; background: linear-gradient(180deg, #60a5fa, #2563eb); min-height: 2px; border-radius: 3px 3px 0 0; transition: opacity 0.15s; }
        .otp-hour-bar:hover .otp-hour-fill { opacity: 0.75; }
        .otp-hour-label { font-size: 9px; color: #94a3b8; font-weight: 700; height: 12px; }

        /* 曜日 (v2) */
        .otp-dow-chart-v2 { display: flex; flex-direction: column; gap: 8px; }
        .otp-dow-row-v2 { display: grid; grid-template-columns: 28px 1fr 60px; gap: 10px; align-items: center; font-size: 12px; }
        .otp-dow-day { font-weight: 800; color: #1e293b; text-align: center; }
        .otp-dow-day.sun { color: #dc2626; }
        .otp-dow-day.sat { color: #2563eb; }
        .otp-dow-track-v2 { height: 12px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .otp-dow-fill-v2 { height: 100%; background: linear-gradient(90deg, #34d399, #10b981); border-radius: 99px; transition: width 0.3s; }
        .otp-dow-val { font-weight: 700; color: #475569; text-align: right; font-variant-numeric: tabular-nums; }

        /* 新規 vs リピーター */
        .otp-newrep { display: grid; grid-template-columns: 140px 1fr; gap: 20px; align-items: center; }
        .otp-newrep-donut { width: 140px; height: 140px; }
        .otp-donut { width: 100%; height: 100%; }
        .otp-donut-num { font-size: 7px; font-weight: 800; fill: #0f172a; }
        .otp-donut-sub { font-size: 3.5px; fill: #64748b; font-weight: 600; }
        .otp-newrep-stats { display: flex; flex-direction: column; gap: 10px; }
        .otp-newrep-row { display: grid; grid-template-columns: 14px 1fr; gap: 10px; align-items: center; }
        .otp-newrep-dot { width: 12px; height: 12px; border-radius: 4px; }
        .otp-newrep-info { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .otp-newrep-label { font-size: 12px; font-weight: 600; color: #475569; }
        .otp-newrep-count { font-size: 15px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }

        /* トップ顧客 */
        .otp-top-cust-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .otp-top-cust-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid #f1f5f9; }
        .otp-top-cust-row:last-child { border-bottom: none; }
        .otp-top-rank { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: #64748b; background: #f1f5f9; flex-shrink: 0; }
        .otp-top-rank.rank-1 { background: linear-gradient(135deg, #fbbf24, #d97706); color: #fff; }
        .otp-top-rank.rank-2 { background: linear-gradient(135deg, #cbd5e1, #94a3b8); color: #fff; }
        .otp-top-rank.rank-3 { background: linear-gradient(135deg, #fdba74, #c2410c); color: #fff; }
        .otp-top-cust-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .otp-top-cust-name { font-size: 13px; font-weight: 700; color: #1e293b; }
        .otp-top-cust-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .otp-top-cust-code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-family: "SF Mono", monospace; color: #64748b; font-weight: 600; }
        .otp-top-cust-days { font-size: 10px; color: #94a3b8; }
        .otp-top-cust-sales { font-size: 14px; font-weight: 800; color: #047857; font-variant-numeric: tabular-nums; }

        /* 年齢セル */
        .otp-age-cell { font-size: 13px; font-weight: 600; color: #1e293b; white-space: nowrap; }
        .otp-age-group-sub { font-size: 11px; color: #94a3b8; font-weight: 500; margin-left: 2px; }

        /* === v3 追加: セクション見出し行 / 凡例 === */
        .otp-section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
        .otp-section-title-row .otp-section-title { margin: 0; }
        .otp-agender-legend { display: flex; gap: 12px; align-items: center; }
        .otp-agender-legend span { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: #64748b; }
        .otp-agender-legend i { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }

        /* 年代内訳 (男女別スタック) */
        .otp-age-stack { width: 100%; display: flex; flex-direction: column-reverse; min-height: 4px; border-radius: 4px 4px 0 0; overflow: hidden; transition: height 0.3s; }
        .otp-age-seg { width: 100%; transition: flex 0.3s, opacity 0.15s; }
        .otp-age-stack:hover .otp-age-seg { opacity: 0.85; }
        .otp-age-gsplit { font-size: 9px; color: #64748b; font-weight: 700; font-variant-numeric: tabular-nums; }

        /* 時間帯 (視認性強化 v2) */
        .otp-hour-section { margin-bottom: 18px; }
        .otp-hour-peak-tag { font-size: 11px; font-weight: 800; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; padding: 4px 12px; border-radius: 99px; }
        .otp-hour-chart2 { display: flex; align-items: flex-end; gap: 4px; height: 200px; padding: 12px 2px 4px; }
        .otp-hour-col2 { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; height: 100%; cursor: default; }
        .otp-hour-num { font-size: 10px; font-weight: 800; color: #334155; height: 14px; font-variant-numeric: tabular-nums; }
        .otp-hour-track2 { flex: 1; width: 100%; display: flex; align-items: flex-end; }
        .otp-hour-fill2 { width: 100%; background: linear-gradient(180deg, #93c5fd, #3b82f6); min-height: 2px; border-radius: 4px 4px 0 0; transition: height 0.3s, opacity 0.15s; }
        .otp-hour-col2:hover .otp-hour-fill2 { opacity: 0.78; }
        .otp-hour-fill2.peak { background: linear-gradient(180deg, #fbbf24, #d97706); box-shadow: 0 0 0 2px rgba(217,119,6,0.18); }
        .otp-hour-hr { font-size: 10px; color: #94a3b8; font-weight: 700; height: 13px; }
        .otp-hour-axis-note { text-align: center; font-size: 10px; color: #94a3b8; font-weight: 600; margin-top: 2px; }

        /* 曜日別 購入数 + 利用数 (二段バー) */
        .otp-dow-dual { display: flex; flex-direction: column; gap: 12px; }
        .otp-dow-dual-row { display: grid; grid-template-columns: 30px 1fr; gap: 12px; align-items: center; }
        .otp-dow-dual-bars { display: flex; flex-direction: column; gap: 4px; }
        .otp-dow-dual-line { display: grid; grid-template-columns: 1fr 64px; gap: 8px; align-items: center; }
        .otp-dow-dual-track { height: 11px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .otp-dow-dual-fill { height: 100%; border-radius: 99px; transition: width 0.3s; min-width: 2px; }
        .otp-dow-dual-fill.buy { background: linear-gradient(90deg, #fcd34d, #f59e0b); }
        .otp-dow-dual-fill.use { background: linear-gradient(90deg, #34d399, #10b981); }
        .otp-dow-dual-val { font-size: 12px; font-weight: 800; color: #334155; text-align: right; font-variant-numeric: tabular-nums; }
        .otp-dow-dual-val small { font-size: 9px; font-weight: 700; color: #94a3b8; margin-left: 3px; }

        /* 購入者一覧: 性別チップ (ずれ修正) + 操作列 */
        .otp-th-center { text-align: center !important; }
        .otp-gender-td { text-align: center; white-space: nowrap; }
        .otp-gender-chip { display: inline-flex; align-items: center; justify-content: center; gap: 2px; min-width: 62px; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 99px; line-height: 1; }
        .otp-actions-td { text-align: center; }
        .otp-row-actions { display: inline-flex; gap: 6px; }
        .otp-act-btn { font-size: 11px; font-weight: 800; padding: 5px 10px; border-radius: 7px; border: 1.5px solid transparent; cursor: pointer; transition: 0.15s; white-space: nowrap; }
        .otp-act-btn.use { color: #047857; background: #ecfdf5; border-color: #a7f3d0; }
        .otp-act-btn.use:hover:not(:disabled) { background: #d1fae5; border-color: #6ee7b7; }
        .otp-act-btn.unuse { color: #1d4ed8; background: #eff6ff; border-color: #bfdbfe; }
        .otp-act-btn.unuse:hover:not(:disabled) { background: #dbeafe; border-color: #93c5fd; }
        .otp-act-btn.cancel { color: #b45309; background: #fffbeb; border-color: #fde68a; }
        .otp-act-btn.cancel:hover:not(:disabled) { background: #fef3c7; border-color: #fcd34d; }
        .otp-act-btn.refund { color: #64748b; background: #f8fafc; border-color: #e2e8f0; }
        .otp-act-btn.refund:hover:not(:disabled) { background: #f1f5f9; border-color: #cbd5e1; }
        .otp-act-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* 消し込み確認モーダル */
        .otp-modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
        .otp-modal { background: #fff; border-radius: 16px; padding: 26px 28px; width: 100%; max-width: 440px; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
        .otp-modal-title { font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 8px; }
        .otp-modal-desc { font-size: 13px; color: #475569; line-height: 1.7; margin: 0 0 16px; }
        .otp-modal-desc strong { color: #047857; }
        .otp-modal-detail { display: flex; flex-direction: column; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin: 0 0 20px; }
        .otp-modal-detail > div { display: flex; justify-content: space-between; gap: 12px; }
        .otp-modal-detail dt { font-size: 12px; color: #64748b; font-weight: 600; margin: 0; }
        .otp-modal-detail dd { font-size: 13px; color: #0f172a; font-weight: 700; margin: 0; text-align: right; }
        .otp-modal-endfield { display: flex; flex-direction: column; gap: 6px; margin: 0 0 18px; }
        .otp-modal-endfield label { font-size: 12px; font-weight: 700; color: #334155; }
        .otp-modal-endfield input { padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 9px; font-size: 14px; font-weight: 600; }
        .otp-period-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .otp-period-row input { flex: 1; min-width: 150px; }
        .otp-period-tilde { color: #94a3b8; font-weight: 700; }
        .otp-modal-hint { font-size: 11px; color: #94a3b8; line-height: 1.5; }
        .otp-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
        .otp-modal-cancel { font-size: 13px; font-weight: 700; padding: 9px 18px; border-radius: 9px; border: 1.5px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; }
        .otp-modal-cancel:hover:not(:disabled) { background: #f8fafc; }
        .otp-modal-confirm { font-size: 13px; font-weight: 800; padding: 9px 20px; border-radius: 9px; border: none; color: #fff; cursor: pointer; }
        .otp-modal-confirm.tone-green { background: linear-gradient(135deg, #10b981, #047857); box-shadow: 0 2px 6px rgba(4,120,87,0.3); }
        .otp-modal-confirm.tone-blue { background: linear-gradient(135deg, #3b82f6, #1d4ed8); box-shadow: 0 2px 6px rgba(29,78,216,0.3); }
        .otp-modal-confirm.tone-amber { background: linear-gradient(135deg, #f59e0b, #b45309); box-shadow: 0 2px 6px rgba(180,83,9,0.3); }
        .otp-modal-confirm:hover:not(:disabled) { filter: brightness(1.05); }
        .otp-modal-cancel:disabled, .otp-modal-confirm:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

function OneTimePassRouter() {
  const searchParams = useSearchParams();
  const clubCode = searchParams.get("clubCode");
  const viewParam = searchParams.get("view");
  const tab: TabKey =
    viewParam === "dashboard" ? "dashboard" : viewParam === "pricing" ? "pricing" : "settings";

  if (!clubCode) {
    return (
      <StoreSelector
        basePath="/store-settings/basic/onetime-pass"
        title="1dayパス / One Time Pass 設定 - 店舗選択"
        backHref="/store-settings"
        backLabel="メニューへ戻る"
      />
    );
  }

  return (
    <ToastProvider>
      <OneTimePassEditor clubCode={clubCode} initialTab={tab} />
    </ToastProvider>
  );
}

export default function OneTimePassPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f8fafc" }} />}>
      <OneTimePassRouter />
    </Suspense>
  );
}
