// app/api/store-settings/onetime-pass/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PricePeriod = {
  id: string;
  price: number;
  validFrom: string;
  validTo: string | null;
  label?: string;
  note?: string;
};

export type DurationPrices = {
  durationMinutes: number;
  periods: PricePeriod[];
};

export type OneTimePassConfig = {
  clubCode: string;
  brand: string;
  unitType: "1day" | "30min";
  durations: DurationPrices[];
  updatedAt: string;
};

// メモリ上の保存領域 (再起動で消える簡易ストア。本番ではDynamoDB等に切り替えること)
const store: Record<string, OneTimePassConfig> = {};

const FIT365_DURATIONS = [1440];
const JOYFIT_DURATIONS = [30, 60, 90, 120, 150, 180, 210];

function defaultDurationsForBrand(brand: string): number[] {
  return brand && brand.toUpperCase().startsWith("JOYFIT") ? JOYFIT_DURATIONS : FIT365_DURATIONS;
}

// 推奨価格レンジ (上下限)
const PRICE_RANGES: Record<number, { min: number; max: number }> = {
  1440: { min: 700, max: 1500 }, // FIT365 1day pass
};

function clampPrice(durationMinutes: number, price: number): number {
  const r = PRICE_RANGES[durationMinutes];
  if (!r) return price;
  return Math.max(r.min, Math.min(r.max, price));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clubCode = searchParams.get("clubCode");

  if (!clubCode) {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }

  const config = store[clubCode];
  return NextResponse.json({ config: config ?? null });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<OneTimePassConfig>;
    const clubCode = body.clubCode;
    const brand = body.brand ?? "";
    const unitType = body.unitType;
    const incoming = Array.isArray(body.durations) ? body.durations : [];

    if (!clubCode) {
      return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
    }
    if (unitType !== "1day" && unitType !== "30min") {
      return NextResponse.json({ error: "unitType must be '1day' or '30min'" }, { status: 400 });
    }

    const allowed = defaultDurationsForBrand(brand);
    const allowedSet = new Set(allowed);

    const durations: DurationPrices[] = incoming
      .filter((d) => d && typeof d.durationMinutes === "number" && allowedSet.has(d.durationMinutes))
      .map((d) => ({
        durationMinutes: d.durationMinutes,
        periods: (Array.isArray(d.periods) ? d.periods : [])
          .filter(
            (p) => p && typeof p.price === "number" && !Number.isNaN(p.price) && p.validFrom
          )
          .map((p) => ({
            id: String(p.id || ""),
            price: clampPrice(d.durationMinutes, Math.max(0, Math.floor(Number(p.price)))),
            validFrom: String(p.validFrom),
            validTo: p.validTo ? String(p.validTo) : null,
            label: p.label ? String(p.label) : undefined,
            note: p.note ? String(p.note) : undefined,
          })),
      }));

    const updated: OneTimePassConfig = {
      clubCode,
      brand,
      unitType,
      durations,
      updatedAt: new Date().toISOString(),
    };

    store[clubCode] = updated;

    return NextResponse.json({ ok: true, config: updated });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}
