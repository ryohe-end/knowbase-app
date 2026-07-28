"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import { useToast } from "@/components/Toast";

type Club = { clubCode: string; name: string };
type BaseTier = { validMinutes: number; price: number | null };
type Campaign = { validMinutes: number; price: number; startDate: string; endDate: string; _key: string; saved?: boolean; origStart?: string; void?: boolean };

const PRICE_MIN = 100;
const PRICE_MAX = 20000;
const FOREVER = "99999999";
const OPEN_THRESHOLD = "20800101";
const dur = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60}時間` : `${m}分`);
const toInput = (s: string) => (/^\d{8}$/.test(s) && s !== FOREVER ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");
const fromInput = (s: string) => s.replace(/-/g, "");
const fmtYmd = (s: string) => (s === FOREVER ? "以降ずっと" : /^\d{8}$/.test(s) ? `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}` : s);
const isOpenEnded = (c: { endDate: string }) => c.endDate >= OPEN_THRESHOLD;
let kc = 0; const nextKey = () => `c${++kc}`;

/**
 * JOYFIT OneTimePass 時間別価格エディタ本体。
 * 独自のページchrome(ヘッダー/戻るリンク)は持たず、タブパネルとして描画できる。
 * ロジック・API・スタイル(.jot-*)は元の standalone ページと同一。
 */
export default function JoyfitOneTimePassEditor({ clubCode }: { clubCode?: string } = {}) {
  const { showToast } = useToast();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [tiers, setTiers] = useState<number[]>([30, 60, 90, 120, 150, 180, 210]);
  const [today, setToday] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<string | null>(null);
  const [clubName, setClubName] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [base, setBase] = useState<BaseTier[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/store-settings/joyfit-onetimepass");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "取得に失敗しました");
      setClubs(d.clubs || []); setTiers(d.tiers || tiers); setToday(d.today || ""); setIsAdmin(!!d.isAdmin);
    } catch (e: any) { showToast(e?.message || "一覧の取得に失敗しました", "error"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);
  useEffect(() => { fetchList(); }, [fetchList]);

  const openClub = useCallback(async (c: Club) => {
    setSelected(c.clubCode); setClubName(c.name); setDetailLoading(true);
    try {
      const res = await fetch(`/api/store-settings/joyfit-onetimepass?clubCode=${c.clubCode}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "取得に失敗しました");
      if (d.today) setToday(d.today);
      setTiers(d.tiers || tiers);
      setBase((d.base || []).map((b: any) => ({ validMinutes: b.validMinutes, price: b.price })));
      setCampaigns((d.campaigns || []).map((c: any) => ({ ...c, _key: nextKey(), saved: true, origStart: c.startDate })));
    } catch (e: any) { showToast(e?.message || "詳細の取得に失敗しました", "error"); setSelected(null); }
    finally { setDetailLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  // clubCode 指定時: 一覧取得後にその店舗を自動で開く(内部ピッカーは隠す)
  useEffect(() => {
    if (!clubCode || selected || clubs.length === 0) return;
    const c = clubs.find((x) => x.clubCode === clubCode);
    if (c) openClub(c);
    else openClub({ clubCode, name: clubCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubCode, clubs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clubs.filter((c) => !q || c.name.toLowerCase().includes(q) || c.clubCode.includes(q));
  }, [clubs, search]);

  const setBasePrice = (vm: number, price: number) => setBase((prev) => prev.map((b) => (b.validMinutes === vm ? { ...b, price } : b)));
  const updateCampaign = (key: string, patch: Partial<Campaign>) => setCampaigns((prev) => prev.map((c) => (c._key === key ? { ...c, ...patch } : c)));
  const addBounded = () => setCampaigns((prev) => [...prev, { validMinutes: tiers[0], price: 0, startDate: today, endDate: today, _key: nextKey() }]);
  const addScheduled = () => setCampaigns((prev) => [...prev, { validMinutes: tiers[0], price: 0, startDate: today, endDate: FOREVER, _key: nextKey() }]);
  const removeCampaign = (key: string) =>
    setCampaigns((prev) => {
      const c = prev.find((x) => x._key === key);
      if (c && c.saved) return prev.map((x) => (x._key === key ? { ...x, void: true } : x)); // 保存済みは無効化
      return prev.filter((x) => x._key !== key); // 未保存は除去
    });

  // 重複: 同一tier内で期間が重なるペア
  const overlaps = useMemo(() => {
    const act = campaigns.filter((c) => !c.void && /^\d{8}$/.test(c.startDate));
    const out: string[] = [];
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const a = act[i], b = act[j];
      if (a.validMinutes !== b.validMinutes) continue;
      const ae = isOpenEnded(a) ? FOREVER : a.endDate, be = isOpenEnded(b) ? FOREVER : b.endDate;
      if (a.startDate <= be && b.startDate <= ae) out.push(`${dur(a.validMinutes)}: ${fmtYmd(a.startDate)}〜 と ${fmtYmd(b.startDate)}〜`);
    }
    return out;
  }, [campaigns]);

  const validate = (): string | null => {
    for (const b of base) if (b.price != null && (!Number.isInteger(b.price) || b.price < PRICE_MIN || b.price > PRICE_MAX)) return `通常価格は ¥${PRICE_MIN}〜¥${PRICE_MAX} で入力してください。`;
    for (const c of campaigns) {
      if (c.void) continue;
      if (!Number.isInteger(c.price) || c.price < PRICE_MIN || c.price > PRICE_MAX) return `予約価格は ¥${PRICE_MIN}〜¥${PRICE_MAX} で入力してください。`;
      if (!/^\d{8}$/.test(c.startDate) || !/^\d{8}$/.test(c.endDate)) return "適用期間の日付を入力してください。";
      if (c.startDate > c.endDate) return "終了日は開始日以降にしてください。";
    }
    return null;
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/store-settings/joyfit-onetimepass", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clubCode: selected,
          base: base.filter((b) => b.price != null),
          campaigns: campaigns.map((c) => ({ validMinutes: c.validMinutes, price: c.price, startDate: c.startDate, endDate: c.endDate, void: !!c.void })),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "保存に失敗しました");
      showToast(`${clubName} の時間別価格を保存しました（${d.changed}件）。`, "success");
      setConfirmOpen(false);
      openClub({ clubCode: selected!, name: clubName });
    } catch (e: any) { showToast(e?.message || "保存に失敗しました", "error"); }
    finally { setSaving(false); }
  };
  const onSaveClick = () => { const e = validate(); if (e) { showToast(e, "error"); return; } setConfirmOpen(true); };

  const activeCamps = campaigns.filter((c) => !c.void);
  const cpStatus = (c: Campaign) => c.startDate <= today && (isOpenEnded(c) || c.endDate >= today) ? "active" : c.startDate > today ? "up" : "past";

  return (
    <div className="jot-root">
      <AdminLoadingOverlay visible={loading} text="JOYFIT時間別価格を読み込み中..." />

      <main className={`jot-main ${clubCode ? "single" : ""}`}>
        {!clubCode && (
        <section className="jot-list">
          <div className="jot-list-tools">
            <input className="jot-search" placeholder="店舗名・clubCodeで検索" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="jot-count">{filtered.length}店</span>
          </div>
          <div className="jot-list-scroll">
            {filtered.map((c) => (
              <button key={c.clubCode} className={`jot-club ${selected === c.clubCode ? "active" : ""}`} onClick={() => openClub(c)}>
                <code className="jot-club-id">{c.clubCode}</code>
                <span className="jot-club-name">{c.name}</span>
              </button>
            ))}
            {filtered.length === 0 && !loading && <div className="jot-empty">該当店舗なし</div>}
          </div>
        </section>
        )}

        <section className="jot-edit">
          {!selected ? <div className="jot-edit-empty">左の一覧から店舗を選んでください。</div>
            : detailLoading ? <div className="jot-edit-empty">読み込み中...</div>
            : (
              <>
                <div className="jot-edit-head"><div><code className="jot-club-id">{selected}</code><h2>{clubName}</h2></div><span className="jot-src-badge">{isAdmin ? "全店" : "自店舗"} / EnjoyTimePass (t1pass)</span></div>

                {overlaps.length > 0 && (
                  <div className="jot-warn">⚠️ 同じ利用時間で期間が重複しています（{overlaps.length}組）。
                    <ul>{overlaps.slice(0, 5).map((o, i) => <li key={i}>{o}</li>)}</ul>
                  </div>
                )}

                {/* 通常価格 (7段) */}
                <div className="jot-card">
                  <div className="jot-card-title">通常価格（時間別・常時のベース）</div>
                  <div className="jot-tier-grid">
                    {base.map((b) => (
                      <div key={b.validMinutes} className="jot-tier">
                        <span className="jot-tier-min">{dur(b.validMinutes)}</span>
                        <div className="jot-tier-price"><span>¥</span>
                          <input type="number" min={PRICE_MIN} max={PRICE_MAX} step={10} value={b.price ?? 0}
                            onChange={(e) => setBasePrice(b.validMinutes, Math.max(0, Number(e.target.value) || 0))}
                            className={b.price != null && (b.price < PRICE_MIN || b.price > PRICE_MAX) ? "out" : ""} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 予約価格 */}
                <div className="jot-card">
                  <div className="jot-card-title">予約価格（タイマー）
                    <span className="jot-add-group">
                      <button type="button" className="jot-add" onClick={addBounded}>＋ 期間限定</button>
                      <button type="button" className="jot-add alt" onClick={addScheduled}>＋ 予約変更</button>
                    </span>
                  </div>
                  {activeCamps.length === 0 ? (
                    <div className="jot-mini-empty">予約価格はありません。利用時間ごとに、期間限定/指定日以降の価格を仕込めます。</div>
                  ) : (
                    <div className="jot-cp-list">
                      {campaigns.map((c) => c.void ? null : (
                        <div key={c._key} className={`jot-cp-row ${isOpenEnded(c) ? "open" : ""}`}>
                          <span className={`jot-cp-status ${cpStatus(c)}`}>{cpStatus(c) === "active" ? "適用中" : cpStatus(c) === "up" ? "予定" : "終了"}</span>
                          <select value={c.validMinutes} disabled={c.saved}
                            onChange={(e) => updateCampaign(c._key, { validMinutes: Number(e.target.value) })} className="jot-cp-min">
                            {tiers.map((t) => <option key={t} value={t}>{dur(t)}</option>)}
                          </select>
                          <div className="jot-cp-price"><span>¥</span>
                            <input type="number" min={PRICE_MIN} max={PRICE_MAX} step={10} value={c.price}
                              onChange={(e) => updateCampaign(c._key, { price: Math.max(0, Number(e.target.value) || 0) })}
                              className={c.price < PRICE_MIN || c.price > PRICE_MAX ? "out" : ""} />
                          </div>
                          <input type="date" value={toInput(c.startDate)} disabled={c.saved}
                            onChange={(e) => updateCampaign(c._key, { startDate: fromInput(e.target.value) })} title={c.saved ? "保存済みの開始日は変更不可" : ""} />
                          {isOpenEnded(c) ? <span className="jot-open-label">〜 以降ずっと</span>
                            : <><span className="jot-tilde">〜</span>
                                <input type="date" value={toInput(c.endDate)} min={toInput(c.startDate)} onChange={(e) => updateCampaign(c._key, { endDate: fromInput(e.target.value) })} /></>}
                          <button type="button" className="jot-del" onClick={() => removeCampaign(c._key)}>{c.saved ? "無効化" : "削除"}</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="jot-note">※ この店舗のDBは削除権限が無いため、保存済み予約は「無効化」（終了日を過去化）で無効にします。開始日・利用時間は保存後は変更できません（新規追加してください）。</div>
                </div>

                <div className="jot-actions"><button type="button" className="jot-save" onClick={onSaveClick} disabled={saving}>変更を保存</button></div>
              </>
            )}
        </section>
      </main>

      {confirmOpen && (
        <div className="jot-modal-bg" onClick={() => !saving && setConfirmOpen(false)}>
          <div className="jot-modal" onClick={(e) => e.stopPropagation()}>
            <h3>時間別価格の保存</h3>
            <p><strong>{clubName}</strong>（{selected}）の価格を <strong>本番のEnjoyTimePass(t1pass)</strong> に保存します。</p>
            <div className="jot-modal-sum">通常価格7段 / 予約 {activeCamps.length}件{overlaps.length > 0 ? ` ・重複${overlaps.length}組` : ""}</div>
            <div className="jot-modal-act">
              <button type="button" className="jot-modal-cancel" disabled={saving} onClick={() => setConfirmOpen(false)}>キャンセル</button>
              <button type="button" className="jot-modal-ok" disabled={saving} onClick={doSave}>{saving ? "保存中…" : "保存する"}</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .jot-root { background: transparent; font-family: sans-serif; color: #0f172a; }
        .jot-src-badge { font-size: 11px; color: #94a3b8; font-family: monospace; }
        .jot-main { display: grid; grid-template-columns: 340px 1fr; gap: 18px; }
        .jot-main.single { grid-template-columns: 1fr; }
        @media (max-width: 900px) { .jot-main { grid-template-columns: 1fr; } }
        .jot-list { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; height: fit-content; }
        .jot-list-tools { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid #f1f5f9; }
        .jot-search { flex: 1; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; }
        .jot-count { font-size: 11px; color: #94a3b8; font-weight: 700; }
        .jot-list-scroll { max-height: 72vh; overflow-y: auto; }
        .jot-club { width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid #f1f5f9; padding: 11px 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .jot-club:hover { background: #f8fafc; }
        .jot-club.active { background: #f5f3ff; border-left: 3px solid #7c3aed; }
        .jot-club-id { font-size: 11px; font-family: monospace; color: #64748b; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; }
        .jot-club-name { font-size: 14px; font-weight: 700; }
        .jot-empty, .jot-mini-empty, .jot-edit-empty { padding: 22px; text-align: center; color: #94a3b8; font-size: 13px; }
        .jot-edit { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px; }
        .jot-edit-head { margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
        .jot-edit-head h2 { font-size: 20px; font-weight: 800; margin: 6px 0 0; }
        .jot-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
        .jot-card-title { font-size: 13px; font-weight: 800; color: #1e293b; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .jot-tier-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
        .jot-tier { border: 1px solid #f1f5f9; border-radius: 10px; padding: 10px 12px; }
        .jot-tier-min { font-size: 12px; font-weight: 800; color: #6d28d9; }
        .jot-tier-price { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
        .jot-tier-price input, .jot-cp-price input { width: 90px; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; font-weight: 700; }
        .jot-tier-price input.out, .jot-cp-price input.out { border-color: #f87171; background: #fef2f2; }
        .jot-add-group { display: flex; gap: 6px; }
        .jot-add { font-size: 12px; font-weight: 700; color: #6d28d9; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 5px 12px; cursor: pointer; }
        .jot-add.alt { color: #1d4ed8; background: #eff6ff; border-color: #bfdbfe; }
        .jot-cp-list { display: flex; flex-direction: column; gap: 8px; }
        .jot-cp-row { display: grid; grid-template-columns: 56px 90px 100px 1fr auto auto auto; gap: 8px; align-items: center; }
        .jot-cp-row.open { grid-template-columns: 56px 90px 100px 1fr auto auto; }
        .jot-cp-status { font-size: 10px; font-weight: 800; text-align: center; padding: 3px 6px; border-radius: 99px; }
        .jot-cp-status.active { color: #047857; background: #d1fae5; } .jot-cp-status.up { color: #1d4ed8; background: #dbeafe; } .jot-cp-status.past { color: #64748b; background: #e2e8f0; }
        .jot-cp-min { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; }
        .jot-cp-price { display: flex; align-items: center; gap: 4px; }
        .jot-cp-row input[type=date] { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; }
        .jot-cp-row input:disabled, .jot-cp-min:disabled { background: #f1f5f9; color: #94a3b8; }
        .jot-tilde { color: #94a3b8; } .jot-open-label { font-size: 11px; color: #1d4ed8; font-weight: 700; }
        .jot-del { font-size: 11px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 5px 10px; cursor: pointer; }
        .jot-note { font-size: 11px; color: #94a3b8; margin-top: 10px; line-height: 1.6; }
        .jot-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; font-size: 12px; font-weight: 600; }
        .jot-warn ul { margin: 6px 0 0; padding-left: 18px; font-weight: 500; }
        .jot-actions { display: flex; justify-content: flex-end; }
        .jot-save { font-size: 14px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #7c3aed, #6d28d9); border: none; border-radius: 10px; padding: 11px 28px; cursor: pointer; box-shadow: 0 2px 6px rgba(109,40,217,0.3); }
        .jot-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .jot-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
        .jot-modal { background: #fff; border-radius: 16px; padding: 26px; max-width: 460px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
        .jot-modal h3 { font-size: 18px; font-weight: 800; margin: 0 0 10px; }
        .jot-modal p { font-size: 13px; color: #475569; line-height: 1.7; margin: 0 0 14px; }
        .jot-modal-sum { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; font-size: 14px; font-weight: 700; margin-bottom: 18px; }
        .jot-modal-act { display: flex; gap: 10px; justify-content: flex-end; }
        .jot-modal-cancel { font-size: 13px; font-weight: 700; padding: 9px 18px; border-radius: 9px; border: 1.5px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; }
        .jot-modal-ok { font-size: 13px; font-weight: 800; padding: 9px 20px; border-radius: 9px; border: none; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; cursor: pointer; }
        .jot-modal-ok:disabled, .jot-modal-cancel:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
