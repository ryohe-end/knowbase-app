"use client";
// 入会管理(店舗詳細管理): クラブの契約ごとに「入会可否 ON/OFF」＋契約マスタ(違約金フルセット)を管理。
// 一覧の土台は Oracle 近似(直近入会実績)、ON/OFF・違約金は Knowbase が権威保持。
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Penalty = {
  penaltyAmount?: number; penaltyFormula?: string; minTermMonths?: number;
  earlyCancelAllowed?: boolean; adminFee?: number; cancelFee?: number;
  depositRefundable?: boolean; campaignLockMonths?: number;
};
type Contract = {
  contractFormCode: string; name?: string; memberKubun?: any; termMonths?: any;
  sortNo?: any; recentSignups?: number; latestSignupDate?: string | null;
  enrollEnabled: boolean; penalty: Penalty; hasOverride?: boolean; approxAbsent?: boolean;
};

const yen = (n?: number) => (typeof n === "number" ? `¥${n.toLocaleString()}` : "—");

export default function EnrollmentAdminPage() {
  const clubCode = (useSearchParams().get("clubCode") || "").trim();
  const [rows, setRows] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubCode) { setLoading(false); return; }
    setLoading(true); setMsg(null);
    try {
      const res = await fetch(`/api/store-settings/admin-portal/enrollment?clubCode=${encodeURIComponent(clubCode)}`);
      const d = await res.json();
      if (res.ok && d.ok) setRows(d.contracts || []);
      else setMsg({ ok: false, text: d.error || "取得に失敗しました" });
    } catch { setMsg({ ok: false, text: "取得に失敗しました" }); }
    finally { setLoading(false); }
  }, [clubCode]);
  useEffect(() => { load(); }, [load]);

  const patchRow = (code: string, patch: Partial<Contract>) =>
    setRows((prev) => prev.map((r) => (r.contractFormCode === code ? { ...r, ...patch } : r)));
  const patchPenalty = (code: string, key: keyof Penalty, val: any) =>
    setRows((prev) => prev.map((r) => (r.contractFormCode === code ? { ...r, penalty: { ...r.penalty, [key]: val } } : r)));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const settings = rows.map((r) => ({
        contractFormCode: r.contractFormCode, name: r.name, memberKubun: r.memberKubun,
        termMonths: r.termMonths, sortNo: r.sortNo, enrollEnabled: r.enrollEnabled, penalty: r.penalty,
      }));
      const res = await fetch(`/api/store-settings/admin-portal/enrollment?clubCode=${encodeURIComponent(clubCode)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }),
      });
      const d = await res.json();
      if (res.ok && d.ok) { setMsg({ ok: true, text: `保存しました（${d.saved}件）` }); load(); }
      else setMsg({ ok: false, text: d.error || "保存に失敗しました" });
    } catch { setMsg({ ok: false, text: "保存に失敗しました" }); }
    finally { setSaving(false); }
  };

  const numInput = (val: number | undefined, on: (v: number | undefined) => void, ph = "") => (
    <input type="number" value={val ?? ""} placeholder={ph}
      onChange={(e) => on(e.target.value === "" ? undefined : Number(e.target.value))}
      style={inp} />
  );
  const toggle = (checked: boolean, on: (v: boolean) => void, label?: string) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <span onClick={() => on(!checked)} style={{
        width: 42, height: 24, borderRadius: 999, background: checked ? "#22c55e" : "#cbd5e1",
        position: "relative", transition: "background .15s", flexShrink: 0,
      }}>
        <span style={{ position: "absolute", top: 2, left: checked ? 20 : 2, width: 20, height: 20, borderRadius: 999, background: "#fff", transition: "left .15s" }} />
      </span>
      {label && <span style={{ fontSize: 14 }}>{label}</span>}
    </label>
  );

  if (!clubCode) {
    return (
      <div style={wrap}>
        <p>店舗が指定されていません。<Link href="/store-settings" style={{ color: "#2563eb" }}>店舗設定トップ</Link>から店舗を選んでください。</p>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <Link href="/store-settings/admin-portal" style={{ color: "#64748b", textDecoration: "none" }}>← 戻る</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>入会管理</h1>
        <span style={{ color: "#64748b", fontSize: 14 }}>クラブ {clubCode}</span>
      </div>
      <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>
        契約形態ごとに入会可否を切り替え、違約金などの契約マスタを設定します。一覧は直近入会実績からの近似で、
        <b>ON/OFF と違約金は Knowbase の設定が優先（権威）</b>です。
      </p>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 14,
          background: msg.ok ? "#ecfdf5" : "#fef2f2", color: msg.ok ? "#065f46" : "#991b1b",
          border: `1px solid ${msg.ok ? "#a7f3d0" : "#fecaca"}` }}>{msg.text}</div>
      )}

      {loading ? (
        <p style={{ color: "#64748b" }}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "#64748b" }}>このクラブの契約が見つかりませんでした（直近{12}ヶ月の入会実績なし）。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => {
            const open = expanded === r.contractFormCode;
            return (
              <div key={r.contractFormCode} style={{ border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {r.name || r.contractFormCode}
                      <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 13, marginLeft: 8 }}>#{r.contractFormCode}</span>
                    </div>
                    <div style={{ color: "#64748b", fontSize: 12, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {r.memberKubun != null && <span>区分 {String(r.memberKubun)}</span>}
                      {r.termMonths != null && <span>期間 {String(r.termMonths)}ヶ月</span>}
                      <span>直近入会 {r.recentSignups ?? 0}件</span>
                      {r.approxAbsent && <span style={{ color: "#b45309" }}>※近年実績なし（設定のみ）</span>}
                      {r.hasOverride && <span style={{ color: "#2563eb" }}>設定済み</span>}
                    </div>
                  </div>
                  {toggle(r.enrollEnabled, (v) => patchRow(r.contractFormCode, { enrollEnabled: v }), r.enrollEnabled ? "入会可" : "入会停止")}
                  <button onClick={() => setExpanded(open ? null : r.contractFormCode)}
                    style={{ border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>
                    {open ? "閉じる" : "違約金設定"}
                  </button>
                </div>

                {open && (
                  <div style={{ borderTop: "1px solid #f1f5f9", background: "#f8fafc", padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div><label style={lbl}>違約金額</label>{numInput(r.penalty.penaltyAmount, (v) => patchPenalty(r.contractFormCode, "penaltyAmount", v), "例: 10000")}</div>
                    <div><label style={lbl}>最低契約期間(月)</label>{numInput(r.penalty.minTermMonths, (v) => patchPenalty(r.contractFormCode, "minTermMonths", v), "例: 12")}</div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={lbl}>違約金 計算式（任意）</label>
                      <input type="text" value={r.penalty.penaltyFormula ?? ""} placeholder="例: 残契約月数 × 月会費 × 0.5"
                        onChange={(e) => patchPenalty(r.contractFormCode, "penaltyFormula", e.target.value || undefined)} style={inp} />
                    </div>
                    <div><label style={lbl}>事務手数料</label>{numInput(r.penalty.adminFee, (v) => patchPenalty(r.contractFormCode, "adminFee", v))}</div>
                    <div><label style={lbl}>解約手数料</label>{numInput(r.penalty.cancelFee, (v) => patchPenalty(r.contractFormCode, "cancelFee", v))}</div>
                    <div><label style={lbl}>キャンペーン縛り期間(月)</label>{numInput(r.penalty.campaignLockMonths, (v) => patchPenalty(r.contractFormCode, "campaignLockMonths", v))}</div>
                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                      {toggle(r.penalty.earlyCancelAllowed ?? false, (v) => patchPenalty(r.contractFormCode, "earlyCancelAllowed", v), "中途解約可")}
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                      {toggle(r.penalty.depositRefundable ?? false, (v) => patchPenalty(r.contractFormCode, "depositRefundable", v), "保証金返還可")}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ position: "sticky", bottom: 0, marginTop: 20, padding: "14px 0", background: "linear-gradient(transparent,#fff 40%)" }}>
          <button onClick={save} disabled={saving}
            style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "12px 28px", fontSize: 15, fontWeight: 600, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? "保存中…" : "設定を保存"}
          </button>
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { maxWidth: 860, margin: "0 auto", padding: "24px 20px 80px" };
const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, color: "#475569", marginBottom: 4, fontWeight: 600 };
