// app/api/accounting/writeoff/route.ts
//
// 貸倒処理(経理連携): 対応年月ごとの 会員別 入金済み(区分3)/未納(区分4) 請求額一覧。
//   GET ?ym=YYYYMM              → プレビュー(先頭ページのJSON)。画面の表表示用。
//   GET ?ym=YYYYMM&format=csv   → 全ページを結合し Shift-JIS CSV をストリーム配信(添付DL)。
// 会員単位で行数が多く Lambda 応答上限(6MB)を超えるため、member-search を offset/limit で
// 繰り返し取得する。CSV は会計システム取込前提で Shift-JIS(CP932)・ヘッダー付き。
import { NextRequest, NextResponse } from "next/server";
import { requireAccounting } from "@/lib/accountingAuth";
import Encoding from "encoding-japanese";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";
const PAGE_SIZE = 10000;

type Row = {
  対応年月: number | string;
  委託先コード: number | string;
  クラブコード: number | string;
  クラブ略称: string;
  カンパニー名: string;
  会員番号: number | string;
  集計種別: string;
  件数: number;
  請求額合計: number;
};

const COLUMNS: { key: keyof Row; label: string }[] = [
  { key: "対応年月", label: "対応年月" },
  { key: "委託先コード", label: "委託先コード" },
  { key: "クラブコード", label: "クラブコード" },
  { key: "クラブ略称", label: "クラブ略称" },
  { key: "カンパニー名", label: "カンパニー名" },
  { key: "会員番号", label: "会員番号" },
  { key: "集計種別", label: "集計種別" },
  { key: "件数", label: "件数" },
  { key: "請求額合計", label: "請求額合計" },
];

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toSjis = (s: string) => new Uint8Array(Encoding.convert(Encoding.stringToCode(s), { to: "SJIS", from: "UNICODE" }));

// member-search を1ページ取得
async function fetchPage(ym: string, offset: number, limit: number): Promise<{ rows: Row[]; hasMore: boolean }> {
  const url = new URL(`${API_BASE}/members/search`);
  url.searchParams.set("type", "writeoff_summary");
  url.searchParams.set("ym", ym);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString(), { headers: { "x-api-key": API_KEY }, cache: "no-store" });
  const payload = await res.json().catch(() => ({} as any));
  if (!res.ok || payload?.error) {
    const err = new Error(payload?.message || payload?.error || `upstream_error ${res.status}`);
    (err as any).upstream = true;
    throw err;
  }
  return { rows: Array.isArray(payload?.rows) ? payload.rows : [], hasMore: !!payload?.hasMore };
}

export async function GET(req: NextRequest) {
  const user = await requireAccounting();
  if (!user) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const ym = (req.nextUrl.searchParams.get("ym") || "").trim();
  if (!/^\d{6}$/.test(ym)) return NextResponse.json({ ok: false, error: "ym(YYYYMM) required" }, { status: 400 });
  if (!API_BASE || !API_KEY) return NextResponse.json({ ok: false, error: "member_search_api_not_configured" }, { status: 500 });

  const isCsv = req.nextUrl.searchParams.get("format") === "csv";

  // プレビュー: 先頭ページのみ返す(表表示用・軽量)
  if (!isCsv) {
    try {
      const { rows, hasMore } = await fetchPage(ym, 0, 500);
      return NextResponse.json({ ok: true, ym, rows, hasMore });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: "upstream_error", message: e?.message || null }, { status: 502 });
    }
  }

  // CSV: 全ページを繰り返し取得し、Shift-JIS でストリーム配信する。
  const y = ym.slice(0, 4);
  const m = ym.slice(4, 6);
  const filename = `貸倒${y}年${m}月.csv`;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(toSjis(COLUMNS.map((c) => c.label).join(",") + "\r\n"));
        let offset = 0;
        for (;;) {
          const { rows, hasMore } = await fetchPage(ym, offset, PAGE_SIZE);
          for (const r of rows) {
            controller.enqueue(toSjis(COLUMNS.map((c) => csvCell(r[c.key])).join(",") + "\r\n"));
          }
          if (!hasMore || rows.length === 0) break;
          offset += PAGE_SIZE;
        }
        controller.close();
      } catch (e) {
        // ストリーム途中の失敗は中断(部分ファイルになる)。ログに残す。
        console.error("[writeoff csv] stream error", e);
        controller.error(e);
      }
    },
  });

  // ファイル名は RFC5987 で UTF-8 指定(日本語対応)
  const encoded = encodeURIComponent(filename);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=Shift_JIS",
      "Content-Disposition": `attachment; filename="writeoff_${ym}.csv"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}
