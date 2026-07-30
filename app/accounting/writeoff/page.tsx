"use client";

// 貸倒処理(経理連携): 対応年月を選び、会員別の 入金済み/未納 請求額一覧を
// プレビュー表示 + Shift-JIS CSV でダウンロードする画面。
//   - CSV は会員単位で大量になるため、API 側で全ページ結合してストリーム配信する
//     (このページはダウンロードURLへ遷移させるだけ)。
//   - 振替/入金データは翌月4日以降に確定するため、確定月のみ選択・DL可能。
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

const COLUMNS: { key: keyof Row; label: string; num?: boolean }[] = [
  { key: "対応年月", label: "対応年月" },
  { key: "委託先コード", label: "委託先" },
  { key: "クラブコード", label: "クラブ" },
  { key: "クラブ略称", label: "クラブ略称" },
  { key: "カンパニー名", label: "カンパニー名" },
  { key: "会員番号", label: "会員番号" },
  { key: "集計種別", label: "集計種別" },
  { key: "件数", label: "件数", num: true },
  { key: "請求額合計", label: "請求額合計", num: true },
];

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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
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

  const totals = useMemo(() => {
    const t = { paidAmt: 0, unpaidAmt: 0, unpaidCnt: 0 };
    for (const r of rows || []) {
      if (r.集計種別 === "未納") { t.unpaidAmt += Number(r.請求額合計) || 0; t.unpaidCnt += 1; }
      else t.paidAmt += Number(r.請求額合計) || 0;
    }
    return t;
  }, [rows]);

  async function load() {
    if (!/^\d{6}$/.test(ym)) return;
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const res = await fetch(`/api/accounting/writeoff?ym=${ym}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || json?.error || `取得に失敗しました (${res.status})`);
        return;
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setHasMore(!!json.hasMore);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!isConfirmed) return;
    // 全ページ結合の Shift-JIS CSV はサーバ側でストリーム生成。ブラウザに直接DLさせる。
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
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>対応年月ごとに、会員別の入金済み・未納（＝貸倒対象）の請求額一覧をCSV(Shift-JIS)で出力します。</p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 12, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>対象月（対応年月）</span>
            <input type="month" value={month} max={confirmed.ym} onChange={(e) => setMonth(e.target.value)} style={{ padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, color: "#0f172a" }} />
          </label>
          <button onClick={load} disabled={loading} style={{ padding: "10px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "取得中…" : "プレビュー表示"}
          </button>
          <button onClick={download} disabled={!isConfirmed} title={!isConfirmed ? "未確定月はダウンロードできません" : undefined} style={{ padding: "10px 20px", background: isConfirmed ? "#b45309" : "#e2e8f0", color: isConfirmed ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isConfirmed ? "pointer" : "default" }}>
            ⬇ {title}.csv をダウンロード（全件）
          </button>
        </div>

        {isConfirmed ? (
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 24 }}>
            入金/未納データは<strong>翌月4日以降</strong>に確定します。ダウンロード可能な最新の確定月は <strong>{confirmed.y}年{String(confirmed.m).padStart(2, "0")}月</strong> です。CSVは全件（プレビューは先頭のみ）を出力します。
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

        {rows && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontWeight: 800, color: "#0f172a" }}>{title}（プレビュー）</span>
              <span style={{ color: "#64748b" }}>未納 {totals.unpaidCnt.toLocaleString()}件 ¥{totals.unpaidAmt.toLocaleString()} ／ 入金済み ¥{totals.paidAmt.toLocaleString()}</span>
            </div>
            {rows.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>対象データがありません。</div>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 520 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, whiteSpace: "nowrap" }}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "#f8fafc" }}>
                      {COLUMNS.map((c) => (
                        <th key={String(c.key)} style={{ padding: "8px 12px", textAlign: c.num ? "right" : "left", color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e2e8f0" }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f8fafc", background: r.集計種別 === "未納" ? "#fffdf5" : "#fff" }}>
                        {COLUMNS.map((c) => (
                          <td key={String(c.key)} style={{ padding: "6px 12px", textAlign: c.num ? "right" : "left", color: c.key === "集計種別" && r.集計種別 === "未納" ? "#b45309" : "#334155", fontWeight: c.key === "集計種別" ? 700 : 400 }}>
                            {c.key === "請求額合計" ? `¥${(Number(r[c.key]) || 0).toLocaleString()}` : String(r[c.key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hasMore && (
                  <div style={{ padding: "8px 14px", fontSize: 11, color: "#94a3b8", borderTop: "1px solid #f1f5f9" }}>プレビューは先頭 {rows.length.toLocaleString()} 行のみ。CSVは全件を出力します。</div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
