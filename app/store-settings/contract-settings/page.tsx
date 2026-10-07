"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import StoreSelector from "@/components/StoreSelector";

type Row = {
  contractFormCode: string;
  name: string;
  memberKubun: number;
  enabled: boolean | null;
  isPreOpenContract: boolean | null;
  familyAllowed: boolean | null;
  description: string;
  penalty: number | null;
  updatedAt: string | null;
};

function TriToggle({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  // null(未設定) / true / false の3値トグル
  const opts: { v: boolean | null; label: string }[] = [
    { v: null, label: "未設定" },
    { v: true, label: "ON" },
    { v: false, label: "OFF" },
  ];
  return (
    <div style={{ display: "inline-flex", border: "1px solid #d1d5db", borderRadius: 7, overflow: "hidden" }}>
      {opts.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          style={{
            fontSize: 11, padding: "4px 9px", border: "none", cursor: "pointer",
            background: value === o.v ? (o.v === true ? "#16a34a" : o.v === false ? "#64748b" : "#e5e7eb") : "#fff",
            color: value === o.v ? (o.v === null ? "#374151" : "#fff") : "#6b7280",
            fontWeight: value === o.v ? 700 : 500,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

function Editor({ clubCode }: { clubCode: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    fetch(`/api/store-settings/contract-settings?clubCode=${encodeURIComponent(clubCode)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; if (d.ok) setRows(d.contracts || []); else setErr(d.error || "取得に失敗しました"); })
      .catch(() => alive && setErr("取得に失敗しました"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [clubCode]);

  const patch = (code: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.contractFormCode === code ? { ...r, ...p } : r)));

  const save = useCallback(async (row: Row) => {
    setSavingCode(row.contractFormCode); setMsg(null);
    try {
      const res = await fetch("/api/store-settings/contract-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clubCode, contractFormCode: row.contractFormCode,
          enabled: row.enabled, isPreOpenContract: row.isPreOpenContract, familyAllowed: row.familyAllowed,
          description: row.description, penalty: row.penalty,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "保存に失敗しました");
      setMsg(`${row.name} を保存しました`);
    } catch (e: any) {
      setMsg(e?.message || "保存に失敗しました");
    } finally {
      setSavingCode(null);
    }
  }, [clubCode]);

  return (
    <div style={{ padding: 24, background: "#f9fafb", minHeight: "100vh" }}>
      <Link href="/store-settings/contract-settings" style={{ fontSize: 13, color: "#2563eb", textDecoration: "none" }}>← 店舗選択へ戻る</Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "8px 0 2px" }}>入会管理（契約別設定）</h1>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 16 }}>
        クラブ {clubCode}。Oracleマスタに無い項目（プレオープン/家族可否/説明文/募集ON-OFF/違約金）をここで入力します。公開API <code>/contracts</code> に反映されます。
      </p>
      {loading ? <div>読み込み中…</div> : err ? <div style={{ color: "#dc2626" }}>{err}</div> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                <th style={{ padding: "10px 12px" }}>契約形態</th>
                <th style={{ padding: "10px 12px" }}>募集</th>
                <th style={{ padding: "10px 12px" }}>プレオープン</th>
                <th style={{ padding: "10px 12px" }}>家族可否</th>
                <th style={{ padding: "10px 12px" }}>説明文</th>
                <th style={{ padding: "10px 12px" }}>違約金(円)</th>
                <th style={{ padding: "10px 12px" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contractFormCode} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>#{r.contractFormCode} / 区分{r.memberKubun}</div>
                  </td>
                  <td style={{ padding: "8px 12px" }}><TriToggle value={r.enabled} onChange={(v) => patch(r.contractFormCode, { enabled: v })} /></td>
                  <td style={{ padding: "8px 12px" }}><TriToggle value={r.isPreOpenContract} onChange={(v) => patch(r.contractFormCode, { isPreOpenContract: v })} /></td>
                  <td style={{ padding: "8px 12px" }}><TriToggle value={r.familyAllowed} onChange={(v) => patch(r.contractFormCode, { familyAllowed: v })} /></td>
                  <td style={{ padding: "8px 12px" }}>
                    <input value={r.description} onChange={(e) => patch(r.contractFormCode, { description: e.target.value })}
                      style={{ width: 220, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12 }} placeholder="説明文" />
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <input type="number" value={r.penalty ?? ""} onChange={(e) => patch(r.contractFormCode, { penalty: e.target.value === "" ? null : Number(e.target.value) })}
                      style={{ width: 90, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12 }} placeholder="—" />
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <button type="button" onClick={() => save(r)} disabled={savingCode === r.contractFormCode}
                      style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 7, border: "none", color: "#fff", background: "#2563eb", cursor: "pointer", opacity: savingCode === r.contractFormCode ? 0.6 : 1 }}>
                      {savingCode === r.contractFormCode ? "保存中…" : "保存"}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} style={{ padding: 20, color: "#94a3b8" }}>直近に契約実績のある契約形態がありません。</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {msg && <div style={{ marginTop: 12, fontSize: 13, color: "#0d9488" }}>{msg}</div>}
    </div>
  );
}

function Router() {
  const sp = useSearchParams();
  const clubCode = sp.get("clubCode");
  if (!clubCode) {
    return (
      <StoreSelector basePath="/store-settings/contract-settings" title="入会管理 - 店舗選択" backHref="/store-settings" backLabel="店舗設定へ戻る" />
    );
  }
  return <Editor clubCode={clubCode} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f9fafb" }} />}>
      <Router />
    </Suspense>
  );
}
