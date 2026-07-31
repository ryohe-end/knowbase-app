"use client";

// 経理: APP未納金支払。期間を選び、JOYFIT / FIT365 それぞれの明細CSVをダウンロードする。
//   - データ源は入会DB(ecojoy/fit365entry)の unpaid_history(APP,paid) 実績。
//   - サマリ(件数・金額)を表示し、ブランド別に2つのCSVダウンロードを提供。
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Shift-JIS(CP932)・BOM無しでCSVをダウンロード。encoding-japanese は必要時に動的import。
async function downloadSjis(filename: string, content: string) {
  const Encoding = (await import("encoding-japanese")).default;
  const sjis = Encoding.convert(Encoding.stringToCode(content), { to: "SJIS", from: "UNICODE" });
  const blob = new Blob([new Uint8Array(sjis)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

type Sum = { brand: string; count: number; total: number; error?: string };

// 選択した年月(YYYY-MM) → その月の初日/末日(YYYY-MM-DD)
function monthRange(month: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) return { from: "", to: "" };
  const [y, m] = month.split("-").map(Number);
  const end = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(end).padStart(2, "0")}` };
}
function defaultMonth(d: Date) { const p = new Date(d.getFullYear(), d.getMonth() - 1, 1); return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`; }

const BRANDS = [
  { key: "JOYFIT", color: "#1d4ed8", bg: "#dbeafe" },
  { key: "FIT365", color: "#be185d", bg: "#fce7f3" },
];

export default function AppUnpaidPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "ok" | "forbidden">("loading");
  // 対象年月。SSRとクライアントで new Date() がズレるとハイドレーション不一致になるため、
  // 初期は空にし、マウント後(クライアント)に既定=先月をセットする。
  const [month, setMonth] = useState("");
  useEffect(() => { if (!month) setMonth(defaultMonth(new Date())); }, [month]);
  const { from, to } = monthRange(month);
  const [summary, setSummary] = useState<Sum[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json = await res.json();
        if (res.ok && json?.user?.canViewAccounting) setAuthState("ok");
        else { setAuthState("forbidden"); setTimeout(() => router.replace("/"), 1500); }
      } catch { setAuthState("forbidden"); setTimeout(() => router.replace("/"), 1500); }
    })();
  }, [router]);

  async function loadSummary() {
    setLoading(true); setError(null); setSummary(null);
    try {
      const res = await fetch(`/api/accounting/app-unpaid?from=${from}&to=${to}`, { cache: "no-store" });
      // 応答が空/非JSONでも落ちないよう安全にパースする
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!json) { setError("集計の取得がタイムアウトした可能性があります。時間をおいて「集計を表示」を押すか、CSVは下のボタンから直接ダウンロードできます。"); return; }
      if (!res.ok || !json.ok) { setError(json?.message || json?.error || `取得に失敗 (${res.status})`); return; }
      setSummary(json.summary || []);
    } catch (e: any) { setError(e?.message || "取得に失敗しました"); }
    finally { setLoading(false); }
  }
  // ※ 集計は接続に時間がかかる場合があるため自動実行しない（CSVは集計なしでDL可）。
  //   ユーザーが「集計を表示」を押したときだけ取得する。

  const [dl, setDl] = useState<string | null>(null);
  const COLS = ["会員番号", "金額", "支払日", "支払時刻", "注文ID", "店舗コード", "店舗名", "ブランド"] as const;
  async function downloadCsv(brand: string) {
    setDl(brand); setError(null);
    try {
      const res = await fetch(`/api/accounting/app-unpaid?rows=1&brand=${brand}&from=${from}&to=${to}`, { cache: "no-store" });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!json) { setError("明細の取得がタイムアウトした可能性があります。時間をおいて再度お試しください。"); return; }
      if (!res.ok || !json.ok) { setError(json?.message || json?.error || `取得に失敗 (${res.status})`); return; }
      const rows: any[] = json.rows || [];
      const header = COLS.join(",");
      // 注文IDは長い数値のためExcelで指数表記にならないよう ="..." でテキスト固定
      const lines = rows.map((r) =>
        COLS.map((c) => (c === "注文ID" ? `="${String(r[c]).replace(/"/g, '""')}"` : csvCell(r[c]))).join(",")
      );
      const csv = [header, ...lines].join("\r\n") + "\r\n";
      await downloadSjis(`${brand}_APP未納金支払_${month}.csv`, csv);
    } catch (e: any) { setError(e?.message || "ダウンロードに失敗しました"); }
    finally { setDl(null); }
  }

  if (authState === "loading") return <div style={{ padding: 40, color: "#94a3b8" }}>読み込み中…</div>;
  if (authState === "forbidden") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        <p style={{ fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>経理管理へのアクセス権がありません</p>
        <p style={{ fontSize: 13 }}>経理担当・経理権限をお持ちの方のみ閲覧できます。トップへ戻ります…</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fcfdfe" }}>
      <div style={{ height: 64, background: "rgba(255,255,255,0.9)", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: "100%", maxWidth: 1000, margin: "0 auto", padding: "0 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>APP未納金支払</div>
          <Link href="/accounting" style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e8f0", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b" }}>← 経理管理へ戻る</Link>
        </div>
      </div>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 32px" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "#0ea5e9", background: "#f0f9ff", padding: "4px 10px", borderRadius: 4, marginBottom: 12 }}>APP UNPAID</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>APP未納金支払</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>アプリで支払われた未納金の実績を、JOYFIT / FIT365 それぞれCSV（Shift-JIS）でダウンロードします。</p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 20, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>対象年月（支払日）</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14 }} />
          </label>
          <button onClick={loadSummary} disabled={loading} style={{ padding: "10px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "集計中…（数秒〜十数秒）" : "件数・金額を集計"}
          </button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>※ 集計しなくても下のCSVはダウンロードできます</span>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", marginBottom: 20, color: "#b91c1c", fontSize: 13 }}>
            <strong style={{ fontWeight: 800 }}>取得できませんでした。</strong> {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
          {BRANDS.map((b) => {
            const s = summary?.find((x) => x.brand === b.key);
            return (
              <div key={b.key} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20 }}>
                <div style={{ display: "inline-block", fontSize: 12, fontWeight: 800, color: b.color, background: b.bg, padding: "3px 12px", borderRadius: 999, marginBottom: 12 }}>{b.key}</div>
                <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>件数</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{summary ? (s?.count ?? 0).toLocaleString() : "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>金額</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{summary ? `¥${(s?.total ?? 0).toLocaleString()}` : "—"}</div>
                  </div>
                </div>
                {s?.error && <div style={{ fontSize: 11, color: "#b91c1c", marginBottom: 8 }}>取得エラー: {s.error}</div>}
                <button onClick={() => downloadCsv(b.key)} disabled={dl === b.key} style={{ width: "100%", padding: "10px", background: b.color, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: dl === b.key ? "default" : "pointer", opacity: dl === b.key ? 0.6 : 1 }}>
                  {dl === b.key ? "作成中…（数秒〜十数秒）" : `⬇ ${b.key} APP未納金支払 CSV`}
                </button>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 16 }}>※ CSVは Shift-JIS。列: 会員番号 / 金額 / 支払日 / 支払時刻 / 注文ID / 店舗コード / 店舗名 / ブランド。全店対象・指定期間の全件（最大10万件）。</p>
      </main>
    </div>
  );
}
