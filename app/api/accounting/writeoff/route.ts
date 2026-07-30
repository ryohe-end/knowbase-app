// app/api/accounting/writeoff/route.ts
//
// 貸倒処理(経理連携): 対応年月ごとの 会員別 入金済み(区分3)/未納(区分4) 請求額一覧。
//   GET ?ym=YYYYMM&summary=1   → 種別(入金済み/未納)ごとの件数・金額の内訳(軽量JSON)。
//   GET ?ym=YYYYMM&format=csv  → 全区分(3+4)の全件を Shift-JIS CSV でダウンロード。
// 会員単位で1か月31万行・CSV約20MBになるため、member-search 側で1回だけクエリして
// gzip 圧縮(≈2MB)で受け取り(Lambda応答6MB・API GW 29s 制限内)、本ルートで解凍→
// Shift-JIS 変換→ストリーム配信する。requireAccounting でゲート。
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/accountingAuth";
import Encoding from "encoding-japanese";
import { gunzipSync, gzipSync } from "node:zlib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";

const toSjis = (s: string) => new Uint8Array(Encoding.convert(Encoding.stringToCode(s), { to: "SJIS", from: "UNICODE" }));

export async function GET(req: NextRequest) {
  const user = await requireAccounting();
  if (!user) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const ym = (req.nextUrl.searchParams.get("ym") || "").trim();
  if (!/^\d{6}$/.test(ym)) return NextResponse.json({ ok: false, error: "ym(YYYYMM) required" }, { status: 400 });
  if (!API_BASE || !API_KEY) return NextResponse.json({ ok: false, error: "member_search_api_not_configured" }, { status: 500 });

  const call = (extra: Record<string, string>) => {
    const url = new URL(`${API_BASE}/members/search`);
    url.searchParams.set("type", "writeoff_summary");
    url.searchParams.set("ym", ym);
    url.searchParams.set("includePaid", "1"); // 入金済み・未納の全区分
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return fetch(url.toString(), { headers: { "x-api-key": API_KEY }, cache: "no-store" });
  };

  // 集計内訳(軽量)
  if (req.nextUrl.searchParams.get("summary") === "1") {
    try {
      const res = await call({ countOnly: "1" });
      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok || payload?.error) {
        return NextResponse.json({ ok: false, error: "upstream_error", message: payload?.message || null }, { status: 502 });
      }
      return NextResponse.json({ ok: true, ym, total: payload.total ?? 0, breakdown: payload.breakdown ?? [] });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: "upstream_unreachable", message: e?.message || null }, { status: 502 });
    }
  }

  // CSV: gzip圧縮CSV(UTF-8)を1回で受け取り → 解凍 → Shift-JIS変換 → 再gzipして
  // Content-Encoding: gzip で返す。応答は小さく(≈1.5MB)6MB制限を回避、ブラウザが自動解凍して
  // Shift-JIS CSV を保存する(ストリーミング挙動に依存しない)。
  if (req.nextUrl.searchParams.get("format") === "csv") {
    let sjisGz: Uint8Array;
    try {
      const res = await call({ gzip: "1" });
      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok || payload?.error || !payload?.gzB64) {
        return NextResponse.json({ ok: false, error: "upstream_error", message: payload?.message || null }, { status: 502 });
      }
      const csv = gunzipSync(Buffer.from(payload.gzB64, "base64") as any).toString("utf-8");
      // 文字境界(改行)で分割してSJIS変換(巨大な中間配列を避ける)し、連結。
      const chunks: Uint8Array[] = [];
      const TARGET = 500_000;
      let i = 0;
      while (i < csv.length) {
        let end = Math.min(i + TARGET, csv.length);
        if (end < csv.length) {
          const nl = csv.indexOf("\n", end);
          end = nl === -1 ? csv.length : nl + 1;
        }
        chunks.push(toSjis(csv.slice(i, end)));
        i = end;
      }
      sjisGz = new Uint8Array(gzipSync(Buffer.concat(chunks) as any));
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: "export_failed", message: e?.message || null }, { status: 502 });
    }

    const y = ym.slice(0, 4);
    const m = ym.slice(4, 6);
    const filename = `貸倒${y}年${m}月.csv`;
    const encoded = encodeURIComponent(filename);
    return new Response(sjisGz as any, {
      headers: {
        "Content-Type": "text/csv; charset=Shift_JIS",
        "Content-Encoding": "gzip",
        "Content-Disposition": `attachment; filename="writeoff_${ym}.csv"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ ok: false, error: "unknown_mode" }, { status: 400 });
}
