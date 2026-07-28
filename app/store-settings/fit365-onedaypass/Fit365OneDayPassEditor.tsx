"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import { useToast } from "@/components/Toast";

type ShopRow = {
  shopId: string; name: string; oneDayFlg: boolean; prefectureId: string | null;
  basePrice: number | null; currentPrice: number | null; clubCode: string | null;
};
type Campaign = { seq: number | null; price: number; startDate: string; endDate: string; deleted?: boolean; _key: string };
type Detail = {
  shop: { shopId: string; name: string; oneDayFlg: boolean };
  base: { classification: number; price: number } | null;
  campaigns: { seq: number; price: number; startDate: string; endDate: string }[];
};

const PRICE_MIN = 700;
const PRICE_MAX = 1500;
const OPEN_END = "20991231";        // 「以降ずっと」= 予約変更(恒久)の終了日センチネル
const OPEN_THRESHOLD = "20800101";  // これ以降の終了日は恒久扱い
const yen = (n: number | null) => (n == null ? "—" : `¥${n.toLocaleString("ja-JP")}`);
const toInput = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");
const fromInput = (s: string) => s.replace(/-/g, "");
const fmtYmd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}` : s);
const isOpenEnded = (c: { endDate: string }) => c.endDate >= OPEN_THRESHOLD;
// YYYYMMDD -> ミリ秒(比較/描画用)
const ymdToMs = (s: string) => {
  if (!/^\d{8}$/.test(s)) return NaN;
  return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
};
let keyCounter = 0;
const nextKey = () => `c${++keyCounter}`;

// --- 価格タイムライン (横帯) ---
function Timeline({ base, campaigns, today }: { base: number; campaigns: Campaign[]; today: string }) {
  const active = campaigns.filter((c) => !c.deleted && /^\d{8}$/.test(c.startDate) && /^\d{8}$/.test(c.endDate));
  const todayMs = ymdToMs(today);
  // 表示ウィンドウ: 過去1ヶ月 〜 (最大の終了日 or 今日+6ヶ月)。恒久は今日+6ヶ月で打ち切り表示。
  const DAY = 86400000;
  const winStart = Math.min(todayMs - 30 * DAY, ...active.map((c) => ymdToMs(c.startDate)));
  const boundedEnds = active.filter((c) => !isOpenEnded(c)).map((c) => ymdToMs(c.endDate));
  const winEnd = Math.max(todayMs + 180 * DAY, ...boundedEnds);
  const span = Math.max(1, winEnd - winStart);
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - winStart) / span) * 100))}%`;

  // 月目盛り
  const ticks: { x: string; label: string }[] = [];
  const d = new Date(winStart);
  d.setUTCDate(1);
  while (d.getTime() <= winEnd) {
    ticks.push({ x: pct(d.getTime()), label: `${d.getUTCMonth() + 1}月` });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const color = (p: number) => (p < base ? "#10b981" : p > base ? "#ef4444" : "#f59e0b");

  return (
    <div className="f1d-tl">
      <div className="f1d-tl-axis">
        {ticks.map((t, i) => (
          <span key={i} className="f1d-tl-tick" style={{ left: t.x }}>{t.label}</span>
        ))}
      </div>
      {/* 通常価格の帯 */}
      <div className="f1d-tl-base" title={`通常価格 ${yen(base)}`}>
        <span className="f1d-tl-base-label">通常 {yen(base)}</span>
      </div>
      {/* キャンペーン帯 */}
      <div className="f1d-tl-track">
        {active.map((c) => {
          const s = ymdToMs(c.startDate);
          const e = isOpenEnded(c) ? winEnd : ymdToMs(c.endDate);
          const left = pct(s);
          const width = `${Math.max(1.5, ((Math.min(e, winEnd) - Math.max(s, winStart)) / span) * 100)}%`;
          const open = isOpenEnded(c);
          return (
            <div key={c._key} className="f1d-tl-seg" style={{ left, width, background: color(c.price) }}
              title={`${fmtYmd(c.startDate)}〜${open ? "以降ずっと" : fmtYmd(c.endDate)} : ${yen(c.price)}`}>
              <span className="f1d-tl-seg-label">{yen(c.price)}{open ? "〜" : ""}</span>
            </div>
          );
        })}
      </div>
      {/* 今日ライン */}
      <div className="f1d-tl-today" style={{ left: pct(todayMs) }}><span>今日</span></div>
    </div>
  );
}

