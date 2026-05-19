"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Search, Check, X, Database, Clock,
  Receipt, FileText, ShieldCheck, RotateCcw, Wallet, Calendar
} from "lucide-react";

type StepState = "完了" | "対応中" | "未対応" | "差戻し";
type Approver = { role: string; name: string; dept: string; email: string };
type DepositApp = {
  id: string;
  applicantName: string;
  applicantEmail: string;
  applicantDept: string;
  memberId: string;
  memberName: string;
  items: { id: string; label: string; amount: number; targetMonth: string; category: string }[];
  totalAmount: number;
  paymentMethod: string;
  scheduledDate: string;
  memo?: string;
  status: "承認待ち" | "承認済み" | "差戻し" | "経理処理中" | "完了";
  submittedAt: string;
  myAction?: { state: "完了" | "差戻し"; actedAt: string; comment?: string };
  steps: { approver: Approver; state: StepState; actedAt?: string; comment?: string }[];
};

const APPROVERS = {
  applicant: { role: "申請者", name: "遠藤 涼平", dept: "旭川アモール 店舗", email: "r-endo@okamoto-group.co.jp" },
  approver: { role: "承認者", name: "後藤 充洋", dept: "旭川アモール 店長", email: "goto@fit365.jp" },
  finance: { role: "経理部", name: "経理部 担当", dept: "本部 経理部", email: "keiri@fit365.jp" },
};

const MOCK_APPS: DepositApp[] = [
  {
    id: "DP-20260511-001",
    applicantName: "遠藤 涼平", applicantEmail: "r-endo@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0001234", memberName: "山田 太郎",
    items: [
      { id: "u1", label: "月会費（2026年3月分）", amount: 7980, targetMonth: "2026-03", category: "月会費" },
      { id: "u2", label: "FIT365あんしんサポート（3月分）", amount: 550, targetMonth: "2026-03", category: "オプション" },
    ],
    totalAmount: 8530,
    paymentMethod: "現金",
    scheduledDate: "2026-05-12",
    memo: "来店時に現金で受領、領収書発行済",
    status: "承認待ち",
    submittedAt: "2026-05-11 16:40",
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-05-11 16:40" },
      { approver: APPROVERS.approver, state: "対応中" },
      { approver: APPROVERS.finance, state: "未対応" },
    ],
  },
  {
    id: "DP-20260511-002",
    applicantName: "佐藤 由美", applicantEmail: "y-sato@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0004567", memberName: "高橋 美咲",
    items: [
      { id: "u5", label: "月会費（2026年2月分）", amount: 1980, targetMonth: "2026-02", category: "月会費" },
      { id: "u6", label: "月会費（2026年3月分）", amount: 1980, targetMonth: "2026-03", category: "月会費" },
      { id: "u8", label: "事務手数料", amount: 3300, targetMonth: "2026-02", category: "事務手数料" },
    ],
    totalAmount: 7260,
    paymentMethod: "銀行振込",
    scheduledDate: "2026-05-15",
    status: "承認待ち",
    submittedAt: "2026-05-11 11:20",
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-05-11 11:20" },
      { approver: APPROVERS.approver, state: "対応中" },
      { approver: APPROVERS.finance, state: "未対応" },
    ],
  },
  {
    id: "DP-20260509-003",
    applicantName: "山本 美穂", applicantEmail: "m-yamamoto@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0008912", memberName: "松本 拓海",
    items: [
      { id: "h1", label: "月会費（2026年4月分）", amount: 7980, targetMonth: "2026-04", category: "月会費" },
      { id: "h2", label: "FIT365あんしんサポート", amount: 1100, targetMonth: "2026-04", category: "オプション" },
    ],
    totalAmount: 9080,
    paymentMethod: "現金",
    scheduledDate: "2026-04-11",
    status: "承認済み",
    submittedAt: "2026-04-11 10:30",
    myAction: { state: "完了", actedAt: "2026-04-11 14:20", comment: "領収書確認しました" },
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-04-11 10:30" },
      { approver: APPROVERS.approver, state: "完了", actedAt: "2026-04-11 14:20", comment: "領収書確認しました" },
      { approver: APPROVERS.finance, state: "完了", actedAt: "2026-04-11 18:15", comment: "Oracle 消込完了" },
    ],
  },
  {
    id: "DP-20260403-004",
    applicantName: "高橋 健", applicantEmail: "k-takahashi@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0006543", memberName: "渡辺 結衣",
    items: [
      { id: "x1", label: "事務手数料", amount: 3300, targetMonth: "2026-03", category: "事務手数料" },
    ],
    totalAmount: 3300,
    paymentMethod: "クレジット再請求",
    scheduledDate: "2026-04-20",
    status: "差戻し",
    submittedAt: "2026-04-03 15:00",
    myAction: { state: "差戻し", actedAt: "2026-04-04 09:30", comment: "クレジット再請求の場合は SBPS の照会番号を備考に記載してください" },
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-04-03 15:00" },
      { approver: APPROVERS.approver, state: "差戻し", actedAt: "2026-04-04 09:30", comment: "クレジット再請求の場合は SBPS の照会番号を備考に記載してください" },
      { approver: APPROVERS.finance, state: "未対応" },
    ],
  },
];

