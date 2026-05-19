// app/api/store-settings/onetime-pass/pricing/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HourlySlot = {
  hour: number;       // 0-23
  count: number;
  sales: number;
};

export type DayOfWeekSlot = {
  dayOfWeek: number;  // 0=日, 6=土
  label: string;
  count: number;
  sales: number;
};

export type DurationDemand = {
  durationMinutes: number;
  count: number;
  sales: number;
  occupancyRate: number;   // 0..1
  peakHour: number;
  peakDay: string;
  trend: "up" | "down" | "flat";
  trendPct: number;
};

export type Confidence = "high" | "medium" | "low";
export type DemandLevel = "low" | "mid" | "high";

export type SlotSuggestion = {
  id: string;              // "wd-peak"
  label: string;           // "平日ピーク"
  schedule: string;        // "平日 17〜21時"
  daysLabel: string;       // "平日" / "週末"
  demand: DemandLevel;
  demandIndex: number;     // 0..1
  suggestedPrice: number;
  changePct: number;
  rationale: string;
  recommendedLabel: string;  // 設定反映時のラベル
  wasClamped: "min" | "max" | null;
};

export type PriceSuggestion = {
  durationMinutes: number;
  currentPrice: number;
  basePrice: number;             // slots の中央/推奨ベース
  baseChangePct: number;
  baseClamped: "min" | "max" | null;
  priceRange: { min: number; max: number } | null;
  confidence: Confidence;
  reasoning: string[];
  projectedRevenueDelta: number;
  projectedVolumeDelta: number;
  recommendedLabel: string;
  recommendedValidFrom: string;
  slots: SlotSuggestion[];
};

export type SeasonType = "busy" | "quiet" | "normal";

export type SeasonalDurationPrice = {
  durationMinutes: number;
  basePrice: number;        // 通常時の参考価格
  seasonalPrice: number;    // 季節要因を適用した推奨価格
  changePct: number;        // 通常との差分%
  wasClamped: "min" | "max" | null;
  priceRange: { min: number; max: number } | null;
};

export type SeasonalPeriod = {
  id: string;
  label: string;
  description: string;
  type: SeasonType;
  dateFrom: string;         // YYYY-MM-DD
  dateTo: string;           // YYYY-MM-DD
  multiplier: number;       // 1.0=通常, 1.2=繁忙期, 0.9=閑散期
  expectedDemandPct: number; // 通常比 ±X%
  durationPrices: SeasonalDurationPrice[];
  reasoning: string[];
};

export type PricingFactor = {
  id: string;
  label: string;
  description: string;
  rangeText: string;        // 例: "×0.80 〜 ×1.30"
  exampleText: string;      // 例: "平日ピーク = ×1.30"
};

export type CalculationStep = {
  label: string;             // "平日ピーク需要シェア"
  detail: string;            // "需要レベル: 高"
  operator: "×" | "+" | "→"; // 乗算 / 加算 / 操作 (丸め・クランプ)
  factorText: string;        // "×1.30" / "+4%" / "¥50刻みに丸め"
  beforePrice: number;
  afterPrice: number;
};

export type CalculationExample = {
  durationMinutes: number;
  slotId: string;
  slotLabel: string;
  startPrice: number;
  finalPrice: number;
  totalChangePct: number;
  steps: CalculationStep[];
  note: string;              // "需要が高いため値上げ余地あり" など全体総括
};

