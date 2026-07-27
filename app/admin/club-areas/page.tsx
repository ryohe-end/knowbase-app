"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Territory = { territory: string; clubCodes: string[] };
type ClubArea = {
  areaId: string;
  area: string;
  block: string;
  clubCodes: string[];
  territories: Territory[];
  updatedAt?: string;
  updatedBy?: string;
};
type Store = { clubCode: string; clubName: string; brand?: string; prefecture?: string };

const NONE = "__none__";   // このエリアに属さない
const DIRECT = "__direct__"; // 直下(テリトリー未設定)

const EMPTY: ClubArea = { areaId: "", area: "", block: "", clubCodes: [], territories: [] };

export default function ClubAreasPage() {
  const [areas, setAreas] = useState<ClubArea[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<ClubArea | null>(null);
  const [saving, setSaving] = useState(false);
  const [storeQuery, setStoreQuery] = useState("");
  const [newTerr, setNewTerr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [aRes, sRes] = await Promise.all([
        fetch("/api/admin/club-areas", { cache: "no-store" }),
        fetch("/api/store-settings/stores", { cache: "no-store" }),
      ]);
      const aData = await aRes.json();
      if (!aRes.ok || !aData.ok) throw new Error(aData?.error || "一覧取得に失敗しました（権限をご確認ください）");
      setAreas(aData.areas || []);
      const sData = await sRes.json().catch(() => ({}));
      setStores((sData.stores || []).map((s: any) => ({ clubCode: String(s.clubCode), clubName: s.clubName || s.name || "", brand: s.brand, prefecture: s.prefecture })));
    } catch (e: any) {
      setErr(e?.message || "エラー"); setAreas([]);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const storeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stores) m.set(s.clubCode, s.clubName);
    return m;
  }, [stores]);

  // 編集中エリアの clubCode -> slot(NONE/DIRECT/テリトリー名)
  const slotOf = (a: ClubArea, code: string): string => {
    for (const t of a.territories) if (t.clubCodes.includes(code)) return t.territory;
    if (a.clubCodes.includes(code)) return DIRECT;
    return NONE;
  };

  const setSlot = (code: string, slot: string) => {
    if (!edit) return;
    // 全テリトリーから外す
    const territories = edit.territories.map((t) => ({ ...t, clubCodes: t.clubCodes.filter((c) => c !== code) }));
    let clubCodes = edit.clubCodes.filter((c) => c !== code);
    if (slot === DIRECT) {
      clubCodes = [...clubCodes, code];
    } else if (slot !== NONE) {
      const t = territories.find((x) => x.territory === slot);
      if (t) t.clubCodes = [...t.clubCodes, code];
      clubCodes = [...clubCodes, code]; // エリア直下集合にも含める(逆引き用)
    }
    setEdit({ ...edit, territories, clubCodes: [...new Set(clubCodes)] });
  };

  const addTerritory = () => {
    if (!edit) return;
    const name = newTerr.trim();
    if (!name || edit.territories.some((t) => t.territory === name)) { setNewTerr(""); return; }
    setEdit({ ...edit, territories: [...edit.territories, { territory: name, clubCodes: [] }] });
    setNewTerr("");
  };
  const removeTerritory = (name: string) => {
    if (!edit) return;
    // そのテリトリーの店舗は直下に残す(clubCodes は維持)
    setEdit({ ...edit, territories: edit.territories.filter((t) => t.territory !== name) });
  };

  const assignedCount = (a: ClubArea) => new Set(a.clubCodes).size;

  const filteredStores = useMemo(() => {
    if (!edit) return [];
    const q = storeQuery.trim().toLowerCase();
    // 検索なしのときは「このエリアに割当済み」のみ表示（全460店の羅列を防ぐ）
    if (!q) return stores.filter((s) => edit.clubCodes.includes(s.clubCode));
    return stores.filter((s) => `${s.clubCode} ${s.clubName}`.toLowerCase().includes(q));
  }, [stores, storeQuery, edit]);

  const save = async () => {
    if (!edit) return;
    if (!edit.area.trim()) { setErr("エリア名は必須です"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/club-areas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaId: edit.areaId || undefined, area: edit.area, block: edit.block, clubCodes: edit.clubCodes, territories: edit.territories }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "保存に失敗しました");
      setEdit(null); await load();
    } catch (e: any) { setErr(e?.message || "保存エラー"); }
    finally { setSaving(false); }
  };

  const remove = async (a: ClubArea) => {
    if (!window.confirm(`「${a.area}」を削除します。よろしいですか？`)) return;
    try {
      const res = await fetch(`/api/admin/club-areas?areaId=${encodeURIComponent(a.areaId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "削除に失敗しました");
      await load();
    } catch (e: any) { setErr(e?.message || "削除エラー"); }
  };

  const openEdit = (a: ClubArea) => {
    setEdit(JSON.parse(JSON.stringify({ ...EMPTY, ...a })));
    setStoreQuery(""); setNewTerr("");
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ marginBottom: 8 }}>
        <Link href="/admin" style={{ color: "#64748b", textDecoration: "none", fontSize: 13 }}>← 管理者ダッシュボード</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: 0 }}>エリア・テリトリー管理</h1>
        <button onClick={() => openEdit({ ...EMPTY })}
          style={{ background: "linear-gradient(135deg,#334155,#0f172a)", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
          ＋ 新規エリア
        </button>
      </div>
      <p style={{ color: "#64748b", fontSize: 12, marginBottom: 16 }}>課別エリア（例: 関東 第1エリア）と所属テリトリー・店舗を管理します。店舗設定の店舗セレクタのエリア絞り込みに反映されます。</p>

      {err && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ color: "#94a3b8", padding: 24 }}>読み込み中…</div>
      ) : areas.length === 0 ? (
        <div style={{ color: "#94a3b8", padding: 24, textAlign: "center", border: "1px dashed #e2e8f0", borderRadius: 10 }}>
          まだエリアが登録されていません。
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {areas.map((a) => (
            <div key={a.areaId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>{a.area}
                    {a.block && <span style={{ marginLeft: 8, fontSize: 11, color: "#0f766e", background: "#f0fdfa", border: "1px solid #99f6e4", borderRadius: 6, padding: "1px 6px" }}>{a.block}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                    店舗 {assignedCount(a)}件 ・ テリトリー {a.territories.length}件
                  </div>
                  {a.territories.length > 0 && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, lineHeight: 1.7 }}>
                      {a.territories.map((t) => `${t.territory}(${t.clubCodes.length})`).join(" / ")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => openEdit(a)} style={btnGhost}>編集</button>
                  <button onClick={() => remove(a)} style={{ ...btnGhost, color: "#dc2626" }}>削除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <div style={overlay} onClick={() => !saving && setEdit(null)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 12px" }}>{edit.areaId ? "エリアを編集" : "エリアを登録"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <div><label style={lbl}>エリア名 <span style={{ color: "#dc2626" }}>*</span></label>
                <input value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} style={inp} placeholder="例) 関東 第1エリア" /></div>
              <div><label style={lbl}>ブロック</label>
                <input value={edit.block} onChange={(e) => setEdit({ ...edit, block: e.target.value })} style={inp} placeholder="例) 関東" /></div>
            </div>

            <label style={lbl}>テリトリー</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {edit.territories.map((t) => (
                <span key={t.territory} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f1f5f9", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, color: "#334155" }}>
                  {t.territory} <span style={{ color: "#94a3b8" }}>({t.clubCodes.length})</span>
                  <button onClick={() => removeTerritory(t.territory)} style={{ border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontWeight: 800 }}>×</button>
                </span>
              ))}
              {edit.territories.length === 0 && <span style={{ color: "#94a3b8", fontSize: 12 }}>テリトリー未設定（店舗は「直下」で割当）</span>}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input value={newTerr} onChange={(e) => setNewTerr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTerritory())} placeholder="テリトリー名を追加（例: テリトリー1）" style={{ ...inp, flex: 1 }} />
              <button onClick={addTerritory} style={btnGhost}>追加</button>
            </div>

            <label style={lbl}>店舗の割当（{new Set(edit.clubCodes).size}件がこのエリア）</label>
            <input value={storeQuery} onChange={(e) => setStoreQuery(e.target.value)} placeholder="店舗名・コードで検索して割当（未検索時は割当済みのみ表示）" style={{ ...inp, marginBottom: 6 }} />
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8, padding: 4 }}>
              {filteredStores.length === 0 ? (
                <div style={{ color: "#94a3b8", fontSize: 12, padding: 8 }}>{storeQuery ? "該当店舗がありません。" : "まだ割当がありません。検索して店舗を追加してください。"}</div>
              ) : filteredStores.map((s) => {
                const slot = edit ? slotOf(edit, s.clubCode) : NONE;
                return (
                  <div key={s.clubCode} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", fontSize: 13 }}>
                    <span style={{ flex: 1, minWidth: 0, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.clubName} <span style={{ color: "#94a3b8", fontSize: 11 }}>({s.clubCode})</span>
                    </span>
                    <select value={slot} onChange={(e) => setSlot(s.clubCode, e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 6px", fontSize: 12 }}>
                      <option value={NONE}>未所属</option>
                      <option value={DIRECT}>直下（テリトリーなし）</option>
                      {edit.territories.map((t) => <option key={t.territory} value={t.territory}>{t.territory}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setEdit(null)} disabled={saving} style={btnGhost}>キャンセル</button>
              <button onClick={save} disabled={saving || !edit.area.trim()} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 800, cursor: "pointer", opacity: saving || !edit.area.trim() ? 0.5 : 1 }}>
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
const modal: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 620, maxHeight: "92vh", overflowY: "auto" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#475569", margin: "10px 0 4px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" };
