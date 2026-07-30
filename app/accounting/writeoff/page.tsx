"use client";

// 貸倒処理(経理連携): 対応年月を選び、会員別の 入金済み/未納 請求額を
// 種別内訳で確認 + 全区分(入金済み+未納)の全件を Shift-JIS CSV でダウンロードする画面。
//   - 1か月で約31万行あるため、画面では行プレビューではなく種別内訳(件数・金額)を表示。
//   - CSVは全件をサーバ側で gzip 受信→Shift-JIS 変換→ストリーム配信(このページはDL遷移のみ)。
//   - 入金/未納データは翌月4日以降に確定するため、確定月のみ選択・DL可能。
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Breakdown = { 集計種別: string; 件数: number; 金額: number };

// 振替/入金の確定は翌月4日以降。最新の確定月 = 当月4日を過ぎていれば前月、まだなら前々月。
function latestConfirmedMonth(now: Date): { y: number; m: number; ym: string } {
  const back = now.getDate() < 4 ? 2 : 1;
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return { y, m, ym: `${y}-${String(m).padStart(2, "0")}` };
}

export default function WriteoffPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "ok" | "forbidden">("loading");
  const confirmed = useMemo(() => latestConfirmedMonth(new Date()), []);
  const [month, setMonth] = useState<string>(confirmed.ym);
  const [breakdown, setBreakdown] = useState<Breakdown[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json = await res.json();
        if (res.ok && json?.user?.canViewAccounting) setAuthState("ok");
        else {
          setAuthState("forbidden");
          setTimeout(() => router.replace("/"), 1500);
        }
      } catch {
        setAuthState("forbidden");
        setTimeout(() => router.replace("/"), 1500);
      }
    })();
  }, [router]);

  const ym = month.replace("-", "");
  const [y, m] = month.split("-");
  const title = `貸倒${y}年${m}月`;
  const isConfirmed = month <= confirmed.ym;

  const unpaid = breakdown?.find((b) => b.集計種別 === "未納");
  const paid = breakdown?.find((b) => b.集計種別 === "入金済み");
  const totalCnt = (breakdown || []).reduce((s, b) => s + b.件数, 0);

  async function load() {
    if (!/^\d{6}$/.test(ym)) return;
    setLoading(true);
    setError(null);
    setBreakdown(null);
    try {
      const res = await fetch(`/api/accounting/writeoff?ym=${ym}&summary=1`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || json?.error || `取得に失敗しました (${res.status})`);
        return;
      }
      setBreakdown(Array.isArray(json.breakdown) ? json.breakdown : []);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!isConfirmed) return;
    window.location.href = `/api/accounting/writeoff?ym=${ym}&format=csv`;
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
        <div style={{ width: "100%", maxWidth: 1140, margin: "0 auto", padding: "0 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>貸倒処理</div>
          <Link href="/accounting" style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e8f0", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b" }}>← 経理管理へ戻る</Link>
        </div>
      </div>

      <main style={{ maxWidth: 1140, margin: "0 auto", padding: "40px 32px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "#b45309", background: "#fffbeb", padding: "4px 10px", borderRadius: 4, marginBottom: 12 }}>WRITE-OFF</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>貸倒処理 — 経理連携CSV</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>対応年月ごとに、会員別の入金済み・未納の請求額一覧（全区分）をCSV(Shift-JIS)で出力します。</p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 12, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>対象月（対応年月）</span>
            <input type="month" value={month} max={confirmed.ym} onChange={(e) => setMonth(e.target.value)} style={{ padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, color: "#0f172a" }} />
          </label>
          <button onClick={load} disabled={loading} style={{ padding: "10px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "集計中…" : "集計を表示"}
          </button>
          <button onClick={download} disabled={!isConfirmed} title={!isConfirmed ? "未確定月はダウンロードできません" : undefined} style={{ padding: "10px 20px", background: isConfirmed ? "#b45309" : "#e2e8f0", color: isConfirmed ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isConfirmed ? "pointer" : "default" }}>
            ⬇ {title}.csv をダウンロード（全件）
          </button>
        </div>

        {isConfirmed ? (
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 24 }}>
            入金/未納データは<strong>翌月4日以降</strong>に確定します。ダウンロード可能な最新の確定月は <strong>{confirmed.y}年{String(confirmed.m).padStart(2, "0")}月</strong> です。CSVは入金済み・未納の<strong>全件</strong>を出力します（数万〜数十万行になるためDLに数十秒かかる場合があります）。
          </div>
        ) : (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "12px 16px", marginBottom: 24, color: "#b45309", fontSize: 12, lineHeight: 1.6 }}>
            ⚠️ 選択中の <strong>{y}年{m}月</strong> はまだ<strong>確定していません</strong>（入金/未納データは翌月4日以降に確定）。ダウンロードできません。最新の確定月は <strong>{confirmed.y}年{String(confirmed.m).padStart(2, "0")}月</strong> です。
          </div>
        )}

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", marginBottom: 20, color: "#b91c1c", fontSize: 13 }}>
            <strong style={{ fontWeight: 800 }}>取得できませんでした。</strong> {error}
          </div>
        )}

        {breakdown && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
            <div style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#b45309", marginBottom: 8 }}>未納（貸倒対象）</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a" }}>{(unpaid?.件数 ?? 0).toLocaleString()} <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>件</span></div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#b45309", marginTop: 4 }}>¥{(unpaid?.金額 ?? 0).toLocaleString()}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>入金済み</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a" }}>{(paid?.件数 ?? 0).toLocaleString()} <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>件</span></div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#334155", marginTop: 4 }}>¥{(paid?.金額 ?? 0).toLocaleString()}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>合計（CSV出力対象）</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a" }}>{totalCnt.toLocaleString()} <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>行</span></div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>{title} の全区分</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
