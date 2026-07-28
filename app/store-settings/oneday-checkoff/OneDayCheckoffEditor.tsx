"use client";

import React, { useCallback, useEffect, useState } from "react";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import { useToast } from "@/components/Toast";

type Ticket = { token: string; serialNumber: number; memberNo: string; memberName: string; memberKana: string; shopName: string; casioShopId: string; purchaseDate: string; purchaseTime: string; expirationDate: string; used: boolean; useDate: string; useTime: string };
type Status = "unused" | "used" | "all";

const fmtDate = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}` : d || "-");
const fmtTime = (t: string) => (/^\d{6}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : "");
function nowJstLocal(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * FIT365 1dayパス チケット消し込み本体。
 * 独自のページchrome(ヘッダー/戻るリンク)は持たず、タブパネルとして描画できる。
 * ロジック・API・スタイル(.odc-*)は元の standalone ページと同一。
 */
export default function OneDayCheckoffEditor({ clubCode }: { clubCode?: string } = {}) {
  const { showToast } = useToast();
  const [month, setMonth] = useState("");
  const [shopName, setShopName] = useState("");
  const [memberNo, setMemberNo] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>("unused");
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState("");

  const [target, setTarget] = useState<Ticket | null>(null);
  const [mode, setMode] = useState<"use" | "unuse">("use"); // 消し込み or 未使用に戻す
  const [useDt, setUseDt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams();
      if (month) p.set("month", month.replace("-", ""));
      if (clubCode) p.set("clubCode", clubCode);
      if (shopName) p.set("shopName", shopName);
      if (memberNo) p.set("memberNo", memberNo);
      if (name) p.set("name", name);
      p.set("status", status);
      const res = await fetch(`/api/store-settings/oneday-checkoff?${p}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "取得に失敗しました");
      setTickets(d.tickets || []); setLimited(!!d.limited);
    } catch (e: any) { setError(e?.message || "取得に失敗しました"); }
    finally { setLoading(false); }
  }, [month, clubCode, shopName, memberNo, name, status]);

  // 初回 + 状態タブ切り替えで再取得
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const openUse = (t: Ticket) => { setTarget(t); setMode("use"); setUseDt(nowJstLocal()); };
  const openUnuse = (t: Ticket) => { setTarget(t); setMode("unuse"); };
  const runCheckoff = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const body = mode === "use"
        ? { token: target.token, serialNumber: target.serialNumber, action: "use", useDt }
        : { token: target.token, serialNumber: target.serialNumber, action: "unuse" };
      const res = await fetch("/api/store-settings/oneday-checkoff", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "操作に失敗しました");
      const who = `${target.memberName ? target.memberName + "様 " : ""}会員 ${target.memberNo}`;
      showToast(mode === "use" ? `${who} のチケットを消し込みました。` : `${who} のチケットを未使用に戻しました。`, "success");
      setTickets((prev) => prev.filter((x) => !(x.token === target.token && x.serialNumber === target.serialNumber)));
      setTarget(null);
    } catch (e: any) { showToast(e?.message || "操作に失敗しました", "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="odc-root">
      <AdminLoadingOverlay visible={loading} text="1dayチケットを読み込み中..." />

      <main className="odc-main">
        <div className="odc-filters">
          <div className="odc-field">
            <label>状態</label>
            <div className="odc-seg">
              {([["unused", "未使用"], ["used", "使用済み"], ["all", "すべて"]] as [Status, string][]).map(([v, lbl]) => (
                <button key={v} type="button" className={status === v ? "on" : ""} onClick={() => setStatus(v)}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="odc-field"><label>購入月</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          {!clubCode && <div className="odc-field"><label>店舗名</label><input type="text" placeholder="部分一致" value={shopName} onChange={(e) => setShopName(e.target.value)} /></div>}
          <div className="odc-field"><label>会員番号</label><input type="text" placeholder="完全一致" value={memberNo} onChange={(e) => setMemberNo(e.target.value)} /></div>
          <div className="odc-field"><label>氏名・カナ</label><input type="text" placeholder="部分一致" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }} /></div>
          <button className="odc-apply" onClick={load}>絞り込む</button>
        </div>

        {error && <div className="odc-error">{error}</div>}
        <div className="odc-count">{status === "used" ? "使用済み" : status === "all" ? "" : "未使用"}チケット <b>{tickets.length}</b> 件{limited ? "（上限500件・絞り込んでください）" : ""}</div>

        <div className="odc-table-wrap">
          <table className="odc-table">
            <thead><tr><th>購入日時</th><th>会員番号</th><th>氏名</th><th>店舗</th><th>状態</th><th>有効期限</th><th></th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={`${t.token}-${t.serialNumber}`}>
                  <td className="odc-nowrap">{fmtDate(t.purchaseDate)} {fmtTime(t.purchaseTime)}</td>
                  <td><code className="odc-code">{t.memberNo}</code></td>
                  <td>{t.memberName || "-"}{t.memberKana ? <span className="odc-kana">{t.memberKana}</span> : null}</td>
                  <td>{t.shopName}</td>
                  <td className="odc-nowrap">{t.used ? <span className="odc-st used">使用済み<span className="odc-kana">{fmtDate(t.useDate)} {fmtTime(t.useTime)}</span></span> : <span className="odc-st unused">未使用</span>}</td>
                  <td className="odc-nowrap">{fmtDate(t.expirationDate)}</td>
                  <td>{t.used ? <button className="odc-undo-btn" onClick={() => openUnuse(t)}>未使用に戻す</button> : <button className="odc-use-btn" onClick={() => openUse(t)}>消し込み</button>}</td>
                </tr>
              ))}
              {tickets.length === 0 && !loading && <tr><td colSpan={7} className="odc-empty">該当するチケットはありません</td></tr>}
            </tbody>
          </table>
        </div>
      </main>

      {target && (
        <div className="odc-modal-bg" onClick={() => !busy && setTarget(null)}>
          <div className="odc-modal" onClick={(e) => e.stopPropagation()}>
            {mode === "use" ? (
              <>
                <h3>チケットを消し込み（使用済にする）</h3>
                <p>{target.memberName ? <><b>{target.memberName}</b> 様 </> : null}会員 <b>{target.memberNo}</b>（{target.shopName}）の1dayパスを使用済みにします。<strong>本番の入会DBを更新します。</strong></p>
                <div className="odc-modal-field">
                  <label>利用日時</label>
                  <input type="datetime-local" value={useDt} max={nowJstLocal()} onChange={(e) => setUseDt(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <h3>未使用に戻す（消し込み取消）</h3>
                <p>{target.memberName ? <><b>{target.memberName}</b> 様 </> : null}会員 <b>{target.memberNo}</b>（{target.shopName}）の1dayパスを<b>未使用</b>に戻します（利用日時：{fmtDate(target.useDate)} {fmtTime(target.useTime)}）。<strong>本番の入会DBを更新します。</strong>誤って消し込んだ場合の取消用です。</p>
              </>
            )}
            <div className="odc-modal-act">
              <button className="odc-modal-cancel" disabled={busy} onClick={() => setTarget(null)}>キャンセル</button>
              <button className="odc-modal-ok" disabled={busy || (mode === "use" && !useDt)} onClick={runCheckoff}>{busy ? "処理中…" : mode === "use" ? "消し込む" : "未使用に戻す"}</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .odc-root { background: transparent; font-family: sans-serif; color: #0f172a; }
        .odc-main { }
        .odc-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
        .odc-field { display: flex; flex-direction: column; gap: 4px; }
        .odc-field label { font-size: 11px; font-weight: 700; color: #64748b; }
        .odc-field input { padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; }
        .odc-apply { margin-left: auto; padding: 9px 20px; background: #0f172a; color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; }
        .odc-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; }
        .odc-count { font-size: 13px; color: #475569; margin-bottom: 10px; }
        .odc-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: auto; }
        .odc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .odc-table th { text-align: left; padding: 11px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 800; color: #64748b; white-space: nowrap; }
        .odc-kana { display: block; font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
        .odc-table td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
        .odc-table tr:last-child td { border-bottom: none; }
        .odc-nowrap { white-space: nowrap; }
        .odc-code { font-family: monospace; font-size: 11px; color: #64748b; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; }
        .odc-empty { text-align: center; color: #94a3b8; padding: 28px; }
        .odc-use-btn { font-size: 12px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #10b981, #047857); border: none; border-radius: 8px; padding: 6px 14px; cursor: pointer; white-space: nowrap; }
        .odc-undo-btn { font-size: 12px; font-weight: 700; color: #b45309; background: #fff; border: 1px solid #fcd34d; border-radius: 8px; padding: 6px 14px; cursor: pointer; white-space: nowrap; }
        .odc-undo-btn:hover { background: #fffbeb; }
        .odc-seg { display: inline-flex; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
        .odc-seg button { border: none; background: #fff; padding: 7px 12px; font-size: 12.5px; font-weight: 700; color: #64748b; cursor: pointer; border-left: 1px solid #e2e8f0; }
        .odc-seg button:first-child { border-left: none; }
        .odc-seg button.on { background: #0f172a; color: #fff; }
        .odc-st { font-size: 11.5px; font-weight: 700; }
        .odc-st.unused { color: #059669; }
        .odc-st.used { color: #64748b; }
        .odc-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
        .odc-modal { background: #fff; border-radius: 16px; padding: 26px; max-width: 440px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
        .odc-modal h3 { font-size: 18px; font-weight: 800; margin: 0 0 10px; }
        .odc-modal p { font-size: 13px; color: #475569; line-height: 1.7; margin: 0 0 16px; }
        .odc-modal-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
        .odc-modal-field label { font-size: 12px; font-weight: 700; color: #334155; }
        .odc-modal-field input { padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 9px; font-size: 14px; font-weight: 600; }
        .odc-modal-act { display: flex; gap: 10px; justify-content: flex-end; }
        .odc-modal-cancel { font-size: 13px; font-weight: 700; padding: 9px 18px; border-radius: 9px; border: 1.5px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; }
        .odc-modal-ok { font-size: 13px; font-weight: 800; padding: 9px 20px; border-radius: 9px; border: none; background: linear-gradient(135deg, #10b981, #047857); color: #fff; cursor: pointer; }
        .odc-modal-ok:disabled, .odc-modal-cancel:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
