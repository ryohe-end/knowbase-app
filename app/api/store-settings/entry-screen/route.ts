// app/api/store-settings/entry-screen/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type EntryScreenPlan = {
  id: string;
  name: string;
  price: string;
  description?: string;
};

export type EntryScreenFaq = {
  id: string;
  question: string;
  answer: string;
};

export type EntryScreenConfig = {
  clubCode: string;
  brandColor: string;
  accentColor: string;
  logoUrl: string;
  heroImageUrl: string;
  headline: string;
  subHeadline: string;
  description: string;
  campaignTitle: string;
  campaignBody: string;
  plans: EntryScreenPlan[];
  faqs: EntryScreenFaq[];
  notes: string;
  ctaLabel: string;
  contactEmail: string;
  contactPhone: string;
  updatedAt: string;
};

// メモリ上の保存領域 (再起動で消える簡易ストア。本番ではDynamoDB等に切り替えること)
const store: Record<string, EntryScreenConfig> = {};

function defaultConfig(clubCode: string): EntryScreenConfig {
  return {
    clubCode,
    brandColor: "#e11d48",
    accentColor: "#facc15",
    logoUrl: "",
    heroImageUrl: "",
    headline: "あなたのジムライフを、もっと快適に。",
    subHeadline: "24時間営業 / マシン特化型ジム",
    description:
      "通いやすさと続けやすさを追求したフィットネスジムです。\nスタッフ常駐時間以外もご利用いただけます。",
    campaignTitle: "今月の入会キャンペーン",
    campaignBody: "事務手数料 0円 + 当月会費無料！",
    plans: [
      { id: "p1", name: "フルタイム会員", price: "¥7,700/月", description: "24時間いつでも利用可能" },
      { id: "p2", name: "デイタイム会員", price: "¥6,600/月", description: "平日 7:00〜18:00" },
    ],
    faqs: [
      { id: "f1", question: "入会に必要なものは？", answer: "本人確認書類、引き落とし用キャッシュカードまたはクレジットカードが必要です。" },
      { id: "f2", question: "見学はできますか？", answer: "スタッフ常駐時間内であれば見学可能です。" },
    ],
    notes:
      "・入会には本人確認書類が必要です。\n・クレジットカードまたは口座振替がご利用いただけます。",
    ctaLabel: "Web入会を始める",
    contactEmail: "",
    contactPhone: "",
    updatedAt: "",
  };
}

function sanitizePlans(raw: any): EntryScreenPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p === "object")
    .map((p, i) => ({
      id: String(p.id || `p${i + 1}`),
      name: String(p.name || "").slice(0, 60),
      price: String(p.price || "").slice(0, 30),
      description: p.description ? String(p.description).slice(0, 200) : undefined,
    }))
    .filter((p) => p.name);
}

function sanitizeFaqs(raw: any): EntryScreenFaq[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === "object")
    .map((f, i) => ({
      id: String(f.id || `f${i + 1}`),
      question: String(f.question || "").slice(0, 200),
      answer: String(f.answer || "").slice(0, 1000),
    }))
    .filter((f) => f.question);
}

function clampStr(v: any, max: number): string {
  if (v === null || v === undefined) return "";
  return String(v).slice(0, max);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clubCode = searchParams.get("clubCode");
  if (!clubCode) {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }

  const config = store[clubCode] ?? defaultConfig(clubCode);
  return NextResponse.json({ config });
}

export async function POST(req: Request) {
  let body: Partial<EntryScreenConfig> & { clubCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const clubCode = body.clubCode;
  if (!clubCode || typeof clubCode !== "string") {
    return NextResponse.json({ error: "clubCode is required" }, { status: 400 });
  }

  const updated: EntryScreenConfig = {
    clubCode,
    brandColor: clampStr(body.brandColor, 20) || "#e11d48",
    accentColor: clampStr(body.accentColor, 20) || "#facc15",
    logoUrl: clampStr(body.logoUrl, 500),
    heroImageUrl: clampStr(body.heroImageUrl, 500),
    headline: clampStr(body.headline, 80),
    subHeadline: clampStr(body.subHeadline, 120),
    description: clampStr(body.description, 1000),
    campaignTitle: clampStr(body.campaignTitle, 60),
    campaignBody: clampStr(body.campaignBody, 200),
    plans: sanitizePlans(body.plans),
    faqs: sanitizeFaqs(body.faqs),
    notes: clampStr(body.notes, 1000),
    ctaLabel: clampStr(body.ctaLabel, 30) || "Web入会を始める",
    contactEmail: clampStr(body.contactEmail, 200),
    contactPhone: clampStr(body.contactPhone, 30),
    updatedAt: new Date().toISOString(),
  };

  store[clubCode] = updated;
  return NextResponse.json({ ok: true, config: updated });
}
