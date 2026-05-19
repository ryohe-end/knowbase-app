"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Search, Check, X, Database, Clock,
  Receipt, FileText, Calculator, DollarSign, Wallet, Calendar
} from "lucide-react";

type DepositApp = {
  id: string;
  applicantName: string;
  applicantDept: string;
  applicantEmail: string;
  memberId: string;
  memberName: string;
  items: { id: string; label: string; amount: number; targetMonth: string; category: string; oracleInvoiceId: string }[];
  totalAmount: number;
  paymentMethod: string;
  scheduledDate: string;
  memo?: string;
  approverName: string;
  approvedAt: string;
  approverComment?: string;
  status: "経理処理待ち" | "消込完了" | "差戻し";
  closing?: {
    closedAt: string;
    receiptDate: string;
    oracleBatchId: string;
    operator: string;
    note?: string;
  };
};

const MOCK_APPS: DepositApp[] = [
  {
    id: "DP-20260511-001",
    applicantName: "遠藤 涼平", applicantDept: "旭川アモール 店舗", applicantEmail: "r-endo@okamoto-group.co.jp",
    memberId: "M0001234", memberName: "山田 太郎",
    items: [
      { id: "u1", label: "月会費（2026年3月分）", amount: 7980, targetMonth: "2026-03", category: "月会費", oracleInvoiceId: "INV-202603-001234" },
      { id: "u2", label: "FIT365あんしんサポート（3月分）", amount: 550, targetMonth: "2026-03", category: "オプション", oracleInvoiceId: "INV-202603-001235" },
    ],
    totalAmount: 8530,
    paymentMethod: "現金",
    scheduledDate: "2026-05-12",
    memo: "来店時に現金で受領、領収書発行済",
    approverName: "後藤 充洋", approvedAt: "2026-05-11 17:30", approverComment: "領収書確認済み",
    status: "経理処理待ち",
  },
  {
    id: "DP-20260511-002",
    applicantName: "佐藤 由美", applicantDept: "旭川アモール 店舗", applicantEmail: "y-sato@okamoto-group.co.jp",
    memberId: "M0004567", memberName: "高橋 美咲",
    items: [
      { id: "u5", label: "月会費（2026年2月分）", amount: 1980, targetMonth: "2026-02", category: "月会費", oracleInvoiceId: "INV-202602-004567" },
      { id: "u6", label: "月会費（2026年3月分）", amount: 1980, targetMonth: "2026-03", category: "月会費", oracleInvoiceId: "INV-202603-004567" },
      { id: "u8", label: "事務手数料", amount: 3300, targetMonth: "2026-02", category: "事務手数料", oracleInvoiceId: "INV-202602-004568" },
    ],
    totalAmount: 7260,
    paymentMethod: "銀行振込",
    scheduledDate: "2026-05-15",
    approverName: "後藤 充洋", approvedAt: "2026-05-11 14:20",
    status: "経理処理待ち",
  },
  {
    id: "DP-20260411-003",
    applicantName: "山本 美穂", applicantDept: "旭川アモール 店舗", applicantEmail: "m-yamamoto@okamoto-group.co.jp",
    memberId: "M0008912", memberName: "松本 拓海",
    items: [
      { id: "h1", label: "月会費（2026年4月分）", amount: 7980, targetMonth: "2026-04", category: "月会費", oracleInvoiceId: "INV-202604-008912" },
      { id: "h2", label: "FIT365あんしんサポート", amount: 1100, targetMonth: "2026-04", category: "オプション", oracleInvoiceId: "INV-202604-008913" },
    ],
    totalAmount: 9080,
    paymentMethod: "現金",
    scheduledDate: "2026-04-11",
    approverName: "後藤 充洋", approvedAt: "2026-04-11 14:20",
    status: "消込完了",
    closing: {
      closedAt: "2026-04-11 18:15",
      receiptDate: "2026-04-11",
      oracleBatchId: "BATCH-20260411-001",
      operator: "経理部 担当",
      note: "Oracle 消込完了",
    },
  },
];

const STATUS_COLOR: Record<DepositApp["status"], string> = {
  経理処理待ち: "#8b5cf6", 消込完了: "#10b981", 差戻し: "#ef4444",
};

