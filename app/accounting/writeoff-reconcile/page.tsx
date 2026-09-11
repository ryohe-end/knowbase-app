"use client";

// 貸倒対象照合(経理連携): オカモト会員別の 未納・売掛・売上・入金・入金方式別内訳・最終残高を照合。
//   - 既定の貸倒対象 = 未納>0 (SB未納額+口振未納金)。全列(50列)を Shift-JIS CSV で出力。
//   - クエリが重い(~40s)ため、月次バッチ(knowbie-writeoff-reconcile-batch, 毎月1日 直近3ヶ月)で
//     S3 に事前生成し、この画面は生成済みファイルを S3 から直接DL(署名付きURL)する。
//   - 任意の基準月は「今すぐ生成」で非同期生成 → 1〜2分後に「更新」で表示。
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type FileItem = {
  ym: string; scope: "unpaid" | "all"; filename: string; size: number;
  lastModified: string | null; rows: number | null; unpaid: number | null; balance: number | null;
};

const fmtYm = (ym: string) => `${ym.slice(0, 4)}年${ym.slice(4, 6)}月`;
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(b / 1024)}KB`);
function defaultMonth(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function WriteoffReconcilePage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "ok" | "forbidden">("loading");
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(() => defaultMonth(new Date()));
  const [alsoAll, setAlsoAll] = useState(false);
  const [gen, setGen] = useState<{ state: "idle" | "triggering" | "done" | "error"; msg?: string }>({ state: "idle" });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json = await res.json();
        if (res.ok && json?.user?.canViewWriteoffReconcile) setAuthState("ok");
        else { setAuthState("forbidden"); setTimeout(() => router.replace("/"), 1500); }
      } catch { setAuthState("forbidden"); setTimeout(() => router.replace("/"), 1500); }
    })();
  }, [router]);

  async function loadFiles() {
    setLoadErr(null);
    try {
      const res = await fetch("/api/accounting/writeoff-reconcile/files", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) { setLoadErr(json?.message || json?.error || `取得に失敗 (${res.status})`); return; }
      setFiles(json.files || []);
    } catch (e: any) { setLoadErr(e?.message || "取得に失敗しました"); }
  }
  useEffect(() => { if (authState === "ok") loadFiles(); }, [authState]);

  async function download(ym: string, scope: string) {
    const tag = `${ym}:${scope}`;
    setDownloading(tag);
    try {
      const res = await fetch(`/api/accounting/writeoff-reconcile/files?ym=${ym}&scope=${scope}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.ok && json.url) window.location.href = json.url;
      else alert(json?.message || json?.error || "ダウンロードURLの取得に失敗しました");
    } catch (e: any) { alert(e?.message || "ダウンロードに失敗しました"); }
    finally { setDownloading(null); }
  }

  async function generate() {
    const ym = month.replace("-", "");
    if (!/^\d{6}$/.test(ym)) return;
    setGen({ state: "triggering" });
    try {
      const res = await fetch("/api/accounting/writeoff-reconcile/files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym, all: alsoAll }),
      });
      const json = await res.json();
      if (res.ok && json.ok) setGen({ state: "done", msg: `${fmtYm(ym)} の生成を開始しました。約1〜2分後に「更新」で表示されます。` });
      else setGen({ state: "error", msg: json?.message || json?.error || "生成の開始に失敗しました" });
    } catch (e: any) { setGen({ state: "error", msg: e?.message || "生成の開始に失敗しました" }); }
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
          <div style={{ fontWeight: 800, color: "#0f172a" }}>貸倒対象照合</div>
          <Link href="/accounting" style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e8f0", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b" }}>← 経理管理へ戻る</Link>
        </div>
      </div>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 32px" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "#b45309", background: "#fff7ed", padding: "4px 10px", borderRadius: 4, marginBottom: 12 }}>WRITE-OFF RECONCILE</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>貸倒対象照合 — 経理連携CSV</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
            オカモト会員別の 未納・売掛・売上・入金・入金方式別内訳・最終当月末残高を照合します。貸倒対象＝<strong>未納（SB未納額＋口振未納金）＞0</strong>。基準月（当月）を選び、毎月1日に直近3ヶ月を自動生成します。
          </p>
        </div>

        {/* 生成パネル */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>基準月（当月）を指定して生成</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, color: "#0f172a" }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", fontWeight: 700, paddingBottom: 10 }}>
            <input type="checkbox" checked={alsoAll} onChange={(e) => setAlsoAll(e.target.checked)} /> 全件版も生成
          </label>
          <button onClick={generate} disabled={gen.state === "triggering"} style={{ padding: "10px 20px", background: "#b45309", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: gen.state === "triggering" ? "default" : "pointer", opacity: gen.state === "triggering" ? 0.6 : 1 }}>
            {gen.state === "triggering" ? "開始中…" : "今すぐ生成"}
          </button>
          {gen.state === "done" && <span style={{ fontSize: 12, color: "#15803d", fontWeight: 700 }}>✓ {gen.msg}</span>}
          {gen.state === "error" && <span style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>{gen.msg}</span>}
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
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>まだ生成されたファイルがありません。上の「今すぐ生成」か、毎月1日の自動生成をお待ちください。</div>
          ) : (
            <div>
              {files.map((f) => {
                const tag = `${f.ym}:${f.scope}`;
                const isAll = f.scope === "all";
                return (
                  <div key={f.filename} style={{ borderTop: "1px solid #f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                        {fmtYm(f.ym)}
                        <span style={{ fontSize: 10, fontWeight: 800, color: isAll ? "#475569" : "#b45309", background: isAll ? "#f1f5f9" : "#fff7ed", border: `1px solid ${isAll ? "#e2e8f0" : "#fed7aa"}`, borderRadius: 4, padding: "2px 6px" }}>
                          {isAll ? "全件" : "貸倒対象（未納＞0）"}
                        </span>
                      </div>
                      {(f.rows != null || f.unpaid != null) && (
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#b45309", marginTop: 3 }}>
                          {(f.rows ?? 0).toLocaleString()}名
                          {f.unpaid != null ? ` ／ 未納 ¥${f.unpaid.toLocaleString()}` : ""}
                          {f.balance != null ? `（最終残高 ¥${f.balance.toLocaleString()}）` : ""}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                        {fmtSize(f.size)}{f.lastModified ? ` ・ 生成 ${new Date(f.lastModified).toLocaleString("ja-JP")}` : ""}
                      </div>
                    </div>
                    <button onClick={() => download(f.ym, f.scope)} disabled={downloading === tag} style={{ padding: "8px 18px", background: "#b45309", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: downloading === tag ? "default" : "pointer", opacity: downloading === tag ? 0.6 : 1 }}>
                      {downloading === tag ? "準備中…" : "⬇ ダウンロード"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 12, lineHeight: 1.8 }}>
          ※ CSVは Shift-JIS・全50列（未納/売掛/売上/入金/入金方式別内訳/最終当月末残高）です。企業名＝オカモト固定。<br />
          ※ 貸倒対象の未納＝<strong>対応年月が基準月の13ヶ月前（1年1ヶ月前）・入金区分4（今も未回収）の1ヶ月分</strong>（委託先5=SB／それ以外=口振）。売掛・売上・入金方式別は基準月まわりの参考情報です。
        </p>
      </main>
    </div>
  );
}
