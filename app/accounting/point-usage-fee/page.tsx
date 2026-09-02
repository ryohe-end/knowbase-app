"use client";

// 経理: ポイント利用による会費割引のクラブ別集計(手数料2%)。
//   - 対象年月を選択 → adb01(member-search 経由)からクラブ別 使用ポイント合計 + 手数料(2%切捨)を取得
//   - CSV は Shift-JIS(CP932)で出力(会計システム取込用)
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Encoding from "encoding-japanese";

type Row = { クラブコード: string | number; クラブ略称: string; 使用ポイント: number; 手数料: number };

const COLUMNS: { key: keyof Row; label: string; num?: boolean }[] = [
  { key: "クラブコード", label: "クラブコード" },
  { key: "クラブ略称", label: "クラブ略称" },
  { key: "使用ポイント", label: "合計使用ポイント", num: true },
  { key: "手数料", label: "手数料(2%)", num: true },
];

function downloadSjis(filename: string, content: string) {
  const sjis = Encoding.convert(Encoding.stringToCode(content), { to: "SJIS", from: "UNICODE" });
  const blob = new Blob([new Uint8Array(sjis)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function PointUsageFeePage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "ok" | "forbidden">("loading");
  const [months, setMonths] = useState<string[]>([]);
  const [ym, setYm] = useState<string>("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json = await res.json();
        if (res.ok && json?.user?.canViewAccounting) {
          setAuthState("ok");
          // 対象年月一覧を取得
          try {
            const mr = await fetch("/api/accounting/point-usage-fee?mode=months", { cache: "no-store" });
            const mj = await mr.json();
            if (mr.ok && Array.isArray(mj?.months)) {
              setMonths(mj.months);
              if (mj.months.length > 0) setYm(mj.months[0]);
            }
          } catch {}
        } else {
          setAuthState("forbidden");
          setTimeout(() => router.replace("/"), 1500);
        }
      } catch {
        setAuthState("forbidden");
        setTimeout(() => router.replace("/"), 1500);
      }
    })();
  }, [router]);

  const totals = useMemo(() => {
    const t = { 使用ポイント: 0, 手数料: 0 };
    for (const r of rows || []) {
      t.使用ポイント += Number(r.使用ポイント) || 0;
      t.手数料 += Number(r.手数料) || 0;
    }
    return t;
  }, [rows]);

  async function load() {
    if (!/^\d{4}年\d{2}月$/.test(ym)) return;
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const res = await fetch(`/api/accounting/point-usage-fee?ym=${encodeURIComponent(ym)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error || `取得に失敗しました (${res.status})`);
        return;
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!rows || rows.length === 0) return;
    const header = COLUMNS.map((c) => c.label).join(",");
    const lines = rows.map((r) => COLUMNS.map((c) => csvCell(r[c.key])).join(","));
    // 合計行を末尾に付与
    const totalLine = ["合計", "", String(totals.使用ポイント), String(totals.手数料)].join(",");
    const csv = [header, ...lines, totalLine].join("\r\n") + "\r\n";
    downloadSjis(`ポイント利用手数料_${ym}.csv`, csv);
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
          <div style={{ fontWeight: 800, color: "#0f172a" }}>ポイント利用手数料</div>
          <Link href="/accounting" style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e8f0", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b" }}>← 経理管理へ戻る</Link>
        </div>
      </div>

      <main style={{ maxWidth: 1140, margin: "0 auto", padding: "40px 32px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "#0f766e", background: "#f0fdfa", padding: "4px 10px", borderRadius: 4, marginBottom: 12 }}>POINTS</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>ポイント利用手数料（クラブ別）</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>対象年月のポイント利用による会費割引を、クラブ別に「合計使用ポイント」と「手数料(使用ポイント×2%・切捨)」で集計します。</p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 20, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>対象年月</span>
            <select value={ym} onChange={(e) => setYm(e.target.value)} style={{ padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, color: "#0f172a", minWidth: 160 }}>
              {months.length === 0 && <option value="">（年月なし）</option>}
              {months.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <button onClick={load} disabled={loading || !ym} style={{ padding: "10px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading || !ym ? "default" : "pointer", opacity: loading || !ym ? 0.6 : 1 }}>
            {loading ? "集計中…" : "集計を表示"}
          </button>
          <button onClick={download} disabled={!rows || rows.length === 0} style={{ padding: "10px 20px", background: rows && rows.length ? "#0f766e" : "#e2e8f0", color: rows && rows.length ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: rows && rows.length ? "pointer" : "default" }}>
            ⬇ CSVダウンロード
          </button>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", marginBottom: 20, color: "#b91c1c", fontSize: 13 }}>
            <strong style={{ fontWeight: 800 }}>取得できませんでした。</strong> {error}
          </div>
        )}

        {rows && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
              <span style={{ fontWeight: 800, color: "#0f172a" }}>{ym}</span>
              <span style={{ color: "#64748b" }}>{rows.length.toLocaleString()} クラブ ／ 合計使用 {totals.使用ポイント.toLocaleString()}pt ／ 手数料計 ¥{totals.手数料.toLocaleString()}</span>
            </div>
            {rows.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>対象データがありません。</div>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 560 }}>
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
                      <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                        <td style={{ padding: "6px 12px", color: "#334155" }}>{String(r.クラブコード)}</td>
                        <td style={{ padding: "6px 12px", color: "#334155" }}>{r.クラブ略称}</td>
                        <td style={{ padding: "6px 12px", textAlign: "right", color: "#334155" }}>{r.使用ポイント.toLocaleString()}</td>
                        <td style={{ padding: "6px 12px", textAlign: "right", color: "#334155" }}>¥{r.手数料.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ position: "sticky", bottom: 0, background: "#f8fafc", fontWeight: 800 }}>
                      <td style={{ padding: "8px 12px", color: "#0f172a" }} colSpan={2}>合計</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#0f172a" }}>{totals.使用ポイント.toLocaleString()}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#0f172a" }}>¥{totals.手数料.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