export type PricingAnalysis = {
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

const FIT365_DURATIONS = [1440];
const JOYFIT_DURATIONS = [30, 60, 90, 120, 150, 180, 210];
const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function defaultDurationsForBrand(brand: string): number[] {
  return brand && brand.toUpperCase().startsWith("JOYFIT") ? JOYFIT_DURATIONS : FIT365_DURATIONS;
}

function defaultPriceFor(durationMinutes: number): number {
  const map: Record<number, number> = {
    30: 500, 60: 900, 90: 1300, 120: 1700, 150: 2000, 180: 2300, 210: 2500, 1440: 1000,
  };
  return map[durationMinutes] ?? 1000;
}

// 推奨価格レンジ (上下限) — ダイナミックプライシングがこの範囲を超えないようにクランプ
export type PriceRange = { min: number; max: number };
export type ClampFlag = "min" | "max" | null;

const PRICE_RANGES: Record<number, PriceRange> = {
  1440: { min: 700, max: 1500 }, // FIT365 1day pass: ¥700 〜 ¥1,500
};

function rangeFor(durationMinutes: number): PriceRange | null {
  return PRICE_RANGES[durationMinutes] ?? null;
}

function clampWithFlag(
  durationMinutes: number,
  price: number
): { price: number; clamped: ClampFlag } {
  const r = PRICE_RANGES[durationMinutes];
  if (!r) return { price, clamped: null };
  if (price < r.min) return { price: r.min, clamped: "min" };
  if (price > r.max) return { price: r.max, clamped: "max" };
  return { price, clamped: null };
}

function nextMonthFirst(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function emptyAnalysis(): PricingAnalysis {
  return {
    insights: [],
    hourly: [],
    dayOfWeek: [],
    durationDemand: [],
    suggestions: [],
    seasonalPeriods: [],
    pricingFactors: [],
    calculationExamples: [],
    generatedAt: new Date().toISOString(),
    isDemo: false,
  };
}

function buildPricingFactors(brand: string): PricingFactor[] {
  const isJoyfit = brand.toUpperCase().startsWith("JOYFIT");
  return [
    {
      id: "demand-share",
      label: "需要シェア倍率",
      description: "時間帯×曜日で構成する5つのスロットごとの需要レベルに応じた基本倍率。",
      rangeText: isJoyfit ? "×0.80 〜 ×1.30" : "×0.75 〜 ×1.35",
      exampleText: isJoyfit
        ? "平日ピーク (17〜21時) = ×1.30 / 平日オフピーク = ×0.80"
        : "週末ピーク (10〜20時) = ×1.35 / 平日オフピーク = ×0.75",
    },
    {
      id: "occupancy-adj",
      label: "占有率補正",
      description: "期間内の占有率 (利用集中度) に応じた追加調整。",
      rangeText: "−4% 〜 +4%",
      exampleText: "占有率 ≥ 75% → +4% / 占有率 < 45% → −4%",
    },
    {
      id: "trend-adj",
      label: "トレンド補正",
      description: "直近の需要トレンドに応じた微調整。",
      rangeText: "−2% 〜 +2%",
      exampleText: "上昇 (+5%超) → +2% / 下降 (−5%未満) → −2%",
    },
    {
      id: "seasonal",
      label: "季節要因",
      description: "年末年始・GW・お盆・梅雨など、繁忙期/閑散期での倍率調整。期間限定で適用。",
      rangeText: "×0.90 〜 ×1.20",
      exampleText: "年末年始 ×1.20 / お盆 ×1.18 / 梅雨閑散期 ×0.92",
    },
    {
      id: "rounding",
      label: "¥50 単位丸め",
      description: "最終提案価格は ¥50 刻みに丸めて、現場での運用しやすさを優先。",
      rangeText: "—",
      exampleText: "¥683 → ¥700",
    },
    {
      id: "range-clamp",
      label: "価格レンジ (上下限)",
      description: "duration ごとに設定された許容価格レンジでクランプ。上限/下限到達時は最大/最小値で提案。",
      rangeText: isJoyfit ? "— (JOYFITは未設定)" : "¥700 〜 ¥1,500 (FIT365 1day)",
      exampleText: isJoyfit
        ? "JOYFIT 各 duration には個別レンジ未設定"
        : "倍率合成で ¥1,650 → クランプにより ¥1,500",
    },
  ];
}

function buildCalculationExamples(
  brand: string,
  suggestions: PriceSuggestion[],
  durationDemand: DurationDemand[]
): CalculationExample[] {
  if (suggestions.length === 0) return [];
  const isJoyfit = brand.toUpperCase().startsWith("JOYFIT");

  // JOYFIT用ベース倍率 (route内のmultiplierFor と同期)
  function slotMult(slotId: string): number {
    if (isJoyfit) {
      return slotId === "wd-off" ? 0.80
        : slotId === "wd-normal" ? 0.95
        : slotId === "wd-peak" ? 1.30
        : slotId === "wk-normal" ? 1.05
        : 1.20;
    }
    return slotId === "wd-off" ? 0.75
      : slotId === "wd-normal" ? 0.90
      : slotId === "wd-peak" ? 1.10
      : slotId === "wk-normal" ? 1.10
      : 1.35;
  }

  // 代表例として: (1) 最も値上げが大きいスロット (2) 最も値下げが大きいスロット
  const candidates: { sug: PriceSuggestion; slotIdx: number; mag: number }[] = [];
  suggestions.forEach((sug) => {
    sug.slots.forEach((sl, idx) => {
      candidates.push({ sug, slotIdx: idx, mag: Math.abs(sl.changePct) });
    });
  });
  candidates.sort((a, b) => b.mag - a.mag);

  const picked = new Set<string>();
  const examples: CalculationExample[] = [];
  for (const c of candidates) {
    if (examples.length >= 2) break;
    const slot = c.sug.slots[c.slotIdx];
    const key = `${c.sug.durationMinutes}-${slot.id}`;
    if (picked.has(key)) continue;
    // 上げと下げを1件ずつ取れたら良い
    const direction = slot.changePct > 0 ? "up" : slot.changePct < 0 ? "down" : "flat";
    const alreadyHasDirection = examples.some((e) =>
      (e.totalChangePct > 0 ? "up" : e.totalChangePct < 0 ? "down" : "flat") === direction
    );
    if (alreadyHasDirection && examples.length === 1) continue;
    picked.add(key);

    const dd = durationDemand.find((d) => d.durationMinutes === c.sug.durationMinutes);
    const occShift = dd && dd.occupancyRate >= 0.75 ? 0.04
      : dd && dd.occupancyRate < 0.45 ? -0.04
      : 0;
    const trendShift = dd?.trend === "up" ? 0.02
      : dd?.trend === "down" ? -0.02
      : 0;
    const baseMult = slotMult(slot.id);

    const start = c.sug.currentPrice;
    const afterSlot = start * baseMult;
    const afterOcc = afterSlot * (1 + occShift);
    const afterTrend = afterOcc * (1 + trendShift);
    const rounded = Math.max(0, Math.round(afterTrend / 50) * 50);
    const clamped = slot.suggestedPrice; // API側でクランプ済み

    const steps: CalculationStep[] = [];
    steps.push({
      label: `${slot.label} の需要シェア倍率`,
      detail: `需要レベル: ${slot.demand === "high" ? "高" : slot.demand === "mid" ? "中" : "低"}`,
      operator: "×",
      factorText: `×${baseMult.toFixed(2)}`,
      beforePrice: Math.round(start),
      afterPrice: Math.round(afterSlot),
    });
    if (occShift !== 0) {
      steps.push({
        label: "占有率補正",
        detail: dd
          ? `占有率: ${Math.round(dd.occupancyRate * 100)}% (${occShift > 0 ? "高水準" : "低水準"})`
          : "",
        operator: "×",
        factorText: `${occShift > 0 ? "+" : ""}${Math.round(occShift * 100)}%`,
        beforePrice: Math.round(afterSlot),
        afterPrice: Math.round(afterOcc),
      });
    }
    if (trendShift !== 0) {
      steps.push({
        label: "トレンド補正",
        detail: dd ? `直近トレンド: ${dd.trendPct >= 0 ? "+" : ""}${dd.trendPct}%` : "",
        operator: "×",
        factorText: `${trendShift > 0 ? "+" : ""}${Math.round(trendShift * 100)}%`,
        beforePrice: Math.round(afterOcc),
        afterPrice: Math.round(afterTrend),
      });
    }
    steps.push({
      label: "¥50 単位丸め",
      detail: "現場での運用性を優先した丸め処理",
      operator: "→",
      factorText: "¥50 刻み",
      beforePrice: Math.round(afterTrend),
      afterPrice: rounded,
    });
    if (slot.wasClamped) {
      const r = rangeFor(c.sug.durationMinutes);
      steps.push({
        label: slot.wasClamped === "max" ? "上限クランプ" : "下限クランプ",
        detail: r
          ? `許容レンジ ¥${r.min.toLocaleString("ja-JP")} 〜 ¥${r.max.toLocaleString("ja-JP")}`
          : "",
        operator: "→",
        factorText: slot.wasClamped === "max" ? "上限値で固定" : "下限値で固定",
        beforePrice: rounded,
        afterPrice: clamped,
      });
    }

    const totalChangePct = start > 0
      ? Math.round(((clamped - start) / start) * 100)
      : 0;

    examples.push({
      durationMinutes: c.sug.durationMinutes,
      slotId: slot.id,
      slotLabel: slot.label,
      startPrice: start,
      finalPrice: clamped,
      totalChangePct,
      steps,
      note: slot.rationale,
    });
  }
  return examples;
}

// 季節イベント定義 (年内固定の日付パターン)
type SeasonDef = {
  id: string;
  label: string;
  description: string;
  type: SeasonType;
  fromMonth: number;
  fromDay: number;
  toMonth: number;
  toDay: number;
  multiplier: number;
  reasoning: string[];
};

const SEASON_DEFS: SeasonDef[] = [
  {
    id: "newyear",
    label: "年末年始",
    description: "12月末〜1月初頭の繁忙期。帰省・旅行需要が集中します。",
    type: "busy",
    fromMonth: 12, fromDay: 29, toMonth: 1, toDay: 3,
    multiplier: 1.20,
    reasoning: ["年末年始は来店者数が通常比 +30〜40% 増加します。", "競合施設も値上げ傾向のため、価格弾力性は低めです。"],
  },
  {
    id: "newyear-quiet",
    label: "新年明け閑散期",
    description: "1月中旬〜2月の閑散期。年始イベント後の落ち込み期。",
    type: "quiet",
    fromMonth: 1, fromDay: 15, toMonth: 2, toDay: 15,
    multiplier: 0.90,
    reasoning: ["1月後半は年末の反動で来店数が ±15% 減少します。", "値下げによる集客喚起が有効です。"],
  },
  {
    id: "spring-break",
    label: "春休み",
    description: "3月下旬〜4月初頭の春休み。学生・家族需要が増加します。",
    type: "busy",
    fromMonth: 3, fromDay: 20, toMonth: 4, toDay: 5,
    multiplier: 1.08,
    reasoning: ["春休みは家族・学生利用が +20% 増加します。"],
  },
  {
    id: "gw",
    label: "ゴールデンウィーク",
    description: "5月初頭の大型連休。レジャー需要が最大化します。",
    type: "busy",
    fromMonth: 5, fromDay: 3, toMonth: 5, toDay: 5,
    multiplier: 1.15,
    reasoning: ["GWは観光・レジャー需要で来店数が +25% 程度増加します。", "短期集中型の繁忙期です。"],
  },
  {
    id: "rainy",
    label: "梅雨閑散期",
    description: "6月の梅雨期。外出控えにより需要が低下します。",
    type: "quiet",
    fromMonth: 6, fromDay: 1, toMonth: 6, toDay: 30,
    multiplier: 0.92,
    reasoning: ["梅雨期は屋外利用が減少し、施設利用が ±10% 減少します。", "雨天キャンペーンで集客を促せます。"],
  },
  {
    id: "summer-vacation",
    label: "夏休み",
    description: "7月下旬〜8月の夏休み。学生・観光需要のピーク。",
    type: "busy",
    fromMonth: 7, fromDay: 20, toMonth: 8, toDay: 31,
    multiplier: 1.12,
    reasoning: ["夏休みは家族・学生・観光客の利用が +25% 程度増加します。"],
  },
  {
    id: "obon",
    label: "お盆",
    description: "8月中旬のお盆期間。帰省・旅行需要が集中します。",
    type: "busy",
    fromMonth: 8, fromDay: 13, toMonth: 8, toDay: 16,
    multiplier: 1.18,
    reasoning: ["お盆期間は帰省・観光需要で来店数が +30% 程度増加します。"],
  },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 次回到来する季節期間 (今日以降に開始または含まれる)
function upcomingSeasonalPeriods(): { def: SeasonDef; dateFrom: string; dateTo: string }[] {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const results: { def: SeasonDef; dateFrom: string; dateTo: string; sortKey: string }[] = [];

  // 今年と来年の2年分を生成し、終了日が今日以降のものを選ぶ
  for (let yearOffset = 0; yearOffset < 2; yearOffset++) {
    const baseYear = now.getFullYear() + yearOffset;
    for (const def of SEASON_DEFS) {
      const startYear = baseYear;
      // 年跨ぎ (年末年始など) は終了日が翌年
      const endYear = def.toMonth < def.fromMonth ? baseYear + 1 : baseYear;
      const dateFrom = `${startYear}-${pad2(def.fromMonth)}-${pad2(def.fromDay)}`;
      const dateTo = `${endYear}-${pad2(def.toMonth)}-${pad2(def.toDay)}`;
      if (dateTo >= today) {
        results.push({ def, dateFrom, dateTo, sortKey: dateFrom });
      }
    }
  }
  // 開始日順、重複IDは初出のみ
  results.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const seen = new Set<string>();
  const unique: { def: SeasonDef; dateFrom: string; dateTo: string }[] = [];
  for (const r of results) {
    if (!seen.has(r.def.id)) {
      seen.add(r.def.id);
      unique.push({ def: r.def, dateFrom: r.dateFrom, dateTo: r.dateTo });
    }
    if (unique.length >= 7) break;
  }
  return unique;
}

function buildSeasonalPeriods(
  brand: string,
  currentPrices: Map<number, number>
): SeasonalPeriod[] {
  const durations = defaultDurationsForBrand(brand);
  const upcoming = upcomingSeasonalPeriods();
  return upcoming.map((u) => {
    const durationPrices: SeasonalDurationPrice[] = durations.map((dm) => {
      const basePrice = currentPrices.get(dm) ?? defaultPriceFor(dm);
      const raw = basePrice * u.def.multiplier;
      const rounded = Math.max(0, Math.round(raw / 50) * 50);
      const { price: seasonalPrice, clamped } = clampWithFlag(dm, rounded);
      const changePct = basePrice > 0
        ? Math.round(((seasonalPrice - basePrice) / basePrice) * 100)
        : 0;
      return {
        durationMinutes: dm,
        basePrice,
        seasonalPrice,
        changePct,
        wasClamped: clamped,
        priceRange: rangeFor(dm),
      };
    });
    const expectedDemandPct =
      u.def.type === "busy"
        ? Math.round((u.def.multiplier - 1) * 100) + 10  // 簡易: 価格設定 + 自然増加
        : u.def.type === "quiet"
        ? -Math.round((1 - u.def.multiplier) * 100) - 5
        : 0;
    return {
      id: u.def.id,
      label: u.def.label,
      description: u.def.description,
      type: u.def.type,
      dateFrom: u.dateFrom,
      dateTo: u.dateTo,
      multiplier: u.def.multiplier,
      expectedDemandPct,
      durationPrices,
      reasoning: u.def.reasoning,
    };
  });
}

function generateDemoAnalysis(
  clubCode: string,
  brand: string,
  currentPrices: Map<number, number>
): PricingAnalysis {
  let seed = clubCode.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const durations = defaultDurationsForBrand(brand);
  const isJoyfit = brand.toUpperCase().startsWith("JOYFIT");

  // 時間帯別 (6-23時を主に。ピーク: 昼12-13、夕18-20)
  const hourly: HourlySlot[] = [];
  for (let h = 0; h < 24; h++) {
    let base = 2;
    if (h >= 6 && h < 10) base = 8 + Math.floor(rand() * 6);
    else if (h >= 10 && h < 12) base = 6 + Math.floor(rand() * 4);
    else if (h >= 12 && h < 14) base = 14 + Math.floor(rand() * 8);  // 昼ピーク
    else if (h >= 14 && h < 17) base = 5 + Math.floor(rand() * 4);
    else if (h >= 17 && h < 21) base = 18 + Math.floor(rand() * 10); // 夕ピーク
    else if (h >= 21 && h < 23) base = 6 + Math.floor(rand() * 4);
    else base = 1 + Math.floor(rand() * 2);
    hourly.push({
      hour: h,
      count: base,
      sales: base * (isJoyfit ? 800 : 3000) + Math.floor(rand() * 1000),
    });
  }
  const peakHour = hourly.reduce((m, s) => (s.count > m.count ? s : m), hourly[0]).hour;

  // 曜日別 (JOYFITは平日夕方ピーク、FIT365は週末ピーク)
  const dayOfWeek: DayOfWeekSlot[] = [];
  for (let i = 0; i < 7; i++) {
    let base: number;
    if (isJoyfit) {
      base = i >= 1 && i <= 5 ? 70 + Math.floor(rand() * 30) : 45 + Math.floor(rand() * 20);
    } else {
      base = i === 0 || i === 6 ? 80 + Math.floor(rand() * 30) : 38 + Math.floor(rand() * 18);
    }
    dayOfWeek.push({
      dayOfWeek: i,
      label: DAY_LABELS[i],
      count: base,
      sales: base * (isJoyfit ? 850 : 3100),
    });
  }
  const peakDayIdx = dayOfWeek.reduce((m, s) => (s.count > m.count ? s : m), dayOfWeek[0]).dayOfWeek;

  // 期間別需要
  const durationDemand: DurationDemand[] = durations.map((dm) => {
    // 短時間ほど需要が高い (JOYFIT)、1日は単一
    const popularity = isJoyfit ? Math.max(0.25, 1 - (dm / 250)) : 1;
    const baseCount = Math.floor(50 + rand() * 60) * popularity;
    const trendPct = Math.round((rand() - 0.4) * 30); // -12〜+18%
    const trend: "up" | "down" | "flat" =
      trendPct > 5 ? "up" : trendPct < -5 ? "down" : "flat";
    return {
      durationMinutes: dm,
      count: Math.round(baseCount),
      sales: Math.round(baseCount * (currentPrices.get(dm) ?? defaultPriceFor(dm))),
      occupancyRate: Math.min(0.95, 0.35 + rand() * 0.55),
      peakHour,
      peakDay: DAY_LABELS[peakDayIdx],
      trend,
      trendPct,
    };
  });

  // 期間別スロット定義 (ダイナミックプライシングの軸)
  type SlotDef = {
    id: string;
    label: string;
    schedule: string;
    daysLabel: string;
    demand: DemandLevel;
  };
  const SLOT_DEFS: SlotDef[] = [
    { id: "wd-off", label: "平日オフピーク", schedule: "平日 10〜15時", daysLabel: "平日", demand: "low" },
    { id: "wd-normal", label: "平日通常", schedule: "平日 6〜10/15〜17/21〜23時", daysLabel: "平日", demand: "mid" },
    { id: "wd-peak", label: "平日ピーク", schedule: "平日 17〜21時", daysLabel: "平日", demand: "high" },
    { id: "wk-normal", label: "週末通常", schedule: "土日祝 6〜10/20〜23時", daysLabel: "週末", demand: "mid" },
    { id: "wk-peak", label: "週末ピーク", schedule: "土日祝 10〜20時", daysLabel: "週末", demand: "high" },
  ];

  // ブランド別の需要倍率 (JOYFITは平日夕方プライマリ、FIT365は週末プライマリ)
  function multiplierFor(slotId: string): number {
    if (isJoyfit) {
      switch (slotId) {
        case "wd-off": return 0.80;
        case "wd-normal": return 0.95;
        case "wd-peak": return 1.30;
        case "wk-normal": return 1.05;
        case "wk-peak": return 1.20;
      }
    } else {
      switch (slotId) {
        case "wd-off": return 0.75;
        case "wd-normal": return 0.90;
        case "wd-peak": return 1.10;
        case "wk-normal": return 1.10;
        case "wk-peak": return 1.35;
      }
    }
    return 1.0;
  }

  // 価格提案 (期間別スロットを含む)
  const suggestions: PriceSuggestion[] = durationDemand.map((d) => {
    const current = currentPrices.get(d.durationMinutes) ?? defaultPriceFor(d.durationMinutes);

    // 占有率・トレンドによる全体補正 (±5%)
    const occShift = d.occupancyRate >= 0.75 ? 0.04 : d.occupancyRate < 0.45 ? -0.04 : 0;
    const trendShift = d.trend === "up" ? 0.02 : d.trend === "down" ? -0.02 : 0;
    const overallAdj = 1 + occShift + trendShift;

    const slots: SlotSuggestion[] = SLOT_DEFS.map((sd) => {
      const baseMult = multiplierFor(sd.id);
      const noise = (rand() - 0.5) * 0.04; // ±2%
      const finalMult = baseMult * overallAdj + noise;
      const raw = current * finalMult;
      const rounded = Math.max(0, Math.round(raw / 50) * 50);
      const { price: suggestedPrice, clamped: wasClamped } = clampWithFlag(d.durationMinutes, rounded);
      const changePct = current > 0
        ? Math.round(((suggestedPrice - current) / current) * 100)
        : 0;

      let rationale: string;
      if (wasClamped === "max") {
        rationale = `${sd.label}帯の需要は値上げ余地ありですが、上限価格に到達しているため最大値で提案します。`;
      } else if (wasClamped === "min") {
        rationale = `${sd.label}帯は更なる値下げ余地がありますが、下限価格に到達しているため最低値で提案します。`;
      } else if (sd.demand === "high" && changePct > 0) {
        rationale = `${sd.label}帯は需要が集中するため、${changePct}%の値上げが妥当です。`;
      } else if (sd.demand === "low" && changePct < 0) {
        rationale = `${sd.label}帯は需要が低いため、${Math.abs(changePct)}%の値下げで集客を促せます。`;
      } else if (changePct === 0) {
        rationale = `${sd.label}帯は現価格が適正水準です。`;
      } else {
        rationale = `${sd.label}帯は ${changePct >= 0 ? "+" : ""}${changePct}% の調整が妥当です。`;
      }

      const recommendedLabel =
        changePct > 8 ? `ピーク (${sd.label})`
        : changePct < -8 ? `割引 (${sd.label})`
        : sd.label;

      const demandIndex = sd.demand === "low" ? 0.4 : sd.demand === "mid" ? 0.7 : 0.95;
      return {
        id: sd.id,
        label: sd.label,
        schedule: sd.schedule,
        daysLabel: sd.daysLabel,
        demand: sd.demand,
        demandIndex,
        suggestedPrice,
        changePct,
        rationale,
        recommendedLabel,
        wasClamped,
      };
    });

    // ベース価格 = 通常帯 (平日通常 + 週末通常) の平均
    const normalSlots = slots.filter((s) => s.demand === "mid");
    const basePriceRaw = normalSlots.length > 0
      ? Math.round(normalSlots.reduce((sum, s) => sum + s.suggestedPrice, 0) / normalSlots.length / 50) * 50
      : slots[0].suggestedPrice;
    const { price: basePrice, clamped: baseClamped } = clampWithFlag(d.durationMinutes, basePriceRaw);
    const baseChangePct = current > 0
      ? Math.round(((basePrice - current) / current) * 100)
      : 0;

    // 全体推奨ラベル
    const recommendedLabel =
      baseChangePct > 0 ? "ピーク価格" : baseChangePct < 0 ? "需要喚起価格" : "現状維持";

    // 根拠 (全体)
    const reasoning: string[] = [];
    if (d.occupancyRate >= 0.75) {
      reasoning.push(`占有率が ${Math.round(d.occupancyRate * 100)}% と高く、ピーク帯の値上げ余地があります。`);
    } else if (d.occupancyRate < 0.45) {
      reasoning.push(`占有率が ${Math.round(d.occupancyRate * 100)}% と低く、オフピーク帯の値下げで集客強化を狙えます。`);
    } else {
      reasoning.push(`占有率は ${Math.round(d.occupancyRate * 100)}% でバランス良好。期間別の最適化で利益を底上げできます。`);
    }
    if (d.trend === "up") {
      reasoning.push(`直近の需要トレンドが +${d.trendPct}% と上昇中で、価格弾力性は低い水準です。`);
    } else if (d.trend === "down") {
      reasoning.push(`需要トレンドが ${d.trendPct}% と低下傾向。低需要帯はキャンペーン価格が有効です。`);
    }
    reasoning.push(`ピーク時間帯 (${peakHour}時台) / ピーク曜日 (${DAY_LABELS[peakDayIdx]}曜日) を中心に価格差を設けるのが推奨です。`);

    // 予測インパクト: スロット別の需要重み付き
    const elasticity = -1.3;
    let projectedRevenueDelta = 0;
    let projectedVolumeDelta = 0;
    slots.forEach((s) => {
      // 各スロットの想定シェア (デモ: 需要レベルベースの近似)
      const share = s.demand === "high" ? 0.28 : s.demand === "mid" ? 0.17 : 0.10;
      const slotCount = d.count * share;
      const slotVolDeltaPct = s.changePct * elasticity;
      const slotVolDelta = (slotCount * slotVolDeltaPct) / 100;
      const slotNewCount = slotCount + slotVolDelta;
      projectedVolumeDelta += slotVolDelta;
      projectedRevenueDelta += slotNewCount * s.suggestedPrice - slotCount * current;
    });
    projectedRevenueDelta = Math.round(projectedRevenueDelta);
    projectedVolumeDelta = Math.round(projectedVolumeDelta);

    const spread = Math.max(...slots.map((s) => s.suggestedPrice)) - Math.min(...slots.map((s) => s.suggestedPrice));
    const confidence: Confidence =
      Math.abs(d.occupancyRate - 0.6) > 0.2 && spread > 0
        ? "high"
        : spread > 0
        ? "medium"
        : "low";

    // クランプの有無に応じて根拠を追加
    if (slots.some((s) => s.wasClamped === "max")) {
      reasoning.push(`一部スロットの推奨価格が上限 (¥${rangeFor(d.durationMinutes)?.max.toLocaleString("ja-JP")}) に到達しています。上限引き上げの検討余地があります。`);
    }
    if (slots.some((s) => s.wasClamped === "min")) {
      reasoning.push(`一部スロットの推奨価格が下限 (¥${rangeFor(d.durationMinutes)?.min.toLocaleString("ja-JP")}) に到達しています。`);
    }

    return {
      durationMinutes: d.durationMinutes,
      currentPrice: current,
      basePrice,
      baseChangePct,
      baseClamped,
      priceRange: rangeFor(d.durationMinutes),
      confidence,
      reasoning,
      projectedRevenueDelta,
      projectedVolumeDelta,
      recommendedLabel,
      recommendedValidFrom: nextMonthFirst(),
      slots,
    };
  });

  // 全体インサイト
  const insights: string[] = [];
  insights.push(`ピーク時間帯は ${peakHour}時台 / ピーク曜日は ${DAY_LABELS[peakDayIdx]}曜日 です。`);
  const totalCount = durationDemand.reduce((s, d) => s + d.count, 0);
  const totalSales = durationDemand.reduce((s, d) => s + d.sales, 0);
  insights.push(`分析対象期間の総売上: ¥${totalSales.toLocaleString("ja-JP")} (${totalCount}件)`);
  const upTrendCount = durationDemand.filter((d) => d.trend === "up").length;
  if (upTrendCount > 0) {
    insights.push(`${upTrendCount}つの期間で需要トレンドが上昇中。値上げ余地を検討してください。`);
  }
  const downTrendCount = durationDemand.filter((d) => d.trend === "down").length;
  if (downTrendCount > 0) {
    insights.push(`${downTrendCount}つの期間で需要トレンドが下降中。値下げ・キャンペーンを検討してください。`);
  }
  const totalRevenueDelta = suggestions.reduce((s, x) => s + x.projectedRevenueDelta, 0);
  if (totalRevenueDelta !== 0) {
    insights.push(
      `提案価格を適用した場合の月次売上インパクト: ${totalRevenueDelta >= 0 ? "+" : ""}¥${totalRevenueDelta.toLocaleString("ja-JP")} (見込み)`
    );
  }

  // 季節要因
  const seasonalPeriods = buildSeasonalPeriods(brand, currentPrices);
  const nextBusy = seasonalPeriods.find((p) => p.type === "busy");
  if (nextBusy) {
    insights.push(
      `直近の繁忙期は「${nextBusy.label}」(${nextBusy.dateFrom}〜${nextBusy.dateTo})。価格を ${Math.round((nextBusy.multiplier - 1) * 100)}% 引き上げる提案があります。`
    );
  }
  const nextQuiet = seasonalPeriods.find((p) => p.type === "quiet");
  if (nextQuiet) {
    insights.push(
      `直近の閑散期は「${nextQuiet.label}」(${nextQuiet.dateFrom}〜${nextQuiet.dateTo})。価格を ${Math.round((1 - nextQuiet.multiplier) * 100)}% 引き下げる提案があります。`
    );
  }

  // 価格決定要因 + 計算例
  const pricingFactors = buildPricingFactors(brand);
  const calculationExamples = buildCalculationExamples(brand, suggestions, durationDemand);

  return {
    insights,
    hourly,
    dayOfWeek,
    durationDemand,
    suggestions,
    seasonalPeriods,
    pricingFactors,
    calculationExamples,
    generatedAt: new Date().toISOString(),
    isDemo: true,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const clubCode = String(body.clubCode || "");
    const brand = String(body.brand || "");
    const demo = !!body.demo;
    const currentPricesArr = Array.isArray(body.currentPrices) ? body.currentPrices : [];

    if (!clubCode) {
      return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
    }

    const map = new Map<number, number>();
    currentPricesArr.forEach((p: { durationMinutes: number; price: number }) => {
      if (typeof p?.durationMinutes === "number" && typeof p?.price === "number" && p.price > 0) {
        map.set(p.durationMinutes, p.price);
      }
    });

    if (demo) {
      return NextResponse.json({ analysis: generateDemoAnalysis(clubCode, brand, map) });
    }
    return NextResponse.json({ analysis: emptyAnalysis() });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}