/**
 * FIT365 1dayパス金額エディタ本体。
 * 独自のページchrome(ヘッダー/戻るリンク)は持たず、タブパネルとして描画できる。
 * ロジック・API・スタイル(.f1d-*)は元の standalone ページと同一。
 */
export default function Fit365OneDayPassEditor({ clubCode }: { clubCode?: string } = {}) {
  const { showToast } = useToast();
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [today, setToday] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [oneDayOnly, setOneDayOnly] = useState(true);

  const [selected, setSelected] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shopName, setShopName] = useState("");
  const [oneDayFlg, setOneDayFlg] = useState(false);
  const [basePrice, setBasePrice] = useState<number>(1000);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/store-settings/fit365-onedaypass");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "取得に失敗しました");
      setShops(d.shops || []);
      setToday(d.today || "");
      setIsAdmin(!!d.isAdmin);
    } catch (e: any) {
      showToast(e?.message || "一覧の取得に失敗しました", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);
  useEffect(() => { fetchList(); }, [fetchList]);

  const openShop = useCallback(async (shopId: string) => {
    setSelected(shopId);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/store-settings/fit365-onedaypass?shopId=${shopId}`);
      const d: Detail & { error?: string; today?: string } = await res.json();
      if (!res.ok) throw new Error((d as any).error || "取得に失敗しました");
      if (d.today) setToday(d.today);
      setShopName(d.shop.name);
      setOneDayFlg(d.shop.oneDayFlg);
      setBasePrice(d.base?.price ?? 1000);
      setCampaigns(d.campaigns.map((c) => ({ ...c, _key: nextKey() })));
    } catch (e: any) {
      showToast(e?.message || "店舗詳細の取得に失敗しました", "error");
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  }, [showToast]);

  // clubCode 指定時: 一覧取得後、clubCode に対応する店舗を自動で開く(内部ピッカーは隠す)
  useEffect(() => {
    if (!clubCode || selected || shops.length === 0) return;
    const s = shops.find((x) => x.clubCode === clubCode);
    if (s) openShop(s.shopId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubCode, shops]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shops.filter((s) => {
      if (oneDayOnly && !s.oneDayFlg) return false;
      if (q && !(s.name.toLowerCase().includes(q) || s.shopId.includes(q))) return false;
      return true;
    });
  }, [shops, search, oneDayOnly]);

  const updateCampaign = (key: string, patch: Partial<Campaign>) =>
    setCampaigns((prev) => prev.map((c) => (c._key === key ? { ...c, ...patch } : c)));
  const addBounded = () =>
    setCampaigns((prev) => [...prev, { seq: null, price: basePrice, startDate: today, endDate: today, _key: nextKey() }]);
  const addScheduledBase = () =>
    setCampaigns((prev) => [...prev, { seq: null, price: basePrice, startDate: today, endDate: OPEN_END, _key: nextKey() }]);
  const removeCampaign = (key: string) =>
    setCampaigns((prev) =>
      prev.map((c) => (c._key === key ? { ...c, deleted: true } : c)).filter((c) => !(c.deleted && c.seq == null)));

  // 重複検出: 有効キャンペーン同士で期間が重なるペア
  const overlaps = useMemo(() => {
    const act = campaigns.filter((c) => !c.deleted && /^\d{8}$/.test(c.startDate) && /^\d{8}$/.test(c.endDate));
    const pairs: string[] = [];
    for (let i = 0; i < act.length; i++)
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i], b = act[j];
        if (a.startDate <= b.endDate && b.startDate <= a.endDate) {
          pairs.push(`${fmtYmd(a.startDate)}〜(${yen(a.price)}) と ${fmtYmd(b.startDate)}〜(${yen(b.price)})`);
        }
      }
    return pairs;
  }, [campaigns]);

  const validate = (): string | null => {
    if (!Number.isInteger(basePrice) || basePrice < PRICE_MIN || basePrice > PRICE_MAX)
      return `通常価格は ¥${PRICE_MIN}〜¥${PRICE_MAX} で入力してください。`;
    for (const c of campaigns) {
      if (c.deleted) continue;
      if (!Number.isInteger(c.price) || c.price < PRICE_MIN || c.price > PRICE_MAX)
        return `価格は ¥${PRICE_MIN}〜¥${PRICE_MAX} で入力してください。`;
      if (!/^\d{8}$/.test(c.startDate) || !/^\d{8}$/.test(c.endDate)) return "適用期間の日付を入力してください。";
      if (c.startDate > c.endDate) return "終了日は開始日以降にしてください。";
    }
    return null;
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/store-settings/fit365-onedaypass", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: selected, basePrice,
          campaigns: campaigns.map((c) => ({ seq: c.seq, price: c.price, startDate: c.startDate, endDate: c.endDate, deleted: !!c.deleted })),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "保存に失敗しました");
      showToast(`${shopName} の金額を保存しました（${d.changed}件更新）。`, "success");
      setConfirmOpen(false);
      await openShop(selected!);
      fetchList();
    } catch (e: any) {
      showToast(e?.message || "保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  };
  const onSaveClick = () => {
    const err = validate();
    if (err) { showToast(err, "error"); return; }
    setConfirmOpen(true);
  };

  const active = campaigns.filter((c) => !c.deleted);
  const cpStatus = (c: Campaign) =>
    c.seq == null ? "new" : c.startDate <= today && c.endDate >= today ? "active" : c.startDate > today ? "up" : "past";

  return (
    <div className="f1d-root">
      <AdminLoadingOverlay visible={loading} text="1dayパス設定を読み込み中..." />

      <main className={`f1d-main ${clubCode ? "single" : ""}`}>
        {!clubCode && (
        <section className="f1d-list">
          <div className="f1d-list-tools">
            <input className="f1d-search" placeholder="店舗名・shop_idで検索" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="f1d-check"><input type="checkbox" checked={oneDayOnly} onChange={(e) => setOneDayOnly(e.target.checked)} />1day対応のみ</label>
            <span className="f1d-count">{filtered.length}店</span>
          </div>
          <div className="f1d-list-scroll">
            {filtered.map((s) => (
              <button key={s.shopId} className={`f1d-shop ${selected === s.shopId ? "active" : ""}`} onClick={() => openShop(s.shopId)}>
                <div className="f1d-shop-main">
                  <code className="f1d-shop-id">{s.shopId}</code>
                  <span className="f1d-shop-name">{s.name}</span>
                  {!s.oneDayFlg && <span className="f1d-off">1day停止</span>}
                </div>
                <div className="f1d-shop-price">
                  <span>通常 {yen(s.basePrice)}</span>
                  {s.currentPrice != null && <span className="f1d-cp">本日 {yen(s.currentPrice)}</span>}
                </div>
              </button>
            ))}
            {filtered.length === 0 && !loading && <div className="f1d-empty">該当店舗なし</div>}
          </div>
        </section>
        )}

        <section className="f1d-edit">
          {!selected ? (
            <div className="f1d-edit-empty">左の一覧から店舗を選んでください。</div>
          ) : detailLoading ? (
            <div className="f1d-edit-empty">読み込み中...</div>
          ) : (
            <>
              <div className="f1d-edit-head">
                <div><code className="f1d-shop-id">{selected}</code><h2>{shopName}</h2></div>
                <span className={`f1d-flg ${oneDayFlg ? "on" : "off"}`}>{oneDayFlg ? "1day対応" : "1day停止中"}</span>
              </div>

              {/* タイムライン可視化 */}
              <div className="f1d-card">
                <div className="f1d-card-title">価格タイムライン<span className="f1d-legend"><i style={{ background: "#f59e0b" }} />通常<i style={{ background: "#10b981" }} />値下げ<i style={{ background: "#ef4444" }} />値上げ</span></div>
                <Timeline base={basePrice} campaigns={campaigns} today={today} />
              </div>

              {/* 重複警告 */}
              {overlaps.length > 0 && (
                <div className="f1d-warn">
                  ⚠️ 期間が重複しています（{overlaps.length}組）。重複日は<strong>後に追加した方(seqが大きい)が優先</strong>されます：
                  <ul>{overlaps.slice(0, 5).map((o, i) => <li key={i}>{o}</li>)}</ul>
                </div>
              )}

              {/* 通常価格 */}
              <div className="f1d-card">
                <div className="f1d-card-title">通常価格（常時のベース）</div>
                <div className="f1d-price-input">
                  <span>¥</span>
                  <input type="number" min={PRICE_MIN} max={PRICE_MAX} step={10} value={basePrice}
                    onChange={(e) => setBasePrice(Math.max(0, Number(e.target.value) || 0))}
                    className={basePrice < PRICE_MIN || basePrice > PRICE_MAX ? "out" : ""} />
                  <span className="f1d-range">許容 ¥{PRICE_MIN}〜¥{PRICE_MAX}</span>
                </div>
              </div>

              {/* 予約価格 (期間限定 / 恒久予約) */}
              <div className="f1d-card">
                <div className="f1d-card-title">
                  予約価格（タイマー）
                  <span className="f1d-add-group">
                    <button type="button" className="f1d-add" onClick={addBounded}>＋ 期間限定</button>
                    <button type="button" className="f1d-add alt" onClick={addScheduledBase}>＋ 通常価格の予約変更</button>
                  </span>
                </div>
                {active.length === 0 ? (
                  <div className="f1d-mini-empty">予約価格はありません。「期間限定」＝開始〜終了日の限定価格／「予約変更」＝指定日から以降ずっとの価格。</div>
                ) : (
                  <div className="f1d-cp-list">
                    {campaigns.map((c) => c.deleted ? null : (
                      <div key={c._key} className={`f1d-cp-row ${isOpenEnded(c) ? "open" : ""}`}>
                        <span className={`f1d-cp-status ${cpStatus(c)}`}>
                          {cpStatus(c) === "new" ? "新規" : cpStatus(c) === "active" ? "適用中" : cpStatus(c) === "up" ? "予定" : "終了"}
                        </span>
                        <span className={`f1d-cp-type ${isOpenEnded(c) ? "open" : "bound"}`}>{isOpenEnded(c) ? "予約変更" : "期間限定"}</span>
                        <div className="f1d-cp-price"><span>¥</span>
                          <input type="number" min={PRICE_MIN} max={PRICE_MAX} step={10} value={c.price}
                            onChange={(e) => updateCampaign(c._key, { price: Math.max(0, Number(e.target.value) || 0) })}
                            className={c.price < PRICE_MIN || c.price > PRICE_MAX ? "out" : ""} />
                        </div>
                        <input type="date" value={toInput(c.startDate)} onChange={(e) => updateCampaign(c._key, { startDate: fromInput(e.target.value) })} />
                        {isOpenEnded(c) ? (
                          <span className="f1d-open-label">〜 以降ずっと</span>
                        ) : (
                          <>
                            <span className="f1d-tilde">〜</span>
                            <input type="date" value={toInput(c.endDate)} min={toInput(c.startDate)} onChange={(e) => updateCampaign(c._key, { endDate: fromInput(e.target.value) })} />
                          </>
                        )}
                        <button type="button" className="f1d-del" onClick={() => removeCampaign(c._key)}>削除</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="f1d-actions">
                <button type="button" className="f1d-save" onClick={onSaveClick} disabled={saving}>変更を保存</button>
              </div>
            </>
          )}
        </section>
      </main>

      {confirmOpen && (
        <div className="f1d-modal-bg" onClick={() => !saving && setConfirmOpen(false)}>
          <div className="f1d-modal" onClick={(e) => e.stopPropagation()}>
            <h3>1dayパス金額の保存</h3>
            <p><strong>{shopName}</strong>（{selected}）の金額を <strong>本番のFIT365 entry DB</strong> に保存します。</p>
            <div className="f1d-modal-sum">通常 {yen(basePrice)} / 予約価格 {active.length}件{overlaps.length > 0 ? ` ・重複${overlaps.length}組あり` : ""}</div>
            {overlaps.length > 0 && <div className="f1d-modal-warn">※ 期間重複があります。後追加(seq大)が優先される点をご確認ください。</div>}
            <div className="f1d-modal-act">
              <button type="button" className="f1d-modal-cancel" disabled={saving} onClick={() => setConfirmOpen(false)}>キャンセル</button>
              <button type="button" className="f1d-modal-ok" disabled={saving} onClick={doSave}>{saving ? "保存中…" : "保存する"}</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .f1d-root { background: transparent; font-family: sans-serif; color: #0f172a; }
        .f1d-main { display: grid; grid-template-columns: 360px 1fr; gap: 18px; }
        .f1d-main.single { grid-template-columns: 1fr; }
        @media (max-width: 900px) { .f1d-main { grid-template-columns: 1fr; } }
        .f1d-list { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; height: fit-content; }
        .f1d-list-tools { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; }
        .f1d-search { flex: 1; min-width: 130px; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; }
        .f1d-check { font-size: 12px; color: #475569; display: flex; align-items: center; gap: 4px; }
        .f1d-count { font-size: 11px; color: #94a3b8; font-weight: 700; }
        .f1d-list-scroll { max-height: 72vh; overflow-y: auto; }
        .f1d-shop { width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid #f1f5f9; padding: 10px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
        .f1d-shop:hover { background: #f8fafc; }
        .f1d-shop.active { background: #fff7ed; border-left: 3px solid #f59e0b; }
        .f1d-shop-main { display: flex; align-items: center; gap: 8px; }
        .f1d-shop-id { font-size: 11px; font-family: monospace; color: #64748b; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; }
        .f1d-shop-name { font-size: 14px; font-weight: 700; }
        .f1d-off { font-size: 10px; color: #b91c1c; background: #fee2e2; padding: 1px 6px; border-radius: 99px; }
        .f1d-shop-price { display: flex; gap: 10px; font-size: 12px; color: #475569; }
        .f1d-cp { color: #b45309; font-weight: 700; }
        .f1d-empty, .f1d-mini-empty, .f1d-edit-empty { padding: 22px; text-align: center; color: #94a3b8; font-size: 13px; }
        .f1d-edit { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px; }
        .f1d-edit-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
        .f1d-edit-head h2 { font-size: 20px; font-weight: 800; margin: 6px 0 0; }
        .f1d-flg { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }
        .f1d-flg.on { color: #047857; background: #d1fae5; } .f1d-flg.off { color: #64748b; background: #e2e8f0; }
        .f1d-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
        .f1d-card-title { font-size: 13px; font-weight: 800; color: #1e293b; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .f1d-legend { font-weight: 500; font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 6px; }
        .f1d-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; margin-left: 6px; }
        .f1d-price-input { display: flex; align-items: center; gap: 8px; }
        .f1d-price-input input, .f1d-cp-price input { width: 100px; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 15px; font-weight: 700; }
        .f1d-price-input input.out, .f1d-cp-price input.out { border-color: #f87171; background: #fef2f2; }
        .f1d-range { font-size: 11px; color: #94a3b8; }
        .f1d-add-group { display: flex; gap: 6px; }
        .f1d-add { font-size: 12px; font-weight: 700; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 5px 12px; cursor: pointer; }
        .f1d-add.alt { color: #1d4ed8; background: #eff6ff; border-color: #bfdbfe; }
        .f1d-cp-list { display: flex; flex-direction: column; gap: 8px; }
        .f1d-cp-row { display: grid; grid-template-columns: 56px 72px 110px 1fr auto auto auto; gap: 8px; align-items: center; }
        .f1d-cp-row.open { grid-template-columns: 56px 72px 110px 1fr auto auto; }
        .f1d-cp-status { font-size: 10px; font-weight: 800; text-align: center; padding: 3px 6px; border-radius: 99px; }
        .f1d-cp-status.active { color: #047857; background: #d1fae5; } .f1d-cp-status.up { color: #1d4ed8; background: #dbeafe; }
        .f1d-cp-status.past { color: #64748b; background: #e2e8f0; } .f1d-cp-status.new { color: #b45309; background: #fef3c7; }
        .f1d-cp-type { font-size: 10px; font-weight: 700; text-align: center; padding: 3px 6px; border-radius: 6px; }
        .f1d-cp-type.bound { color: #b45309; background: #fef3c7; } .f1d-cp-type.open { color: #1d4ed8; background: #dbeafe; }
        .f1d-cp-price { display: flex; align-items: center; gap: 4px; }
        .f1d-cp-row input[type=date] { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; }
        .f1d-tilde { color: #94a3b8; } .f1d-open-label { font-size: 11px; color: #1d4ed8; font-weight: 700; }
        .f1d-del { font-size: 11px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 5px 10px; cursor: pointer; }
        .f1d-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; font-size: 12px; font-weight: 600; }
        .f1d-warn ul { margin: 6px 0 0; padding-left: 18px; font-weight: 500; }
        .f1d-actions { display: flex; justify-content: flex-end; }
        .f1d-save { font-size: 14px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #f59e0b, #d97706); border: none; border-radius: 10px; padding: 11px 28px; cursor: pointer; box-shadow: 0 2px 6px rgba(217,119,6,0.3); }
        .f1d-save:disabled { opacity: 0.5; cursor: not-allowed; }
        /* タイムライン */
        .f1d-tl { position: relative; height: 92px; margin-top: 6px; }
        .f1d-tl-axis { position: relative; height: 16px; }
        .f1d-tl-tick { position: absolute; font-size: 10px; color: #94a3b8; transform: translateX(-50%); }
        .f1d-tl-base { position: relative; height: 26px; background: repeating-linear-gradient(90deg, #fde68a 0 10px, #fcd34d 10px 20px); border-radius: 6px; display: flex; align-items: center; margin-bottom: 6px; opacity: 0.6; }
        .f1d-tl-base-label { font-size: 10px; font-weight: 800; color: #92400e; margin-left: 8px; }
        .f1d-tl-track { position: relative; height: 30px; background: #f8fafc; border-radius: 6px; border: 1px dashed #e2e8f0; }
        .f1d-tl-seg { position: absolute; top: 3px; height: 24px; border-radius: 5px; display: flex; align-items: center; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
        .f1d-tl-seg-label { font-size: 10px; font-weight: 800; color: #fff; margin-left: 6px; white-space: nowrap; }
        .f1d-tl-today { position: absolute; top: 16px; bottom: 0; width: 2px; background: #0f172a; z-index: 3; }
        .f1d-tl-today span { position: absolute; top: -2px; left: 3px; font-size: 9px; font-weight: 800; color: #0f172a; background: #fff; padding: 0 2px; }
        .f1d-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
        .f1d-modal { background: #fff; border-radius: 16px; padding: 26px; max-width: 460px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
        .f1d-modal h3 { font-size: 18px; font-weight: 800; margin: 0 0 10px; }
        .f1d-modal p { font-size: 13px; color: #475569; line-height: 1.7; margin: 0 0 14px; }
        .f1d-modal-sum { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; font-size: 14px; font-weight: 700; margin-bottom: 12px; }
        .f1d-modal-warn { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; }
        .f1d-modal-act { display: flex; gap: 10px; justify-content: flex-end; }
        .f1d-modal-cancel { font-size: 13px; font-weight: 700; padding: 9px 18px; border-radius: 9px; border: 1.5px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; }
        .f1d-modal-ok { font-size: 13px; font-weight: 800; padding: 9px 20px; border-radius: 9px; border: none; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; cursor: pointer; }
        .f1d-modal-ok:disabled, .f1d-modal-cancel:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
