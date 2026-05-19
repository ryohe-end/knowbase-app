// app/api/bankcode/banks/route.ts
// BankCode JP v3 API のプロキシ。クライアントへAPIキーを露出させない。
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BANKCODE_BASE = "https://apis.bankcode-jp.com/v3";

export async function GET(req: Request) {
  const apiKey = process.env.BANKCODE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "BANKCODE_API_KEY is not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();
  const limit = searchParams.get("limit") ?? "20";

  const url = new URL(`${BANKCODE_BASE}/banks`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("limit", limit);
  if (query) {
    // BankCode JP の filter 構文: 部分一致は *=
    // 例) name*="みずほ",halfWidthKana*="ミズホ"
    url.searchParams.set("filter", `name*="${query}",halfWidthKana*="${query}",hiragana*="${query}"`);
  }

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: "BankCode API error", status: res.status, detail: text }, { status: res.status });
    }
    const data = await res.json();
    // 期待形式: { data: [{ code, name, halfWidthKana, hiragana, ... }], ... }
    return NextResponse.json({ banks: data?.data ?? data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: "fetch failed", detail: String(e?.message ?? e) }, { status: 502 });
  }
}
