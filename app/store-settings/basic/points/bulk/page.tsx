"use client";

// ポイント一括付与: 店舗を選び、フィルタ(性別/来館回数/年代/入会月・在籍/契約形態)で
// 会員を抽出 → 人数プレビュー確認 → 全員同額のポイントを CPSS で一括付与する。
//   - 抽出は DM/Push と同じ会員抽出API(members/extract)を流用。年代は抽出結果に対して絞込。
//   - 付与は points/bulk-grant を 50件ずつ分割送信し、進捗を表示(冪等: batchId)。
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ConditionGroupForm, { type CondGroup, newCondGroup } from "@/components/ConditionGroupForm";
import { type ContractTypeOption } from "@/components/ContractTypePicker";
import { POINT_REASONS } from "@/types/pointTransaction";

type StoreItem = { clubCode: string; clubName: string; brand?: string };
type Extracted = { memberNo: string; name: string; age: number | null; gender: string | null; clubCode: string; contractType: string; withdrawnAt: string | null };

const AGE_BUCKETS = [
  { key: 10, label: "10代" }, { key: 20, label: "20代" }, { key: 30, label: "30代" },
  { key: 40, label: "40代" }, { key: 50, label: "50代" }, { key: 60, label: "60代" }, { key: 70, label: "70代以上" },
];
const CHUNK = 50;

