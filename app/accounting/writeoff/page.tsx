"use client";

// 貸倒処理(経理連携): 会員別の 入金済み/未納 請求額CSV(全区分・全件)を提供する。
//   - 全件は31万行と大きく、その場生成はタイムアウトするため、月次バッチ
//     (knowbie-writeoff-batch, 毎月1日 直近3ヶ月を再生成)で S3 に事前生成し、
//     この画面は生成済みファイルを S3 から直接ダウンロードする(署名付きURL)。
//   - 月ごとの種別内訳(入金済み/未納)は必要時にオンデマンドで確認できる。
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type FileItem = { ym: string; filename: string; size: number; lastModified: string | null; rows: number | null; amount: number | null };

const fmtYm = (ym: string) => `${ym.slice(0, 4)}年${ym.slice(4, 6)}月`;
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(b / 1024)}KB`);
// 対象月(処理月) → 対応年月 = 1年1ヶ月前(13ヶ月前)
const shift13 = (ym: string) => {
  const y = Number(ym.slice(0, 4)); const m = Number(ym.slice(4, 6));
  const d = new Date(y, m - 1 - 13, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function WriteoffPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "ok" | "forbidden">("loading");
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

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

  async function loadFiles() {
    setLoadErr(null);
    try {
      const res = await fetch("/api/accounting/writeoff/files", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) { setLoadErr(json?.message || json?.error || `取得に失敗 (${res.status})`); return; }
      setFiles(json.files || []);
    } catch (e: any) { setLoadErr(e?.message || "取得に失敗しました"); }
  }
  useEffect(() => { if (authState === "ok") loadFiles(); }, [authState]);

  async function download(ym: string) {
    setDownloading(ym);
    try {
      const res = await fetch(`/api/accounting/writeoff/files?ym=${ym}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.ok && json.url) window.location.href = json.url;
      else alert(json?.message || json?.error || "ダウンロードURLの取得に失敗しました");
    } catch (e: any) { alert(e?.message || "ダウンロードに失敗しました"); }
    finally { setDownloading(null); }
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
          <div style={{ fontWeight: 800, color: "#0f172a" }}>貸倒処理</div>
          <Link href="/accounting" style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e8f0", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b" }}>← 経理管理へ戻る</Link>
        </div>
      </div>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 32px" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "#b45309", background: "#fffbeb", padding: "4px 10px", borderRadius: 4, marginBottom: 12 }}>WRITE-OFF</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>貸倒処理 — 経理連携CSV</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>会員別の<strong>未納</strong>（貸倒対象）の請求額一覧です。対象月の<strong>1年1ヶ月前</strong>の対応年月分を、毎月1日に直近3ヶ月分自動生成します。下のファイルからダウンロードしてください。</p>
        </div>

        {loadErr && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", marginBottom: 20, color: "#b91c1c", fontSize: 13 }}>
            <strong style={{ fontWeight: 800 }}>取得できませんでした。</strong> {loadErr}
          </div>
        )}

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 800, color: "#0f172a", fontSize: 14 }}>生成済みファイル</span>
            <button onClick={loadFiles} style={{ padding: "5px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontWeight: 700, color: "#64748b", cursor: "pointer" }}>更新</button>
          </div>

          {files === null ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>読み込み中…</div>
          ) : files.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>まだ生成されたファイルがありません（毎月1日に自動生成されます）。</div>
          ) : (
            <div>
              {files.map((f) => (
                <div key={f.ym} style={{ borderTop: "1px solid #f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{fmtYm(f.ym)} <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>（対応年月 {fmtYm(shift13(f.ym))}）</span></div>
                    {(f.rows != null || f.amount != null) && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#b45309", marginTop: 3 }}>
                        未納 {(f.rows ?? 0).toLocaleString()}件{f.amount != null ? ` ／ ¥${f.amount.toLocaleString()}` : ""}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                      {fmtSize(f.size)}{f.lastModified ? ` ・ 生成 ${new Date(f.lastModified).toLocaleString("ja-JP")}` : ""}
                    </div>
                  </div>
                  <button onClick={() => download(f.ym)} disabled={downloading === f.ym} style={{ padding: "8px 18px", background: "#b45309", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: downloading === f.ym ? "default" : "pointer", opacity: downloading === f.ym ? 0.6 : 1 }}>
                    {downloading === f.ym ? "準備中…" : "⬇ ダウンロード"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 12 }}>
          ※ CSVは Shift-JIS・未納（入金区分4）のみです。対応年月＝対象月の1年1ヶ月前で、確定済みのため1日から取得できます。
        </p>
      </main>
    </div>
  );
}