export default function DepositFinancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [apps, setApps] = useState<DepositApp[]>(MOCK_APPS);
  const [tab, setTab] = useState<"pending" | "done" | "all">("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(MOCK_APPS[0]?.id ?? null);
  const [closeOpen, setCloseOpen] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [form, setForm] = useState({ receiptDate: today, oracleBatchId: "", note: "" });

  const filtered = useMemo(() => {
    return apps.filter((a) => {
      if (tab === "pending" && a.status !== "経理処理待ち") return false;
      if (tab === "done" && a.status === "経理処理待ち") return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.id.toLowerCase().includes(q) ||
          a.memberId.toLowerCase().includes(q) ||
          a.memberName.toLowerCase().includes(q) ||
          a.applicantName.toLowerCase().includes(q) ||
          a.paymentMethod.includes(q)
        );
      }
      return true;
    });
  }, [apps, tab, search]);

  const selected = filtered.find((a) => a.id === selectedId) ?? filtered[0] ?? null;

  const stats = useMemo(() => {
    const pending = apps.filter((a) => a.status === "経理処理待ち");
    const done = apps.filter((a) => a.status === "消込完了");
    return {
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, a) => s + a.totalAmount, 0),
      doneCount: done.length,
      monthAmount: done.filter((a) => a.closing?.receiptDate?.startsWith("2026-05")).reduce((s, a) => s + a.totalAmount, 0),
    };
  }, [apps]);

  const openClose = (id: string) => {
    const a = apps.find((x) => x.id === id);
    setForm({
      receiptDate: a?.scheduledDate ?? today,
      oracleBatchId: `BATCH-${today.replace(/-/g, "")}-${String(apps.length + 1).padStart(3, "0")}`,
      note: "",
    });
    setCloseOpen(id);
  };

  const doClose = () => {
    if (!closeOpen) return;
    if (!form.receiptDate || !form.oracleBatchId) { alert("入金確認日とOracleバッチIDは必須です"); return; }
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10) + " " + now.toTimeString().slice(0, 5);
    setApps((prev) => prev.map((a) => a.id === closeOpen ? {
      ...a,
      status: "消込完了",
      closing: { closedAt: stamp, receiptDate: form.receiptDate, oracleBatchId: form.oracleBatchId, operator: "経理部 担当", note: form.note || undefined },
    } : a));
    setCloseOpen(null);
  };

  const doReject = () => {
    if (!rejectOpen) return;
    if (!rejectComment.trim()) { alert("差戻し理由を入力してください"); return; }
    setApps((prev) => prev.map((a) => a.id === rejectOpen ? { ...a, status: "差戻し" } : a));
    setRejectOpen(null); setRejectComment("");
  };

  return (
    <div className="dpf-root">
      <header className="dpf-header">
        <div className="dpf-header-inner">
          <div className="dpf-brand">
            <Link href="/store-settings/refund-payment" className="dpf-back-link"><ArrowLeft size={20} /></Link>
            <div>
              <h1 className="dpf-main-title">入金申請 経理処理</h1>
              <p className="dpf-sub-title">本部 経理部 ／ Oracle 消込担当</p>
            </div>
          </div>
          <div className="dpf-data-badge"><Database size={14} /><span>Oracle 連携 / 入金消込</span></div>
        </div>
      </header>

      <main className="dpf-container">
        <div className="dpf-stats">
          <div className="dpf-stat" style={{ ["--c" as any]: "#8b5cf6" }}>
            <div className="dpf-stat-label"><Clock size={14} /> 消込待ち</div>
            <div className="dpf-stat-num">{stats.pendingCount} <small>件</small></div>
            <div className="dpf-stat-sub">合計 ¥{stats.pendingAmount.toLocaleString()}</div>
          </div>
          <div className="dpf-stat" style={{ ["--c" as any]: "#10b981" }}>
            <div className="dpf-stat-label"><Check size={14} /> 消込完了</div>
            <div className="dpf-stat-num">{stats.doneCount} <small>件</small></div>
            <div className="dpf-stat-sub">直近30日</div>
          </div>
          <div className="dpf-stat" style={{ ["--c" as any]: "#0ea5e9" }}>
            <div className="dpf-stat-label"><DollarSign size={14} /> 今月入金額</div>
            <div className="dpf-stat-num"><small>¥</small>{stats.monthAmount.toLocaleString()}</div>
            <div className="dpf-stat-sub">2026年5月</div>
          </div>
          <div className="dpf-stat" style={{ ["--c" as any]: "#f59e0b" }}>
            <div className="dpf-stat-label"><Calculator size={14} /> Oracle連携</div>
            <div className="dpf-stat-num">稼働中</div>
            <div className="dpf-stat-sub">最終同期 {today} 09:00</div>
          </div>
        </div>

        <div className="dpf-layout">
          <div className="dpf-list-col">
            <div className="dpf-list-controls">
              <div className="dpf-search-bar">
                <Search size={14} />
                <input placeholder="申請ID / 会員 / 申請者 / 入金方法 で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="dpf-tabs">
                <button className={`dpf-tab ${tab === "pending" ? "active" : ""}`} onClick={() => setTab("pending")}>消込待ち <span>{stats.pendingCount}</span></button>
                <button className={`dpf-tab ${tab === "done" ? "active" : ""}`} onClick={() => setTab("done")}>処理済み <span>{stats.doneCount}</span></button>
                <button className={`dpf-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>すべて <span>{apps.length}</span></button>
              </div>
            </div>
            <div className="dpf-list">
              {filtered.length === 0 && <div className="dpf-empty">該当する申請はありません</div>}
              {filtered.map((a) => (
                <button key={a.id} className={`dpf-card ${a.id === selected?.id ? "active" : ""}`} onClick={() => setSelectedId(a.id)}>
                  <div className="dpf-card-top">
                    <span className="dpf-card-id mono">{a.id}</span>
                    <span className="dpf-status-chip" style={{ background: `${STATUS_COLOR[a.status]}15`, color: STATUS_COLOR[a.status] }}>
                      {a.status}
                    </span>
                  </div>
                  <div className="dpf-card-main">
                    <div>
                      <div className="dpf-card-member">{a.memberName}</div>
                      <div className="dpf-card-memberid mono">{a.memberId}</div>
                    </div>
                    <div className="dpf-card-amount">¥{a.totalAmount.toLocaleString()}</div>
                  </div>
                  <div className="dpf-card-foot">
                    <span><Wallet size={11} /> {a.paymentMethod}</span>
                    <span><Calendar size={11} /> {a.scheduledDate}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="dpf-detail-col">
            {selected ? (
              <DepositFinanceDetail
                app={selected}
                onClose={() => openClose(selected.id)}
                onReject={() => { setRejectComment(""); setRejectOpen(selected.id); }}
              />
            ) : <div className="dpf-empty large">申請を選択してください</div>}
          </div>
        </div>
      </main>

      {closeOpen && (() => {
        const a = apps.find((x) => x.id === closeOpen);
        if (!a) return null;
        return (
          <div className="dpf-modal-bg" onClick={() => setCloseOpen(null)}>
            <div className="dpf-modal large" onClick={(e) => e.stopPropagation()}>
              <button className="dpf-modal-close" onClick={() => setCloseOpen(null)}><X size={18} /></button>
              <h3><Calculator size={20} /> Oracle 消込処理</h3>
              <p>{a.memberName}（{a.memberId}）の ¥{a.totalAmount.toLocaleString()} 入金を Oracle 側の請求テーブルへ消込処理します。</p>
              <div className="dpf-modal-invoice">
                {a.items.map((it) => (
                  <div key={it.id} className="dpf-invoice-row">
                    <div>
                      <div className="dpf-invoice-label">{it.label}</div>
                      <div className="dpf-invoice-meta mono">{it.oracleInvoiceId}</div>
                    </div>
                    <div className="dpf-invoice-amount">¥{it.amount.toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className="dpf-modal-grid">
                <div className="dpf-form-row">
                  <label>入金確認日 <span className="req">*</span></label>
                  <input type="date" value={form.receiptDate} onChange={(e) => setForm({ ...form, receiptDate: e.target.value })} />
                </div>
                <div className="dpf-form-row">
                  <label>Oracle バッチID <span className="req">*</span></label>
                  <input type="text" value={form.oracleBatchId} onChange={(e) => setForm({ ...form, oracleBatchId: e.target.value })} />
                </div>
                <div className="dpf-form-row full">
                  <label>備考（任意）</label>
                  <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </div>
              </div>
              <div className="dpf-modal-actions">
                <button className="dpf-btn ghost" onClick={() => setCloseOpen(null)}>キャンセル</button>
                <button className="dpf-btn primary" onClick={doClose}><Check size={14} /> 消込処理を実行</button>
              </div>
            </div>
          </div>
        );
      })()}

      {rejectOpen && (
        <div className="dpf-modal-bg" onClick={() => setRejectOpen(null)}>
          <div className="dpf-modal" onClick={(e) => e.stopPropagation()}>
            <button className="dpf-modal-close" onClick={() => setRejectOpen(null)}><X size={18} /></button>
            <div className="dpf-modal-icon danger"><X size={28} /></div>
            <h3 className="center">経理から差戻し</h3>
            <p className="center">承認者・申請者へ通知されます。差戻し理由を入力してください。</p>
            <textarea className="dpf-modal-input" rows={4} value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} placeholder="差戻し理由（必須）" />
            <div className="dpf-modal-actions">
              <button className="dpf-btn ghost" onClick={() => setRejectOpen(null)}>キャンセル</button>
              <button className="dpf-btn danger" onClick={doReject}><X size={14} /> 差戻す</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .dpf-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .dpf-header { background: #fff; height: 72px; border-bottom: 2px solid #8b5cf6; position: sticky; top: 0; z-index: 50; }
        .dpf-header-inner { max-width: 1400px; margin: 0 auto; height: 100%; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
        .dpf-brand { display: flex; align-items: center; gap: 20px; }
        .dpf-back-link { color: #94a3b8; display: flex; }
        .dpf-back-link:hover { color: #8b5cf6; }
        .dpf-main-title { font-size: 18px; font-weight: 800; margin: 0; color: #1e293b; }
        .dpf-sub-title { font-size: 13px; color: #64748b; font-weight: 600; margin: 0; }
        .dpf-data-badge { display: flex; align-items: center; gap: 6px; background: #f5f3ff; color: #6d28d9; padding: 6px 12px; border-radius: 20px; border: 1px solid #ddd6fe; font-size: 11px; font-weight: 700; }

        .dpf-container { max-width: 1400px; margin: 0 auto; padding: 24px; }

        .dpf-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .dpf-stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; border-left: 4px solid var(--c); }
        .dpf-stat-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .dpf-stat-num { font-size: 26px; font-weight: 900; color: #0f172a; line-height: 1; }
        .dpf-stat-num small { font-size: 14px; color: #94a3b8; margin-left: 4px; }
        .dpf-stat-sub { font-size: 11px; color: #94a3b8; margin-top: 6px; font-weight: 600; }

        .dpf-layout { display: grid; grid-template-columns: 420px 1fr; gap: 20px; }
        .dpf-list-col { display: flex; flex-direction: column; gap: 12px; }
        .dpf-list-controls { display: flex; flex-direction: column; gap: 10px; }
        .dpf-search-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #94a3b8; }
        .dpf-search-bar:focus-within { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15); }
        .dpf-search-bar input { flex: 1; border: none; outline: none; font-size: 13px; background: transparent; }
        .dpf-tabs { display: flex; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 10px; }
        .dpf-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 8px; border: none; background: transparent; border-radius: 7px; font-size: 12px; font-weight: 700; color: #64748b; cursor: pointer; }
        .dpf-tab.active { background: #fff; color: #6d28d9; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        .dpf-tab span { font-size: 10px; padding: 1px 6px; background: #e2e8f0; color: #64748b; border-radius: 8px; font-weight: 800; }
        .dpf-tab.active span { background: #f5f3ff; color: #6d28d9; }

        .dpf-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 280px); overflow-y: auto; }
        .dpf-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; text-align: left; cursor: pointer; transition: 0.15s; display: flex; flex-direction: column; gap: 8px; }
        .dpf-card:hover { border-color: #c4b5fd; }
        .dpf-card.active { border-color: #8b5cf6; background: #faf5ff; }
        .dpf-card-top { display: flex; justify-content: space-between; align-items: center; }
        .dpf-card-id { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: #475569; }
        .dpf-status-chip { font-size: 10px; font-weight: 800; padding: 3px 10px; border-radius: 20px; }
        .dpf-card-main { display: flex; justify-content: space-between; align-items: center; }
        .dpf-card-member { font-size: 14px; font-weight: 800; color: #0f172a; }
        .dpf-card-memberid { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .dpf-card-amount { font-size: 18px; font-weight: 900; color: #6d28d9; }
        .dpf-card-foot { display: flex; gap: 10px; font-size: 11px; color: #64748b; font-weight: 600; }
        .dpf-card-foot span { display: flex; align-items: center; gap: 4px; }
        .dpf-empty { padding: 32px 20px; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; background: #fff; border: 1px dashed #e2e8f0; border-radius: 12px; }
        .dpf-empty.large { padding: 80px 20px; }

        .dpf-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .dpf-modal { background: #fff; border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; position: relative; }
        .dpf-modal.large { max-width: 640px; }
        .dpf-modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #94a3b8; cursor: pointer; }
        .dpf-modal h3 { font-size: 20px; font-weight: 800; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; color: #6d28d9; }
        .dpf-modal h3.center { justify-content: center; }
        .dpf-modal p { font-size: 13px; color: #64748b; margin: 0 0 16px; line-height: 1.6; }
        .dpf-modal p.center { text-align: center; }
        .dpf-modal-icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
        .dpf-modal-icon.danger { background: #fee2e2; color: #dc2626; }
        .dpf-modal-invoice { background: #faf5ff; border: 1px solid #ddd6fe; border-radius: 10px; padding: 14px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
        .dpf-invoice-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #fff; border-radius: 6px; }
        .dpf-invoice-label { font-size: 13px; font-weight: 700; }
        .dpf-invoice-meta { font-size: 10px; color: #94a3b8; font-weight: 600; margin-top: 2px; }
        .dpf-invoice-amount { font-size: 14px; font-weight: 800; color: #6d28d9; }
        .dpf-modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .dpf-form-row { display: flex; flex-direction: column; gap: 4px; }
        .dpf-form-row.full { grid-column: span 2; }
        .dpf-form-row label { font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; }
        .dpf-form-row .req { color: #ef4444; }
        .dpf-form-row input, .dpf-form-row textarea { padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-family: inherit; box-sizing: border-box; }
        .dpf-form-row input:focus, .dpf-form-row textarea:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15); }
        .dpf-modal-input { width: 100%; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; font-family: inherit; box-sizing: border-box; }
        .dpf-modal-input:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15); }
        .dpf-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

        .dpf-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 800; cursor: pointer; border: none; }
        .dpf-btn.primary { background: #8b5cf6; color: #fff; }
        .dpf-btn.primary:hover { background: #7c3aed; }
        .dpf-btn.danger { background: #ef4444; color: #fff; }
        .dpf-btn.danger:hover { background: #dc2626; }
        .dpf-btn.outline { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
        .dpf-btn.ghost { background: transparent; color: #94a3b8; }
        .dpf-btn.ghost:hover { color: #475569; }

        @media (max-width: 1024px) {
          .dpf-layout { grid-template-columns: 1fr; }
          .dpf-stats { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}

function DepositFinanceDetail({ app, onClose, onReject }: { app: DepositApp; onClose: () => void; onReject: () => void }) {
  const canAct = app.status === "経理処理待ち";
  return (
    <div className="dfp">
      <div className="dfp-head">
        <div>
          <div className="dfp-id mono">{app.id}</div>
          <div className="dfp-title">{app.memberName} <span className="dfp-memberid">({app.memberId})</span></div>
        </div>
        <div className="dfp-amount">
          <span>入金合計</span>
          <strong>¥{app.totalAmount.toLocaleString()}</strong>
        </div>
      </div>

      <div className="dfp-grid">
        <div className="dfp-field"><div className="dfp-label">入金方法</div><div className="dfp-value"><Wallet size={12} /> {app.paymentMethod}</div></div>
        <div className="dfp-field"><div className="dfp-label">入金予定日</div><div className="dfp-value mono">{app.scheduledDate}</div></div>
        <div className="dfp-field"><div className="dfp-label">申請者</div><div className="dfp-value">{app.applicantName}</div></div>
        <div className="dfp-field"><div className="dfp-label">承認者</div><div className="dfp-value">{app.approverName}<br /><span className="dfp-value-sub mono">{app.approvedAt}</span></div></div>
      </div>

      <section className="dfp-section">
        <div className="dfp-section-title"><Receipt size={14} /> 消込対象（Oracle請求テーブル）</div>
        <div className="dfp-items">
          {app.items.map((it) => (
            <div className="dfp-item" key={it.id}>
              <div>
                <div className="dfp-item-label">{it.label}</div>
                <div className="dfp-item-meta">
                  <span className="dfp-item-cat">{it.category}</span>
                  <span>請求月: {it.targetMonth}</span>
                  <span className="mono">INV: {it.oracleInvoiceId}</span>
                </div>
              </div>
              <div className="dfp-item-amount">¥{it.amount.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </section>

      {(app.memo || app.approverComment) && (
        <section className="dfp-section">
          <div className="dfp-section-title"><FileText size={14} /> 備考 / 承認コメント</div>
          {app.memo && <div className="dfp-reason">{app.memo}</div>}
          {app.approverComment && <div className="dfp-approver-comment"><strong>承認者：</strong>{app.approverComment}</div>}
        </section>
      )}

      {app.closing && (
        <section className="dfp-section">
          <div className="dfp-section-title"><Calculator size={14} /> 消込実行記録</div>
          <div className="dfp-remit">
            <div><span>消込実行日時</span><strong className="mono">{app.closing.closedAt}</strong></div>
            <div><span>入金確認日</span><strong>{app.closing.receiptDate}</strong></div>
            <div><span>Oracle バッチ</span><strong className="mono">{app.closing.oracleBatchId}</strong></div>
            <div><span>処理担当</span><strong>{app.closing.operator}</strong></div>
            {app.closing.note && <div className="dfp-remit-full"><span>備考</span><strong>{app.closing.note}</strong></div>}
          </div>
        </section>
      )}

      <div className="dfp-actions">
        {canAct ? (
          <>
            <button className="dpf-btn outline" style={{ color: "#ef4444", borderColor: "#fecaca" }} onClick={onReject}>
              <X size={14} /> 差戻し
            </button>
            <button className="dpf-btn primary" onClick={onClose}>
              <Calculator size={14} /> 消込処理を実行
            </button>
          </>
        ) : (
          <div className="dfp-acted" style={{ background: `${STATUS_COLOR[app.status]}15`, color: STATUS_COLOR[app.status] }}>
            <Check size={14} /> {app.status}
          </div>
        )}
      </div>

      <style jsx>{`
        .dfp { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 20px; }
        .dfp-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
        .dfp-id { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: #94a3b8; }
        .dfp-title { font-size: 22px; font-weight: 900; color: #0f172a; margin-top: 4px; }
        .dfp-memberid { font-size: 13px; color: #94a3b8; font-weight: 600; }
        .dfp-amount { text-align: right; }
        .dfp-amount span { display: block; font-size: 11px; color: #94a3b8; font-weight: 700; }
        .dfp-amount strong { font-size: 26px; font-weight: 900; color: #6d28d9; }

        .dfp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .dfp-field { background: #f8fafc; border-radius: 10px; padding: 10px 14px; }
        .dfp-label { font-size: 10px; font-weight: 800; color: #94a3b8; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px; }
        .dfp-value { font-size: 13px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 4px; }
        .dfp-value-sub { font-size: 10px; color: #94a3b8; font-weight: 500; }
        :global(.mono) { font-family: 'SF Mono', Menlo, monospace; }

        .dfp-section { display: flex; flex-direction: column; gap: 10px; }
        .dfp-section-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .dfp-items { display: flex; flex-direction: column; gap: 6px; }
        .dfp-item { display: flex; justify-content: space-between; padding: 12px 16px; background: #f8fafc; border-radius: 10px; }
        .dfp-item-label { font-size: 13px; font-weight: 700; }
        .dfp-item-meta { font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 4px; display: flex; gap: 10px; flex-wrap: wrap; }
        .dfp-item-cat { padding: 1px 6px; border-radius: 4px; background: #e2e8f0; color: #475569; }
        .dfp-item-amount { font-size: 14px; font-weight: 800; color: #6d28d9; }

        .dfp-reason { padding: 14px 16px; background: #f8fafc; border-radius: 10px; font-size: 13px; line-height: 1.6; }
        .dfp-approver-comment { padding: 12px 16px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; font-size: 12px; color: #92400e; font-style: italic; margin-top: 8px; }

        .dfp-remit { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px; background: #f0fdf4; border-radius: 10px; }
        .dfp-remit > div { display: flex; flex-direction: column; gap: 2px; }
        .dfp-remit span { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .dfp-remit strong { font-size: 13px; color: #0f172a; font-weight: 700; }
        .dfp-remit-full { grid-column: span 2; }

        .dfp-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
        .dfp-acted { padding: 10px 16px; border-radius: 10px; display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; }

        @media (max-width: 768px) {
          .dfp-grid, .dfp-remit { grid-template-columns: repeat(2, 1fr); }
          .dfp-remit-full { grid-column: span 2; }
        }
      `}</style>
    </div>
  );
}
