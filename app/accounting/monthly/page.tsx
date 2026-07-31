"use client";

// 月次処理: 振替契約別サマリ(経理連携)を月指定でCSVダウンロードする画面。
//   - 対象月を選択 → adb01(member-search 経由)から集計を取得
//   - CSV は Shift-JIS(CP932)・BOM無しで出力(会計システム取込用)
//   - ファイル名 / 見出しは「経理連携YYYY年MM月」
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Encoding from "encoding-japanese";

type Row = {
  クラブコード: string | number;
  クラブ略称: string;
  業態: string;
  企業名: string;
  振替年月: string | number;
  委託先名: string;
  振替結果: string;
  税率: string | number;
  振替合計: number;
  年管理費合計: number;
  会費合計: number;
  割引合計: number;
};

const COLUMNS: { key: keyof Row; label: string; num?: boolean }[] = [
  { key: "クラブコード", label: "クラブコード" },
  { key: "クラブ略称", label: "クラブ略称" },
  { key: "業態", label: "業態" },
  { key: "企業名", label: "企業名" },
  { key: "振替年月", label: "振替年月" },
  { key: "委託先名", label: "委託先名" },
  { key: "振替結果", label: "振替結果" },
  { key: "税率", label: "税率" },
  { key: "振替合計", label: "振替合計", num: true },
  { key: "年管理費合計", label: "年管理費合計", num: true },
  { key: "会費合計", label: "会費合計", num: true },
  { key: "割引合計", label: "割引合計", num: true },
];

// Shift-JIS(CP932)・BOM無しでCSVをダウンロード(会計システム取込前提)
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

// 既定選択は先月(締めた月を出すことが多いため)。
function defaultMonth(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function MonthlyFurikaePage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "ok" | "forbidden">("loading");
  const [month, setMonth] = useState<string>(() => defaultMonth(new Date()));
  const [rows, setRows] = useState<Row[] | null>(null);
  // 振替データは6委託先(JACCS収金代行/FD自振/オリコ/ソフトバンク/JACCS(FIT)/りそな)が全て
  // 揃って初めて抽出可。ready=false のとき missing に未着の委託先が入る。
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
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

  const ym = month.replace("-", ""); // YYYYMM
  const [y, m] = month.split("-");
  const title = `経理連携${y}年${m}月`;

  const totals = useMemo(() => {
    const t = { 振替合計: 0, 年管理費合計: 0, 会費合計: 0, 割引合計: 0 };
    for (const r of rows || []) {
      t.振替合計 += Number(r.振替合計) || 0;
      t.年管理費合計 += Number(r.年管理費合計) || 0;
      t.会費合計 += Number(r.会費合計) || 0;
      t.割引合計 += Number(r.割引合計) || 0;
    }
    return t;
  }, [rows]);

  async function load() {
    if (!/^\d{6}$/.test(ym)) return;
    setLoading(true);
    setError(null);
    setRows(null);
    setReady(false);
    setMissing([]);
    try {
      const res = await fetch(`/api/accounting/monthly-furikae?ym=${ym}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message || json?.error || `取得に失敗しました (${res.status})`);
        return;
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setReady(!!json.ready);
      setMissing(Array.isArray(json.missing) ? json.missing : []);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!rows || rows.length === 0 || !ready) return;
    const header = COLUMNS.map((c) => c.label).join(",");
    const lines = rows.map((r) => COLUMNS.map((c) => csvCell(r[c.key])).join(","));
    const csv = [header, ...lines].join("\r\n") + "\r\n";
    downloadSjis(`${title}.csv`, csv);
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
          <div style={{ fontWeight: 800, color: "#0f172a" }}>月次処理</div>
          <Link href="/accounting" style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e8f0", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b" }}>← 経理管理へ戻る</Link>
        </div>
      </div>

      <main style={{ maxWidth: 1140, margin: "0 auto", padding: "40px 32px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "#0f766e", background: "#f0fdfa", padding: "4px 10px", borderRadius: 4, marginBottom: 12 }}>MONTHLY</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>月次処理 — 経理連携CSV</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>対象月の振替契約別サマリ(クラブ×振替結果×税率)をCSV(Shift-JIS)で出力します。</p>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 12, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>対象月（振替年月）</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, color: "#0f172a" }} />
          </label>
          <button onClick={load} disabled={loading} style={{ padding: "10px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "確認中…" : "集計を表示"}
          </button>
          <button onClick={download} disabled={!rows || rows.length === 0 || !ready} title={!ready ? "全委託先が揃うまでダウンロードできません" : undefined} style={{ padding: "10px 20px", background: rows && rows.length && ready ? "#0f766e" : "#e2e8f0", color: rows && rows.length && ready ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: rows && rows.length && ready ? "pointer" : "default" }}>
            ⬇ {title}.csv をダウンロード
          </button>
        </div>

        {/* 委託先そろい判定の案内 / 未着があるときの警告 */}
        {rows === null ? (
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 24 }}>
            振替データは6委託先（JACCS収金代行／FD自振／オリコ／ソフトバンク／JACCS(FIT)／りそな）が<strong>全て揃って初めて抽出可能</strong>です（概ね翌月4日までに揃います）。「集計を表示」で状況を確認してください。
          </div>
        ) : ready ? (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "12px 16px", marginBottom: 24, color: "#15803d", fontSize: 12, lineHeight: 1.6 }}>
            ✓ <strong>{y}年{m}月</strong>は6委託先すべて揃っています。ダウンロード可能です。
          </div>
        ) : (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "12px 16px", marginBottom: 24, color: "#b45309", fontSize: 12, lineHeight: 1.6 }}>
            ⚠️ <strong>{y}年{m}月</strong>はまだ<strong>全委託先が揃っていません</strong>（未着：<strong>{missing.length ? missing.join("・") : "データ無し"}</strong>）。全て揃うまでダウンロードできません（概ね翌月4日までに揃います）。
          </div>
        )}

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", marginBottom: 20, color: "#b91c1c", fontSize: 13 }}>
            <strong style={{ fontWeight: 800 }}>取得できませんでした。</strong> {error}
          </div>
        )}

        {rows && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
              <span style={{ fontWeight: 800, color: "#0f172a" }}>{title}</span>
              <span style={{ color: "#64748b" }}>{rows.length.toLocaleString()} 行 ／ 振替合計 ¥{totals.振替合計.toLocaleString()}</span>
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
                    {rows.slice(0, 500).map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                        {COLUMNS.map((c) => (
                          <td key={String(c.key)} style={{ padding: "6px 12px", textAlign: c.num ? "right" : "left", color: "#334155" }}>
                            {c.num ? `¥${(Number(r[c.key]) || 0).toLocaleString()}` : String(r[c.key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 500 && (
                  <div style={{ padding: "8px 14px", fontSize: 11, color: "#94a3b8", borderTop: "1px solid #f1f5f9" }}>先頭 500 行のみ表示（CSVは全 {rows.length.toLocaleString()} 行を出力します）</div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