const STATE_COLOR: Record<StepState, string> = {
  完了: "#10b981", 対応中: "#f59e0b", 未対応: "#cbd5e1", 差戻し: "#ef4444",
};
const STATUS_COLOR: Record<DepositApp["status"], string> = {
  承認待ち: "#f59e0b", 承認済み: "#10b981", 差戻し: "#ef4444", 経理処理中: "#8b5cf6", 完了: "#10b981",
};

export default function DepositApproverPage() {
  const shopName = "旭川アモール";
  const shopId = "000121";

  const [apps, setApps] = useState<DepositApp[]>(MOCK_APPS);
  const [tab, setTab] = useState<"pending" | "processed" | "all">("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(MOCK_APPS[0]?.id ?? null);
  const [actionModal, setActionModal] = useState<null | { type: "approve" | "reject"; id: string }>(null);
  const [comment, setComment] = useState("");

  const filtered = useMemo(() => {
    return apps.filter((a) => {
      if (tab === "pending" && a.status !== "承認待ち") return false;
      if (tab === "processed" && a.status === "承認待ち") return false;
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

  const counts = {
    pending: apps.filter((a) => a.status === "承認待ち").length,
    processed: apps.filter((a) => a.status !== "承認待ち").length,
    all: apps.length,
    todayActed: apps.filter((a) => a.myAction?.actedAt?.startsWith("2026-05")).length,
    returned: apps.filter((a) => a.status === "差戻し" && a.myAction?.state === "差戻し").length,
  };

  const doAction = () => {
    if (!actionModal) return;
    const isApprove = actionModal.type === "approve";
    if (!isApprove && !comment.trim()) {
      alert("差戻しコメントを入力してください");
      return;
    }
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10) + " " + now.toTimeString().slice(0, 5);
    setApps((prev) => prev.map((a) => {
      if (a.id !== actionModal.id) return a;
      const newSteps = a.steps.map((s, idx) => {
        if (idx === 1) return { ...s, state: (isApprove ? "完了" : "差戻し") as StepState, actedAt: stamp, comment: comment || undefined };
        if (idx === 2 && isApprove) return { ...s, state: "対応中" as StepState };
        return s;
      });
      return {
        ...a,
        status: isApprove ? "経理処理中" : "差戻し",
        myAction: { state: isApprove ? "完了" : "差戻し", actedAt: stamp, comment: comment || undefined },
        steps: newSteps,
      };
    }));
    setActionModal(null); setComment("");
  };

  return (
    <div className="dpap-root">
      <header className="dpap-header">
        <div className="dpap-header-inner">
          <div className="dpap-brand">
            <Link href="/store-settings/refund-payment" className="dpap-back-link"><ArrowLeft size={20} /></Link>
            <div>
              <h1 className="dpap-main-title">入金申請 承認者画面</h1>
              <p className="dpap-sub-title">{shopId} {shopName} ／ 承認者: {APPROVERS.approver.name}</p>
            </div>
          </div>
          <div className="dpap-data-badge"><Database size={14} /><span>Oracle 連携</span></div>
        </div>
      </header>

      <main className="dpap-container">
        <div className="dpap-stats">
          <div className="dpap-stat" style={{ ["--c" as any]: "#f59e0b" }}>
            <div className="dpap-stat-label"><Clock size={14} /> 承認待ち</div>
            <div className="dpap-stat-num">{counts.pending}</div>
            <div className="dpap-stat-sub">あなた宛て</div>
          </div>
          <div className="dpap-stat" style={{ ["--c" as any]: "#10b981" }}>
            <div className="dpap-stat-label"><ShieldCheck size={14} /> 今月対応</div>
            <div className="dpap-stat-num">{counts.todayActed}</div>
            <div className="dpap-stat-sub">承認 / 差戻し</div>
          </div>
          <div className="dpap-stat" style={{ ["--c" as any]: "#ef4444" }}>
            <div className="dpap-stat-label"><RotateCcw size={14} /> 差戻し</div>
            <div className="dpap-stat-num">{counts.returned}</div>
            <div className="dpap-stat-sub">再申請待ち</div>
          </div>
          <div className="dpap-stat" style={{ ["--c" as any]: "#0ea5e9" }}>
            <div className="dpap-stat-label"><Receipt size={14} /> 全申請</div>
            <div className="dpap-stat-num">{counts.all}</div>
            <div className="dpap-stat-sub">直近30日</div>
          </div>
        </div>

        <div className="dpap-layout">
          <div className="dpap-list-col">
            <div className="dpap-list-controls">
              <div className="dpap-search-bar">
                <Search size={14} />
                <input placeholder="申請ID / 会員 / 申請者 / 入金方法 で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="dpap-tabs">
                <button className={`dpap-tab ${tab === "pending" ? "active" : ""}`} onClick={() => setTab("pending")}>承認待ち <span>{counts.pending}</span></button>
                <button className={`dpap-tab ${tab === "processed" ? "active" : ""}`} onClick={() => setTab("processed")}>処理済み <span>{counts.processed}</span></button>
                <button className={`dpap-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>すべて <span>{counts.all}</span></button>
              </div>
            </div>
            <div className="dpap-list">
              {filtered.length === 0 && <div className="dpap-empty">該当する申請はありません</div>}
              {filtered.map((a) => (
                <button key={a.id} className={`dpap-card ${a.id === selected?.id ? "active" : ""}`} onClick={() => setSelectedId(a.id)}>
                  <div className="dpap-card-top">
                    <span className="dpap-card-id mono">{a.id}</span>
                    <span className="dpap-status-chip" style={{ background: `${STATUS_COLOR[a.status]}15`, color: STATUS_COLOR[a.status] }}>
                      {a.status}
                    </span>
                  </div>
                  <div className="dpap-card-main">
                    <div>
                      <div className="dpap-card-member">{a.memberName}</div>
                      <div className="dpap-card-memberid mono">{a.memberId}</div>
                    </div>
                    <div className="dpap-card-amount">¥{a.totalAmount.toLocaleString()}</div>
                  </div>
                  <div className="dpap-card-foot">
                    <span><Wallet size={11} /> {a.paymentMethod}</span>
                    <span><Calendar size={11} /> {a.scheduledDate}</span>
                    <span className="dpap-card-date">{a.applicantName} さん</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="dpap-detail-col">
            {selected ? (
              <DepositDetailPanel
                app={selected}
                onApprove={() => { setComment(""); setActionModal({ type: "approve", id: selected.id }); }}
                onReject={() => { setComment(""); setActionModal({ type: "reject", id: selected.id }); }}
              />
            ) : <div className="dpap-empty large">申請を選択してください</div>}
          </div>
        </div>
      </main>

      {actionModal && (
        <div className="dpap-modal-bg" onClick={() => setActionModal(null)}>
          <div className="dpap-modal" onClick={(e) => e.stopPropagation()}>
            <button className="dpap-modal-close" onClick={() => setActionModal(null)}><X size={18} /></button>
            <div className="dpap-modal-icon" style={{ background: actionModal.type === "approve" ? "#d1fae5" : "#fee2e2", color: actionModal.type === "approve" ? "#059669" : "#dc2626" }}>
              {actionModal.type === "approve" ? <Check size={28} /> : <X size={28} />}
            </div>
            <h3>{actionModal.type === "approve" ? "この入金を承認しますか？" : "差戻しを実行しますか？"}</h3>
            <p>{actionModal.type === "approve" ? "承認後、経理部で Oracle 消込処理が行われます。" : "申請者に通知され、修正・再申請が可能になります。"}</p>
            <textarea className="dpap-modal-input" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={actionModal.type === "approve" ? "承認コメント（任意）" : "差戻し理由（必須）"} />
            <div className="dpap-modal-actions">
              <button className="dpap-btn ghost" onClick={() => setActionModal(null)}>キャンセル</button>
              <button className={`dpap-btn ${actionModal.type === "approve" ? "primary" : "danger"}`} onClick={doAction}>
                {actionModal.type === "approve" ? <><Check size={14} /> 承認する</> : <><X size={14} /> 差戻す</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .dpap-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .dpap-header { background: #fff; height: 72px; border-bottom: 2px solid #f59e0b; position: sticky; top: 0; z-index: 50; }
        .dpap-header-inner { max-width: 1400px; margin: 0 auto; height: 100%; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
        .dpap-brand { display: flex; align-items: center; gap: 20px; }
        .dpap-back-link { color: #94a3b8; display: flex; }
        .dpap-back-link:hover { color: #f59e0b; }
        .dpap-main-title { font-size: 18px; font-weight: 800; margin: 0; color: #1e293b; }
        .dpap-sub-title { font-size: 13px; color: #64748b; font-weight: 600; margin: 0; }
        .dpap-data-badge { display: flex; align-items: center; gap: 6px; background: #fef3c7; color: #b45309; padding: 6px 12px; border-radius: 20px; border: 1px solid #fde68a; font-size: 11px; font-weight: 700; }

        .dpap-container { max-width: 1400px; margin: 0 auto; padding: 24px; }

        .dpap-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .dpap-stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; border-left: 4px solid var(--c); }
        .dpap-stat-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .dpap-stat-num { font-size: 28px; font-weight: 900; color: #0f172a; line-height: 1; }
        .dpap-stat-sub { font-size: 11px; color: #94a3b8; margin-top: 4px; font-weight: 600; }

        .dpap-layout { display: grid; grid-template-columns: 420px 1fr; gap: 20px; }
        .dpap-list-col { display: flex; flex-direction: column; gap: 12px; }
        .dpap-list-controls { display: flex; flex-direction: column; gap: 10px; }
        .dpap-search-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #94a3b8; }
        .dpap-search-bar:focus-within { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15); }
        .dpap-search-bar input { flex: 1; border: none; outline: none; font-size: 13px; background: transparent; }
        .dpap-tabs { display: flex; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 10px; }
        .dpap-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 8px; border: none; background: transparent; border-radius: 7px; font-size: 12px; font-weight: 700; color: #64748b; cursor: pointer; }
        .dpap-tab.active { background: #fff; color: #b45309; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        .dpap-tab span { font-size: 10px; padding: 1px 6px; background: #e2e8f0; color: #64748b; border-radius: 8px; font-weight: 800; }
        .dpap-tab.active span { background: #fef3c7; color: #b45309; }

        .dpap-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 280px); overflow-y: auto; }
        .dpap-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; text-align: left; cursor: pointer; transition: 0.15s; display: flex; flex-direction: column; gap: 8px; }
        .dpap-card:hover { border-color: #fbbf24; }
        .dpap-card.active { border-color: #f59e0b; background: #fffbeb; }
        .dpap-card-top { display: flex; justify-content: space-between; align-items: center; }
        .dpap-card-id { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: #475569; }
        .dpap-status-chip { font-size: 10px; font-weight: 800; padding: 3px 10px; border-radius: 20px; }
        .dpap-card-main { display: flex; justify-content: space-between; align-items: center; }
        .dpap-card-member { font-size: 14px; font-weight: 800; color: #0f172a; }
        .dpap-card-memberid { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .dpap-card-amount { font-size: 18px; font-weight: 900; color: #047857; }
        .dpap-card-foot { display: flex; gap: 10px; font-size: 11px; color: #64748b; font-weight: 600; flex-wrap: wrap; align-items: center; }
        .dpap-card-foot span { display: flex; align-items: center; gap: 4px; }
        .dpap-card-date { color: #94a3b8; margin-left: auto; }
        .dpap-empty { padding: 32px 20px; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; background: #fff; border: 1px dashed #e2e8f0; border-radius: 12px; }
        .dpap-empty.large { padding: 80px 20px; }

        .dpap-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .dpap-modal { background: #fff; border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; position: relative; }
        .dpap-modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #94a3b8; cursor: pointer; }
        .dpap-modal-icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
        .dpap-modal h3 { font-size: 18px; font-weight: 800; margin: 0 0 8px; text-align: center; }
        .dpap-modal p { font-size: 13px; color: #64748b; margin: 0 0 16px; text-align: center; line-height: 1.6; }
        .dpap-modal-input { width: 100%; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; font-family: inherit; box-sizing: border-box; }
        .dpap-modal-input:focus { outline: none; border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15); }
        .dpap-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

        .dpap-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 800; cursor: pointer; border: none; }
        .dpap-btn.primary { background: #10b981; color: #fff; }
        .dpap-btn.primary:hover { background: #059669; }
        .dpap-btn.danger { background: #ef4444; color: #fff; }
        .dpap-btn.danger:hover { background: #dc2626; }
        .dpap-btn.ghost { background: transparent; color: #94a3b8; }
        .dpap-btn.outline { background: #fff; color: #475569; border: 1px solid #cbd5e1; }

        @media (max-width: 1024px) {
          .dpap-layout { grid-template-columns: 1fr; }
          .dpap-stats { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}

function DepositDetailPanel({ app, onApprove, onReject }: { app: DepositApp; onApprove: () => void; onReject: () => void }) {
  const canAct = app.status === "承認待ち";
  return (
    <div className="dd-panel">
      <div className="dd-head">
        <div>
          <div className="dd-id mono">{app.id}</div>
          <div className="dd-title">{app.memberName} <span className="dd-memberid">({app.memberId})</span></div>
        </div>
        <div className="dd-amount">
          <span>入金合計</span>
          <strong>¥{app.totalAmount.toLocaleString()}</strong>
        </div>
      </div>

      <div className="dd-grid">
        <div className="dd-field">
          <div className="dd-label">入金方法</div>
          <div className="dd-value"><Wallet size={12} /> {app.paymentMethod}</div>
        </div>
        <div className="dd-field">
          <div className="dd-label">入金予定日</div>
          <div className="dd-value mono">{app.scheduledDate}</div>
        </div>
        <div className="dd-field">
          <div className="dd-label">申請日時</div>
          <div className="dd-value mono">{app.submittedAt}</div>
        </div>
        <div className="dd-field">
          <div className="dd-label">申請者</div>
          <div className="dd-value">{app.applicantName}</div>
          <div className="dd-value-sub">{app.applicantDept} / {app.applicantEmail}</div>
        </div>
      </div>

      <section className="dd-section">
        <div className="dd-section-title"><Receipt size={14} /> 入金対象項目</div>
        <div className="dd-items">
          {app.items.map((it) => (
            <div className="dd-item" key={it.id}>
              <div>
                <div className="dd-item-label">{it.label}</div>
                <div className="dd-item-meta">
                  <span className="dd-item-cat">{it.category}</span>
                  <span>請求月: {it.targetMonth}</span>
                </div>
              </div>
              <div className="dd-item-amount">¥{it.amount.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </section>

      {app.memo && (
        <section className="dd-section">
          <div className="dd-section-title"><FileText size={14} /> 備考</div>
          <div className="dd-reason">{app.memo}</div>
        </section>
      )}

      <section className="dd-section">
        <div className="dd-section-title">承認進捗</div>
        <div className="dd-timeline">
          {app.steps.map((s, idx) => (
            <div className="dd-tl-item" key={idx}>
              <div className="dd-tl-marker" style={{ background: STATE_COLOR[s.state] }}>
                {s.state === "完了" && <Check size={12} />}
                {s.state === "差戻し" && <X size={12} />}
              </div>
              <div className="dd-tl-body">
                <div className="dd-tl-head">
                  <span className="dd-tl-role">{s.approver.role}</span>
                  <span className="dd-tl-state" style={{ color: STATE_COLOR[s.state] }}>{s.state}</span>
                </div>
                <div className="dd-tl-name">{s.approver.name} <span>{s.approver.dept}</span></div>
                {s.actedAt && <div className="dd-tl-time mono">{s.actedAt}</div>}
                {s.comment && <div className="dd-tl-comment">「{s.comment}」</div>}
              </div>
              {idx < app.steps.length - 1 && <div className="dd-tl-bar" />}
            </div>
          ))}
        </div>
      </section>

      <div className="dd-actions">
        {canAct ? (
          <>
            <button className="dpap-btn outline" style={{ color: "#ef4444", borderColor: "#fecaca" }} onClick={onReject}>
              <X size={14} /> 差戻し
            </button>
            <button className="dpap-btn primary" onClick={onApprove}>
              <Check size={14} /> この入金を承認する
            </button>
          </>
        ) : (
          <div className="dd-acted" style={{ background: `${STATUS_COLOR[app.status]}15`, color: STATUS_COLOR[app.status] }}>
            <Check size={14} /> 処理済み — {app.myAction?.state} @ {app.myAction?.actedAt}
          </div>
        )}
      </div>

      <style jsx>{`
        .dd-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 20px; }
        .dd-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
        .dd-id { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: #94a3b8; }
        .dd-title { font-size: 22px; font-weight: 900; color: #0f172a; margin-top: 4px; }
        .dd-memberid { font-size: 13px; color: #94a3b8; font-weight: 600; }
        .dd-amount { text-align: right; }
        .dd-amount span { display: block; font-size: 11px; color: #94a3b8; font-weight: 700; }
        .dd-amount strong { font-size: 26px; font-weight: 900; color: #047857; }

        .dd-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .dd-field { background: #f8fafc; border-radius: 10px; padding: 10px 14px; }
        .dd-label { font-size: 10px; font-weight: 800; color: #94a3b8; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px; }
        .dd-value { font-size: 13px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 4px; }
        .dd-value-sub { font-size: 11px; color: #94a3b8; font-weight: 500; margin-top: 2px; }
        :global(.mono) { font-family: 'SF Mono', Menlo, monospace; }

        .dd-section { display: flex; flex-direction: column; gap: 10px; }
        .dd-section-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .dd-items { display: flex; flex-direction: column; gap: 6px; }
        .dd-item { display: flex; justify-content: space-between; padding: 12px 16px; background: #f8fafc; border-radius: 10px; }
        .dd-item-label { font-size: 13px; font-weight: 700; }
        .dd-item-meta { font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 4px; display: flex; gap: 10px; }
        .dd-item-cat { padding: 1px 6px; border-radius: 4px; background: #e2e8f0; color: #475569; }
        .dd-item-amount { font-size: 14px; font-weight: 800; color: #047857; }

        .dd-reason { padding: 14px 16px; background: #f8fafc; border-radius: 10px; font-size: 13px; line-height: 1.6; }

        .dd-timeline { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
        .dd-tl-item { display: grid; grid-template-columns: 28px 1fr; gap: 12px; position: relative; padding-bottom: 8px; }
        .dd-tl-marker { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; }
        .dd-tl-bar { position: absolute; left: 13px; top: 28px; bottom: -8px; width: 2px; background: #e2e8f0; }
        .dd-tl-head { display: flex; justify-content: space-between; align-items: center; }
        .dd-tl-role { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .dd-tl-state { font-size: 11px; font-weight: 800; }
        .dd-tl-name { font-size: 13px; font-weight: 700; color: #0f172a; }
        .dd-tl-name span { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .dd-tl-time { font-size: 11px; color: #94a3b8; }
        .dd-tl-comment { font-size: 12px; color: #475569; font-style: italic; background: #fef3c7; border-radius: 6px; padding: 6px 10px; margin-top: 4px; }

        .dd-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
        .dd-acted { padding: 10px 16px; border-radius: 10px; display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; }

        @media (max-width: 768px) {
          .dd-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}