export default function BulkGrantPage() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [clubCode, setClubCode] = useState("");
  const [ctOptions, setCtOptions] = useState<ContractTypeOption[]>([]);
  const [cfOptions, setCfOptions] = useState<ContractTypeOption[]>([]);
  const [ctLoading, setCtLoading] = useState(false);
  const [group, setGroup] = useState<CondGroup>(newCondGroup([]));
  const [ageKeys, setAgeKeys] = useState<Set<number>>(new Set());

  const [members, setMembers] = useState<Extracted[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");

  const [points, setPoints] = useState("");
  const [reason, setReason] = useState<string>(POINT_REASONS[0]);
  const [note, setNote] = useState("");
  const [timing, setTiming] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState(""); // datetime-local (JST)

  type Job = { jobId: string; status: string; clubCode: string; points: number; reason: string; memberCount: number; scheduledAt: string; createdByName?: string; granted?: number; failed?: number };
  const [jobs, setJobs] = useState<Job[]>([]);

  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; granted: number; failed: number } | null>(null);
  const [failures, setFailures] = useState<{ memberCode: string; error?: string }[]>([]);
  const [doneMsg, setDoneMsg] = useState("");

  // 担当店舗ロード
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/store-settings/stores", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const list: StoreItem[] = (data.stores || []).map((s: any) => ({ clubCode: String(s.clubCode), clubName: s.clubName, brand: s.brand }));
        setStores(list);
        if (list.length === 1) setClubCode(list[0].clubCode);
      } catch { /* noop */ }
    })();
  }, []);

  // 店舗選択 → 契約種別/形態をロード。既定は全種別を選択(=絞り込みなし)。
  useEffect(() => {
    if (!clubCode) { setCtOptions([]); setCfOptions([]); return; }
    let cancelled = false;
    (async () => {
      setCtLoading(true);
      try {
        const [ctRes, cfRes] = await Promise.all([
          fetch(`/api/store-settings/members/contract-types?clubCode=${encodeURIComponent(clubCode)}`, { cache: "no-store" }),
          fetch(`/api/store-settings/members/contract-forms?clubCode=${encodeURIComponent(clubCode)}`, { cache: "no-store" }),
        ]);
        const ct = ctRes.ok ? await ctRes.json() : { contractTypes: [] };
        const cf = cfRes.ok ? await cfRes.json() : { contractForms: [] };
        if (cancelled) return;
        const ctAll: ContractTypeOption[] = (ct.contractTypes || []).map((c: any) => ({ name: String(c.name), activeCount: Number(c.activeCount || 0), totalCount: Number(c.totalCount || 0) }));
        const cfAll: ContractTypeOption[] = (cf.contractForms || []).map((c: any) => ({ name: String(c.name), group: String(c.planName || ""), activeCount: Number(c.activeCount || 0), totalCount: Number(c.totalCount || 0) }));
        setCtOptions(ctAll);
        setCfOptions(cfAll);
        // 既定: 全会員区分を選択(絞り込みなし)
        setGroup((g) => ({ ...g, contractTypes: ctAll.map((o) => o.name) }));
      } finally { if (!cancelled) setCtLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [clubCode]);

  const updateGroup = (patch: Partial<CondGroup>) => setGroup((g) => ({ ...g, ...patch }));
  const toggleAge = (k: number) => setAgeKeys((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const inAge = (age: number | null) => {
    if (ageKeys.size === 0) return true; // 年代未指定=全年代
    if (age == null) return false;
    const bucket = age >= 70 ? 70 : Math.floor(age / 10) * 10;
    return ageKeys.has(bucket);
  };

  async function extract() {
    if (!clubCode) { setExtractError("店舗を選択してください。"); return; }
    setExtracting(true); setExtractError(""); setMembers(null); setProgress(null); setDoneMsg("");
    try {
      const res = await fetch("/api/store-settings/members/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryType: "dm", clubCodes: [clubCode], groups: [group], limit: 5000 }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setExtractError(`抽出に失敗しました (${data?.error || res.status})`); return; }
      const all: Extracted[] = (data.members || []).map((m: any) => ({
        memberNo: String(m.memberNo), name: m.name || "", age: m.age ?? null,
        gender: m.gender ?? null, clubCode: String(m.clubCode || clubCode), contractType: m.contractType || "", withdrawnAt: m.withdrawnAt ?? null,
      }));
      const filtered = all.filter((m) => inAge(m.age));
      setMembers(filtered);
      setSelectedIds(new Set(filtered.map((m) => m.memberNo)));
    } catch { setExtractError("抽出リクエストに失敗しました。"); }
    finally { setExtracting(false); }
  }

  const selectedMembers = useMemo(() => (members || []).filter((m) => selectedIds.has(m.memberNo)), [members, selectedIds]);
  const pointsNum = Number(points);
  const scheduleValid = timing === "now" || (!!scheduledAt && Date.parse(scheduledAt) > Date.now());
  const canGrant = !!clubCode && selectedMembers.length > 0 && Number.isInteger(pointsNum) && pointsNum > 0 && POINT_REASONS.includes(reason as any) && scheduleValid;

  // 予約ジョブ一覧
  async function loadJobs(code: string) {
    if (!code) { setJobs([]); return; }
    try {
      const res = await fetch(`/api/store-settings/points/bulk-grant/schedule?clubCode=${encodeURIComponent(code)}`, { cache: "no-store" });
      const d = await res.json();
      if (res.ok && d.ok) setJobs(d.jobs || []);
    } catch { /* noop */ }
  }
  useEffect(() => { loadJobs(clubCode); }, [clubCode]);

  async function scheduleGrant() {
    setConfirming(false);
    const codes = selectedMembers.map((m) => m.memberNo);
    try {
      const res = await fetch("/api/store-settings/points/bulk-grant/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubCode, memberCodes: codes, points: pointsNum, reason, note: note || undefined, scheduledAt: new Date(scheduledAt).toISOString() }),
      });
      const d = await res.json();
      if (res.ok && d.ok) { setDoneMsg(`${d.memberCount}名への付与を ${new Date(d.scheduledAt).toLocaleString("ja-JP")} に予約しました。`); loadJobs(clubCode); }
      else setDoneMsg(`予約に失敗しました: ${d?.error || res.status}`);
    } catch (e: any) { setDoneMsg(`予約に失敗しました: ${e?.message || e}`); }
  }

  async function cancelJob(jobId: string) {
    if (!confirm("この予約を取り消しますか？")) return;
    try {
      const res = await fetch(`/api/store-settings/points/bulk-grant/schedule?jobId=${encodeURIComponent(jobId)}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok || !d.ok) alert(d?.error || "取消に失敗しました");
      loadJobs(clubCode);
    } catch { alert("取消に失敗しました"); }
  }

  async function runGrant() {
    setConfirming(false); setRunning(true); setFailures([]); setDoneMsg("");
    const codes = selectedMembers.map((m) => m.memberNo);
    const batchId = `PB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    let granted = 0, failed = 0; const errs: { memberCode: string; error?: string }[] = [];
    setProgress({ done: 0, total: codes.length, granted: 0, failed: 0 });
    try {
      for (let i = 0; i < codes.length; i += CHUNK) {
        const chunk = codes.slice(i, i + CHUNK);
        const res = await fetch("/api/store-settings/points/bulk-grant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId, clubCode, memberCodes: chunk, points: pointsNum, reason, note: note || undefined }),
        });
        const d = await res.json();
        if (res.ok && d.ok) {
          granted += d.granted; failed += d.failed;
          errs.push(...(d.results || []).filter((r: any) => !r.ok).map((r: any) => ({ memberCode: r.memberCode, error: r.error })));
        } else {
          failed += chunk.length;
          errs.push(...chunk.map((c) => ({ memberCode: c, error: d?.error || `HTTP ${res.status}` })));
        }
        setProgress({ done: Math.min(i + CHUNK, codes.length), total: codes.length, granted, failed });
      }
      setFailures(errs);
      setDoneMsg(`付与完了: 成功 ${granted}件 / 失敗 ${failed}件`);
    } catch (e: any) {
      setDoneMsg(`エラーで中断しました: ${e?.message || e}`);
    } finally { setRunning(false); }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fcfdfe" }}>
      <div style={{ height: 64, background: "rgba(255,255,255,0.9)", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: "100%", maxWidth: 1000, margin: "0 auto", padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>ポイント一括付与</div>
          <Link href="/store-settings/basic/points" style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e8f0", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b" }}>← ポイント管理へ戻る</Link>
        </div>
      </div>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>ポイント一括付与</h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 24px" }}>店舗を選び、条件で会員を抽出して、全員に同じポイントを付与します。付与前に必ず人数と対象を確認してください。</p>

        {/* STEP1: 店舗 + 条件 */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16 }}>
          <div className="dm-field">
            <label>対象店舗</label>
            <select value={clubCode} onChange={(e) => { setClubCode(e.target.value); setMembers(null); }} style={{ width: "100%", maxWidth: 360, border: "1.5px solid #cbd5e1", borderRadius: 6, padding: 8, fontSize: 13, height: 36 }}>
              <option value="">選択してください</option>
              {stores.map((s) => <option key={s.clubCode} value={s.clubCode}>{s.clubName}（{s.clubCode}）</option>)}
            </select>
          </div>

          {clubCode && (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", margin: "12px 0 8px" }}>抽出条件</div>
              <ConditionGroupForm
                group={group}
                onChange={updateGroup}
                contractTypes={ctOptions.map((o) => o.name)}
                contractTypeOptions={ctOptions}
                contractTypesLoading={ctLoading}
                contractFormOptions={cfOptions}
                contractFormsLoading={ctLoading}
                cls="dm"
              />
              <div className="dm-field" style={{ marginTop: 8 }}>
                <label>年代（未選択＝全年代）</label>
                <div className="dm-check-grid">
                  {AGE_BUCKETS.map((b) => (
                    <label key={b.key}><input type="checkbox" checked={ageKeys.has(b.key)} onChange={() => toggleAge(b.key)} />{b.label}</label>
                  ))}
                </div>
              </div>
              <button onClick={extract} disabled={extracting} className="dm-extract-btn" style={{ width: "auto", padding: "10px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: extracting ? "default" : "pointer", marginTop: 8 }}>
                {extracting ? "抽出中…" : "この条件で抽出"}
              </button>
              {extractError && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}>{extractError}</div>}
            </>
          )}
        </div>

        {/* STEP2: プレビュー + 付与設定 */}
        {members && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>抽出結果 {members.length.toLocaleString()}名 ／ 付与対象 <span style={{ color: "#047857" }}>{selectedMembers.length.toLocaleString()}名</span></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSelectedIds(new Set(members.map((m) => m.memberNo)))} style={miniBtn}>全選択</button>
                <button onClick={() => setSelectedIds(new Set())} style={miniBtn}>全解除</button>
              </div>
            </div>

            {members.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>条件に該当する会員がいません。</div>
            ) : (
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ position: "sticky", top: 0, background: "#f8fafc" }}>
                    <th style={thc}></th><th style={thc}>会員番号</th><th style={thc}>氏名</th><th style={thc}>性別</th><th style={thc}>年齢</th><th style={thc}>会員区分</th><th style={thc}>状態</th>
                  </tr></thead>
                  <tbody>
                    {members.slice(0, 1000).map((m) => (
                      <tr key={m.memberNo} style={{ borderTop: "1px solid #f8fafc" }}>
                        <td style={tdc}><input type="checkbox" checked={selectedIds.has(m.memberNo)} onChange={() => setSelectedIds((s) => { const n = new Set(s); n.has(m.memberNo) ? n.delete(m.memberNo) : n.add(m.memberNo); return n; })} /></td>
                        <td style={tdc}><code>{m.memberNo}</code></td>
                        <td style={tdc}>{m.name}</td>
                        <td style={tdc}>{m.gender === "male" ? "男" : m.gender === "female" ? "女" : "—"}</td>
                        <td style={tdc}>{m.age ?? "—"}</td>
                        <td style={tdc}>{m.contractType}</td>
                        <td style={tdc}>{m.withdrawnAt ? "退会" : "在籍"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {members.length > 1000 && <div style={{ padding: "6px 10px", fontSize: 11, color: "#94a3b8" }}>先頭1000名を表示（付与は選択した全員に実行）</div>}
              </div>
            )}

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginTop: 16 }}>
              <div className="dm-field" style={{ marginBottom: 0 }}>
                <label>付与ポイント（全員同額）<span style={{ color: "#ef4444" }}>*</span></label>
                <input type="number" min={1} value={points} onChange={(e) => setPoints(e.target.value)} placeholder="例: 100" style={{ width: 140, border: "1.5px solid #cbd5e1", borderRadius: 6, padding: 8, fontSize: 13, height: 36 }} />
              </div>
              <div className="dm-field" style={{ marginBottom: 0 }}>
                <label>付与理由 <span style={{ color: "#ef4444" }}>*</span></label>
                <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ border: "1.5px solid #cbd5e1", borderRadius: 6, padding: 8, fontSize: 13, height: 36 }}>
                  {POINT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="dm-field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
                <label>メモ（任意）</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="キャンペーン名など" style={{ width: "100%", border: "1.5px solid #cbd5e1", borderRadius: 6, padding: 8, fontSize: 13, height: 36 }} />
              </div>
            </div>

            {/* 付与タイミング */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f1f5f9", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="dm-field" style={{ marginBottom: 0 }}>
                <label>付与タイミング</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className={`kb-seg${timing === "now" ? " on" : ""}`} onClick={() => setTiming("now")}>今すぐ</button>
                  <button type="button" className={`kb-seg${timing === "scheduled" ? " on" : ""}`} onClick={() => setTiming("scheduled")}>日時指定（予約）</button>
                </div>
              </div>
              {timing === "scheduled" && (
                <div className="dm-field" style={{ marginBottom: 0 }}>
                  <label>付与日時<span style={{ color: "#ef4444" }}>*</span></label>
                  <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ border: "1.5px solid #cbd5e1", borderRadius: 6, padding: 8, fontSize: 13, height: 36 }} />
                </div>
              )}
              <button onClick={() => setConfirming(true)} disabled={!canGrant || running} style={{ padding: "10px 22px", background: canGrant && !running ? "#047857" : "#e2e8f0", color: canGrant && !running ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: canGrant && !running ? "pointer" : "default", height: 40 }}>
                {timing === "scheduled" ? "予約する" : "今すぐ一括付与"}
              </button>
            </div>
          </div>
        )}

        {/* 予約一覧 */}
        {jobs.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 12 }}>予約・実行履歴</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  <th style={thc}>付与日時</th><th style={thc}>状態</th><th style={thc}>対象</th><th style={thc}>ポイント</th><th style={thc}>理由</th><th style={thc}>結果</th><th style={thc}></th>
                </tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.jobId} style={{ borderTop: "1px solid #f8fafc" }}>
                      <td style={tdc}>{j.scheduledAt ? new Date(j.scheduledAt).toLocaleString("ja-JP") : "—"}</td>
                      <td style={tdc}><span style={{ fontWeight: 700, color: j.status === "pending" ? "#2563eb" : j.status === "done" ? "#047857" : j.status === "running" ? "#b45309" : "#94a3b8" }}>{jobStatusLabel(j.status)}</span></td>
                      <td style={tdc}>{(j.memberCount ?? 0).toLocaleString()}名</td>
                      <td style={tdc}>{(j.points ?? 0).toLocaleString()}pt</td>
                      <td style={tdc}>{j.reason}</td>
                      <td style={tdc}>{j.status === "done" ? `成功${j.granted ?? 0}/失敗${j.failed ?? 0}` : "—"}</td>
                      <td style={tdc}>{j.status === "pending" && <button onClick={() => cancelJob(j.jobId)} style={{ ...miniBtn, color: "#dc2626", borderColor: "#fecaca" }}>取消</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 進捗 / 結果 */}
        {(running || progress) && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16 }}>
            {progress && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                  進捗 {progress.done.toLocaleString()} / {progress.total.toLocaleString()}（成功 {progress.granted} ／ 失敗 {progress.failed}）
                </div>
                <div style={{ height: 8, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`, background: "#047857" }} />
                </div>
              </>
            )}
            {doneMsg && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: failures.length ? "#b45309" : "#047857" }}>{doneMsg}</div>}
            {failures.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 160, overflowY: "auto", fontSize: 12, color: "#b91c1c" }}>
                {failures.slice(0, 100).map((f, i) => <div key={i}>会員 {f.memberCode}: {f.error || "失敗"}</div>)}
                {failures.length > 100 && <div>ほか {failures.length - 100} 件…</div>}
              </div>
            )}
          </div>
        )}
      </main>

      {/* 確認モーダル */}
      {confirming && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={() => setConfirming(false)}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 420, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{timing === "scheduled" ? "予約付与の確認" : "一括付与の確認"}</h3>
            <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.8, margin: "0 0 16px" }}>
              <b>{selectedMembers.length.toLocaleString()}名</b> に <b>{pointsNum.toLocaleString()}pt</b>（{reason}）を付与します。<br />
              合計 <b>{(pointsNum * selectedMembers.length).toLocaleString()}pt</b>。
              {timing === "scheduled"
                ? <><br /><b>{scheduledAt ? new Date(scheduledAt).toLocaleString("ja-JP") : ""}</b> に実行を予約します。よろしいですか？</>
                : <>この操作は会員のポイント残高を実際に増やします。よろしいですか？</>}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirming(false)} style={{ padding: "9px 16px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#64748b", cursor: "pointer" }}>キャンセル</button>
              <button onClick={timing === "scheduled" ? scheduleGrant : runGrant} style={{ padding: "9px 18px", background: "#047857", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{timing === "scheduled" ? "予約する" : "付与する"}</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .dm-field { margin-bottom: 16px; }
        .dm-field label { display: block; font-size: 11px; font-weight: 700; margin-bottom: 4px; color: #64748b; }
        .dm-row-2 { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
        .dm-row-2 > input { flex: 1; min-width: 0; box-sizing: border-box; border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 6px; font-size: 12px; height: 34px; }
        .dm-row-2 > span { flex: 0 0 auto; font-size: 11px; color: #94a3b8; }
        .dm-check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; align-items: start; }
        .dm-check-grid input { flex: 0 0 auto; margin: 0; }
        .dm-check-grid label { font-size: 12px; font-weight: 600; color: #334155; display: flex; align-items: center; gap: 6px; cursor: pointer; line-height: 1.4; }
        .dm-label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .dm-bulk-toggle { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #94a3b8; }
        .dm-bulk-toggle button { background: none; border: none; padding: 0; font-size: 11px; font-weight: 700; color: #0f172a; cursor: pointer; text-decoration: underline; }
        .mt-2 { margin-top: 8px; }
      `}</style>
    </div>
  );
}

function jobStatusLabel(s: string): string {
  return s === "pending" ? "予約中" : s === "running" ? "実行中" : s === "done" ? "完了" : s === "canceled" ? "取消" : s;
}

const miniBtn: React.CSSProperties = { padding: "5px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontWeight: 700, color: "#64748b", cursor: "pointer" };
const thc: React.CSSProperties = { padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const tdc: React.CSSProperties = { padding: "5px 10px", color: "#334155", whiteSpace: "nowrap" };
