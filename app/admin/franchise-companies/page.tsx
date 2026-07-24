"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type FranchiseCompany = {
  companyId: string;
  name: string;
  clubCodes: string[];
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
};

type Store = { clubCode: string; clubName: string; ownership?: string; companyGroup?: string; brandGroup?: string };

const EMPTY: FranchiseCompany = { companyId: "", name: "", clubCodes: [] };

export default function FranchiseCompaniesPage() {
  const [companies, setCompanies] = useState<FranchiseCompany[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<FranchiseCompany | null>(null);
  const [saving, setSaving] = useState(false);
  const [storeQuery, setStoreQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [cRes, sRes] = await Promise.all([
        fetch("/api/admin/franchise-companies", { cache: "no-store" }),
        fetch("/api/store-settings/stores", { cache: "no-store" }),
      ]);
      const cData = await cRes.json();
      if (!cRes.ok || !cData.ok) throw new Error(cData?.error || "一覧取得に失敗しました（権限をご確認ください）");
      setCompanies(cData.companies || []);
      const sData = await sRes.json().catch(() => ({}));
      // 加盟店(FC)店舗のみ対象
      const fc = (sData.stores || []).filter((s: Store) => (s.ownership || "") === "FC" || String(s.companyGroup || "").toUpperCase().startsWith("FC"));
      setStores(fc);
    } catch (e: any) {
      setErr(e?.message || "エラー");
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const storeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stores) m.set(s.clubCode, s.clubName);
    return m;
  }, [stores]);

  const filteredStores = useMemo(() => {
    const q = storeQuery.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) => `${s.clubCode} ${s.clubName}`.toLowerCase().includes(q));
  }, [stores, storeQuery]);

  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { setErr("企業名は必須です"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/franchise-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "保存に失敗しました");
      setEdit(null);
      await load();
    } catch (e: any) {
      setErr(e?.message || "保存エラー");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: FranchiseCompany) => {
    if (!window.confirm(`「${c.name}」を削除します。よろしいですか？`)) return;
    try {
      const res = await fetch(`/api/admin/franchise-companies?companyId=${encodeURIComponent(c.companyId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "削除に失敗しました");
      await load();
    } catch (e: any) {
      setErr(e?.message || "削除エラー");
    }
  };

  const toggleClub = (code: string) => {
    if (!edit) return;
    const set = new Set(edit.clubCodes);
    if (set.has(code)) set.delete(code); else set.add(code);
    setEdit({ ...edit, clubCodes: [...set] });
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <Link href="/admin" style={{ color: "#64748b", textDecoration: "none", fontSize: 13 }}>← 管理者ダッシュボード</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: 0 }}>加盟店企業マスタ</h1>
        <button onClick={() => { setEdit({ ...EMPTY }); setStoreQuery(""); }}
          style={{ background: "linear-gradient(135deg,#334155,#0f172a)", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
          ＋ 新規登録
        </button>
      </div>
      <p style={{ color: "#64748b", fontSize: 12, marginBottom: 16 }}>加盟店(FC)を運営する企業を横断で登録・管理します。1企業に複数のFC店舗を紐付けできます。</p>

      {err && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ color: "#94a3b8", padding: 24 }}>読み込み中…</div>
      ) : companies.length === 0 ? (
        <div style={{ color: "#94a3b8", padding: 24, textAlign: "center", border: "1px dashed #e2e8f0", borderRadius: 10 }}>
          まだ加盟店企業が登録されていません。「新規登録」から追加してください。
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {companies.map((c) => (
            <div key={c.companyId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                    店舗 {c.clubCodes.length}件
                    {c.contactName ? ` ・ 担当: ${c.contactName}` : ""}
                    {c.contactEmail ? ` ・ ${c.contactEmail}` : ""}
                  </div>
                  {c.clubCodes.length > 0 && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, lineHeight: 1.7 }}>
                      {c.clubCodes.slice(0, 12).map((cc) => storeName.get(cc) || cc).join(" / ")}
                      {c.clubCodes.length > 12 ? ` 他${c.clubCodes.length - 12}店` : ""}
                    </div>
                  )}
                  {c.note && <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>📝 {c.note}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => { setEdit({ ...c }); setStoreQuery(""); }} style={btnGhost}>編集</button>
                  <button onClick={() => remove(c)} style={{ ...btnGhost, color: "#dc2626" }}>削除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <div style={overlay} onClick={() => !saving && setEdit(null)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 12px" }}>{edit.companyId ? "加盟店企業を編集" : "加盟店企業を登録"}</h3>
            <label style={lbl}>企業名 <span style={{ color: "#dc2626" }}>*</span></label>
            <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={inp} placeholder="例) ファイコム" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={lbl}>担当者</label><input value={edit.contactName || ""} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} style={inp} /></div>
              <div><label style={lbl}>電話</label><input value={edit.contactPhone || ""} onChange={(e) => setEdit({ ...edit, contactPhone: e.target.value })} style={inp} /></div>
            </div>
            <label style={lbl}>メール</label>
            <input value={edit.contactEmail || ""} onChange={(e) => setEdit({ ...edit, contactEmail: e.target.value })} style={inp} />
            <label style={lbl}>メモ</label>
            <textarea value={edit.note || ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} style={{ ...inp, minHeight: 60 }} />

            <label style={lbl}>所属FC店舗（{edit.clubCodes.length}件選択中）</label>
            <input value={storeQuery} onChange={(e) => setStoreQuery(e.target.value)} placeholder="店舗名・コードで絞り込み" style={{ ...inp, marginBottom: 6 }} />
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
              {filteredStores.length === 0 ? (
                <div style={{ color: "#94a3b8", fontSize: 12, padding: 8 }}>該当する加盟店店舗がありません。</div>
              ) : filteredStores.map((s) => (
                <label key={s.clubCode} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={edit.clubCodes.includes(s.clubCode)} onChange={() => toggleClub(s.clubCode)} />
                  <span style={{ color: "#334155" }}>{s.clubName}</span>
                  <span style={{ color: "#94a3b8", fontSize: 11 }}>({s.clubCode})</span>
                </label>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setEdit(null)} disabled={saving} style={btnGhost}>キャンセル</button>
              <button onClick={save} disabled={saving || !edit.name.trim()} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 800, cursor: "pointer", opacity: saving || !edit.name.trim() ? 0.5 : 1 }}>
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnGhost: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#475569", cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#475569", margin: "10px 0 4px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" };
