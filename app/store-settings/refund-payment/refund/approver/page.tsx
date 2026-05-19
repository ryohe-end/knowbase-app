"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Search, Check, X, AlertCircle, Database, Clock,
  ChevronRight, Send, CreditCard, Receipt, FileText, ShieldCheck, RotateCcw
} from "lucide-react";

// ---- 型 ----
type StepState = "完了" | "対応中" | "未対応" | "差戻し";
type Approver = { role: string; name: string; dept: string; email: string };
type Application = {
  id: string;
  applicantName: string;
  applicantEmail: string;
  applicantDept: string;
  memberId: string;
  memberName: string;
  targetMonthFrom: string;
  targetMonthTo: string;
  items: { id: string; label: string; amount: number; category: string }[];
  totalAmount: number;
  reason: string;
  account: { bankName: string; branchName: string; accountType: string; accountNumber: string; holderName: string };
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

const MOCK_APPS: Application[] = [
  {
    id: "RF-20260510-001",
    applicantName: "遠藤 涼平", applicantEmail: "r-endo@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0001234", memberName: "山田 太郎",
    targetMonthFrom: "2026-04", targetMonthTo: "2026-04",
    items: [{ id: "i1b", label: "月会費（4月分）", amount: 7980, category: "月会費" }],
    totalAmount: 7980,
    reason: "店舗都合による設備停止のため、4月分の月会費を返金します。",
    account: { bankName: "みずほ銀行", branchName: "旭川支店", accountType: "普通", accountNumber: "1234567", holderName: "ヤマダ タロウ" },
    status: "承認待ち",
    submittedAt: "2026-05-10 14:22",
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-05-10 14:22" },
      { approver: APPROVERS.approver, state: "対応中" },
      { approver: APPROVERS.finance, state: "未対応" },
    ],
  },
  {
    id: "RF-20260511-002",
    applicantName: "佐藤 由美", applicantEmail: "y-sato@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0007890", memberName: "井上 さくら",
    targetMonthFrom: "2026-03", targetMonthTo: "2026-04",
    items: [
      { id: "k1", label: "月会費（3月分）", amount: 7980, category: "月会費" },
      { id: "k2", label: "月会費（4月分）", amount: 7980, category: "月会費" },
      { id: "k3", label: "FIT365あんしんサポート", amount: 550, category: "オプション" },
    ],
    totalAmount: 16510,
    reason: "本人都合の長期療養により2ヶ月分を返金。診断書提出済み。",
    account: { bankName: "北海道銀行", branchName: "旭川中央支店", accountType: "普通", accountNumber: "5544332", holderName: "イノウエ サクラ" },
    status: "承認待ち",
    submittedAt: "2026-05-11 09:08",
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-05-11 09:08" },
      { approver: APPROVERS.approver, state: "対応中" },
      { approver: APPROVERS.finance, state: "未対応" },
    ],
  },
  {
    id: "RF-20260509-003",
    applicantName: "高橋 健", applicantEmail: "k-takahashi@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0003456", memberName: "鈴木 一郎",
    targetMonthFrom: "2026-03", targetMonthTo: "2026-03",
    items: [{ id: "x1", label: "月会費（3月分）", amount: 7980, category: "月会費" }],
    totalAmount: 7980,
    reason: "解約日の登録漏れ",
    account: { bankName: "三菱UFJ銀行", branchName: "札幌支店", accountType: "普通", accountNumber: "2233445", holderName: "スズキ イチロウ" },
    status: "承認済み",
    submittedAt: "2026-05-08 10:11",
    myAction: { state: "完了", actedAt: "2026-05-08 16:40", comment: "解約日確認しました。承認します。" },
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-05-08 10:11" },
      { approver: APPROVERS.approver, state: "完了", actedAt: "2026-05-08 16:40", comment: "解約日確認しました。承認します。" },
      { approver: APPROVERS.finance, state: "完了", actedAt: "2026-05-09 11:02", comment: "Oracle 連携完了" },
    ],
  },
  {
    id: "RF-20260505-004",
    applicantName: "遠藤 涼平", applicantEmail: "r-endo@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0002345", memberName: "佐藤 花子",
    targetMonthFrom: "2026-04", targetMonthTo: "2026-04",
    items: [{ id: "x2", label: "事務手数料", amount: 3300, category: "事務手数料" }],
    totalAmount: 3300,
    reason: "重複徴収",
    account: { bankName: "北海道銀行", branchName: "本店営業部", accountType: "普通", accountNumber: "7654321", holderName: "サトウ ハナコ" },
    status: "差戻し",
    submittedAt: "2026-05-05 09:30",
    myAction: { state: "差戻し", actedAt: "2026-05-06 13:15", comment: "二重徴収の証跡を添付してください。" },
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-05-05 09:30" },
      { approver: APPROVERS.approver, state: "差戻し", actedAt: "2026-05-06 13:15", comment: "二重徴収の証跡を添付してください。" },
      { approver: APPROVERS.finance, state: "未対応" },
    ],
  },
  {
    id: "RF-20260502-005",
    applicantName: "山本 美穂", applicantEmail: "m-yamamoto@okamoto-group.co.jp", applicantDept: "旭川アモール 店舗",
    memberId: "M0005678", memberName: "田中 健太",
    targetMonthFrom: "2026-02", targetMonthTo: "2026-03",
    items: [
      { id: "y1", label: "月会費（2月分）", amount: 5980, category: "月会費" },
      { id: "y2", label: "契約ロッカー", amount: 1100, category: "オプション" },
    ],
    totalAmount: 7080,
    reason: "解約日の遡及対応",
    account: { bankName: "ゆうちょ銀行", branchName: "〇五八支店", accountType: "普通", accountNumber: "8801234", holderName: "タナカ ケンタ" },
    status: "経理処理中",
    submittedAt: "2026-05-02 18:02",
    myAction: { state: "完了", actedAt: "2026-05-03 09:11", comment: "問題ありません" },
    steps: [
      { approver: APPROVERS.applicant, state: "完了", actedAt: "2026-05-02 18:02" },
      { approver: APPROVERS.approver, state: "完了", actedAt: "2026-05-03 09:11", comment: "問題ありません" },
      { approver: APPROVERS.finance, state: "対応中" },
    ],
  },
];

const STATE_COLOR: Record<StepState, string> = {
  完了: "#10b981", 対応中: "#f59e0b", 未対応: "#cbd5e1", 差戻し: "#ef4444",
};

const STATUS_COLOR: Record<Application["status"], string> = {
  承認待ち: "#f59e0b", 承認済み: "#10b981", 差戻し: "#ef4444", 経理処理中: "#8b5cf6", 完了: "#10b981",
};

export default function RefundApproverPage() {
  const shopName = "旭川アモール";
  const shopId = "000121";

  const [apps, setApps] = useState<Application[]>(MOCK_APPS);
  const [tab, setTab] = useState<"pending" | "processed" | "all">("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(MOCK_APPS[0]?.id ?? null);

  // モーダル
  const [actionModal, setActionModal] = useState<null | { type: "approve" | "reject"; appId: string }>(null);
  const [actionComment, setActionComment] = useState("");

  const filtered = useMemo(() => {
    return apps.filter((a) => {
      if (tab === "pending" && a.status !== "承認待ち") return false;
      if (tab === "processed" && a.status === "承認待ち") return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          a.id.toLowerCase().includes(q) ||
          a.applicantName.toLowerCase().includes(q) ||
          a.memberId.toLowerCase().includes(q) ||
          a.memberName.toLowerCase().includes(q) ||
          a.reason.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [apps, tab, search]);

  const selected = filtered.find((a) => a.id === selectedId) ?? filtered[0] ?? null;

  const counts = useMemo(() => ({
    pending: apps.filter((a) => a.status === "承認待ち").length,
    processed: apps.filter((a) => a.status !== "承認待ち").length,
    all: apps.length,
    todayActed: apps.filter((a) => a.myAction?.actedAt?.startsWith("2026-05")).length,
    returned: apps.filter((a) => a.status === "差戻し" && a.myAction?.state === "差戻し").length,
  }), [apps]);

  const openApprove = (id: string) => { setActionComment(""); setActionModal({ type: "approve", appId: id }); };
  const openReject = (id: string) => { setActionComment(""); setActionModal({ type: "reject", appId: id }); };

  const doAction = () => {
    if (!actionModal) return;
    const isApprove = actionModal.type === "approve";
    if (!isApprove && !actionComment.trim()) {
      alert("差戻しコメントを入力してください");
      return;
    }
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10) + " " + now.toTimeString().slice(0, 5);
    setApps((prev) => prev.map((a) => {
      if (a.id !== actionModal.appId) return a;
      const newSteps = a.steps.map((s, idx) => {
        if (idx === 1) {
          return { ...s, state: (isApprove ? "完了" : "差戻し") as StepState, actedAt: stamp, comment: actionComment || undefined };
        }
        if (idx === 2 && isApprove) {
          return { ...s, state: "対応中" as StepState };
        }
        return s;
      });
      return {
        ...a,
        status: isApprove ? "経理処理中" : "差戻し",
        myAction: { state: isApprove ? "完了" : "差戻し", actedAt: stamp, comment: actionComment || undefined },
        steps: newSteps,
      };
    }));
    setActionModal(null);
  };

  return (
    <div className="rfap-root">
      <header className="rfap-header">
        <div className="rfap-header-inner">
          <div className="rfap-brand">
            <Link href="/store-settings/refund-payment" className="rfap-back-link">
              <ArrowLeft size={20} />
            </Link>
            <div className="rfap-title-group">
              <h1 className="rfap-main-title">返金申請 承認者画面</h1>
              <p className="rfap-sub-title">{shopId} {shopName} ／ 承認者: {APPROVERS.approver.name}</p>
            </div>
          </div>
          <div className="rfap-data-badge">
            <Database size={14} /><span>Oracle 連携</span>
          </div>
        </div>
      </header>

      <main className="rfap-main">
        <div className="rfap-container">
          {/* 統計 */}
          <div className="rfap-stats">
            <div className="rfap-stat" style={{ ["--c" as any]: "#f59e0b" }}>
              <div className="rfap-stat-label"><Clock size={14} /> 承認待ち</div>
              <div className="rfap-stat-num">{counts.pending}</div>
              <div className="rfap-stat-sub">あなた宛て</div>
            </div>
            <div className="rfap-stat" style={{ ["--c" as any]: "#10b981" }}>
              <div className="rfap-stat-label"><ShieldCheck size={14} /> 今月対応</div>
              <div className="rfap-stat-num">{counts.todayActed}</div>
              <div className="rfap-stat-sub">承認 / 差戻し合計</div>
            </div>
            <div className="rfap-stat" style={{ ["--c" as any]: "#ef4444" }}>
              <div className="rfap-stat-label"><RotateCcw size={14} /> 差戻し</div>
              <div className="rfap-stat-num">{counts.returned}</div>
              <div className="rfap-stat-sub">再申請待ち</div>
            </div>
            <div className="rfap-stat" style={{ ["--c" as any]: "#0ea5e9" }}>
              <div className="rfap-stat-label"><Receipt size={14} /> 全申請</div>
              <div className="rfap-stat-num">{counts.all}</div>
              <div className="rfap-stat-sub">直近30日</div>
            </div>
          </div>

          <div className="rfap-layout">
            {/* 左: リスト */}
            <div className="rfap-list-col">
              <div className="rfap-list-controls">
                <div className="rfap-search-bar">
                  <Search size={14} />
                  <input
                    placeholder="申請ID / 申請者 / 会員 / 理由 で検索"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="rfap-tabs">
                  <button className={`rfap-tab ${tab === "pending" ? "active" : ""}`} onClick={() => setTab("pending")}>
                    承認待ち <span>{counts.pending}</span>
                  </button>
                  <button className={`rfap-tab ${tab === "processed" ? "active" : ""}`} onClick={() => setTab("processed")}>
                    処理済み <span>{counts.processed}</span>
                  </button>
                  <button className={`rfap-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
                    すべて <span>{counts.all}</span>
                  </button>
                </div>
              </div>

              <div className="rfap-list">
                {filtered.length === 0 && (
                  <div className="rfap-empty">該当する申請はありません</div>
                )}
                {filtered.map((a) => (
                  <button
                    key={a.id}
                    className={`rfap-card ${a.id === selected?.id ? "active" : ""}`}
                    onClick={() => setSelectedId(a.id)}
                  >
                    <div className="rfap-card-top">
                      <span className="rfap-card-id mono">{a.id}</span>
                      <span className="rfap-status-chip" style={{ background: `${STATUS_COLOR[a.status]}15`, color: STATUS_COLOR[a.status] }}>
                        {a.status}
                      </span>
                    </div>
                    <div className="rfap-card-main">
                      <div className="rfap-card-member">
                        <span>{a.memberName}</span>
                        <span className="rfap-card-memberid">{a.memberId}</span>
                      </div>
                      <div className="rfap-card-amount">¥{a.totalAmount.toLocaleString()}</div>
                    </div>
                    <div className="rfap-card-foot">
                      <span>{a.targetMonthFrom === a.targetMonthTo ? a.targetMonthFrom : `${a.targetMonthFrom}〜${a.targetMonthTo}`}</span>
                      <span className="rfap-card-applicant">{a.applicantName} さん</span>
                      <span className="rfap-card-date">{a.submittedAt.slice(0, 10)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 右: 詳細 */}
            <div className="rfap-detail-col">
              {selected ? (
                <DetailPanel
                  app={selected}
                  onApprove={() => openApprove(selected.id)}
                  onReject={() => openReject(selected.id)}
                />
              ) : (
                <div className="rfap-empty large">申請を選択してください</div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* アクションモーダル */}
      {actionModal && (
        <div className="rfap-modal-bg" onClick={() => setActionModal(null)}>
          <div className="rfap-modal" onClick={(e) => e.stopPropagation()}>
            <button className="rfap-modal-close" onClick={() => setActionModal(null)}><X size={18} /></button>
            <div className="rfap-modal-icon" style={{ background: actionModal.type === "approve" ? "#d1fae5" : "#fee2e2", color: actionModal.type === "approve" ? "#059669" : "#dc2626" }}>
              {actionModal.type === "approve" ? <Check size={28} /> : <X size={28} />}
            </div>
            <h3>{actionModal.type === "approve" ? "この申請を承認しますか？" : "差戻しを実行しますか？"}</h3>
            <p>
              {actionModal.type === "approve"
                ? "承認すると経理部へ回付され、経理の最終承認後にOracleへ連携されます。"
                : "差戻しを選ぶと申請者に通知され、修正・再申請が可能になります。コメントを必ず入力してください。"}
            </p>
            <textarea
              className="rfap-modal-input"
              rows={4}
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder={actionModal.type === "approve" ? "承認コメント（任意）" : "差戻し理由（必須）"}
            />
            <div className="rfap-modal-actions">
              <button className="rfap-btn ghost" onClick={() => setActionModal(null)}>キャンセル</button>
              <button
                className={`rfap-btn ${actionModal.type === "approve" ? "primary" : "danger"}`}
                onClick={doAction}
              >
                {actionModal.type === "approve" ? <><Check size={14} /> 承認する</> : <><X size={14} /> 差戻す</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .rfap-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .rfap-header { background: #fff; height: 72px; border-bottom: 2px solid #f59e0b; position: sticky; top: 0; z-index: 50; }
        .rfap-header-inner { max-width: 1400px; margin: 0 auto; height: 100%; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
        .rfap-brand { display: flex; align-items: center; gap: 20px; }
        .rfap-back-link { color: #94a3b8; display: flex; }
        .rfap-back-link:hover { color: #f59e0b; }
        .rfap-title-group { line-height: 1.2; }
        .rfap-main-title { font-size: 18px; font-weight: 800; margin: 0; color: #1e293b; }
        .rfap-sub-title { font-size: 13px; color: #64748b; font-weight: 600; margin: 0; }
        .rfap-data-badge { display: flex; align-items: center; gap: 6px; background: #fef3c7; color: #b45309; padding: 6px 12px; border-radius: 20px; border: 1px solid #fde68a; font-size: 11px; font-weight: 700; }

        .rfap-container { max-width: 1400px; margin: 0 auto; padding: 24px; }

        .rfap-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .rfap-stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; border-left: 4px solid var(--c); }
        .rfap-stat-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .rfap-stat-num { font-size: 28px; font-weight: 900; color: #0f172a; line-height: 1; }
        .rfap-stat-sub { font-size: 11px; color: #94a3b8; margin-top: 4px; font-weight: 600; }

        .rfap-layout { display: grid; grid-template-columns: 420px 1fr; gap: 20px; }

        .rfap-list-col { display: flex; flex-direction: column; gap: 12px; }
        .rfap-list-controls { display: flex; flex-direction: column; gap: 10px; }
        .rfap-search-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #94a3b8; }
        .rfap-search-bar:focus-within { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15); }
        .rfap-search-bar input { flex: 1; border: none; outline: none; font-size: 13px; background: transparent; }
        .rfap-tabs { display: flex; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 10px; }
        .rfap-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 8px; border: none; background: transparent; border-radius: 7px; font-size: 12px; font-weight: 700; color: #64748b; cursor: pointer; }
        .rfap-tab:hover { color: #f59e0b; }
        .rfap-tab.active { background: #fff; color: #b45309; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        .rfap-tab span { font-size: 10px; padding: 1px 6px; background: #e2e8f0; color: #64748b; border-radius: 8px; font-weight: 800; }
        .rfap-tab.active span { background: #fef3c7; color: #b45309; }

        .rfap-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 280px); overflow-y: auto; padding-right: 4px; }
        .rfap-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; text-align: left; cursor: pointer; transition: 0.15s; display: flex; flex-direction: column; gap: 8px; }
        .rfap-card:hover { border-color: #fbbf24; box-shadow: 0 4px 10px -4px rgba(0,0,0,0.06); }
        .rfap-card.active { border-color: #f59e0b; background: #fffbeb; box-shadow: 0 4px 10px -4px rgba(245, 158, 11, 0.2); }
        .rfap-card-top { display: flex; justify-content: space-between; align-items: center; }
        .rfap-card-id { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: #475569; }
        .rfap-status-chip { font-size: 10px; font-weight: 800; padding: 3px 10px; border-radius: 20px; }
        .rfap-card-main { display: flex; justify-content: space-between; align-items: center; }
        .rfap-card-member { display: flex; flex-direction: column; gap: 2px; }
        .rfap-card-member > span:first-child { font-size: 14px; font-weight: 800; color: #0f172a; }
        .rfap-card-memberid { font-size: 11px; color: #94a3b8; font-family: 'SF Mono', Menlo, monospace; font-weight: 500; }
        .rfap-card-amount { font-size: 18px; font-weight: 900; color: #b45309; }
        .rfap-card-foot { display: flex; gap: 10px; font-size: 11px; color: #64748b; font-weight: 600; flex-wrap: wrap; align-items: center; }
        .rfap-card-applicant { color: #475569; }
        .rfap-card-date { color: #94a3b8; font-family: 'SF Mono', Menlo, monospace; margin-left: auto; }
        .rfap-empty { padding: 32px 20px; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; background: #fff; border: 1px dashed #e2e8f0; border-radius: 12px; }
        .rfap-empty.large { padding: 80px 20px; }

        /* Modal */
        .rfap-modal-bg { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .rfap-modal { background: #fff; border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; position: relative; }
        .rfap-modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #94a3b8; cursor: pointer; }
        .rfap-modal-icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
        .rfap-modal h3 { font-size: 18px; font-weight: 800; margin: 0 0 8px; text-align: center; }
        .rfap-modal p { font-size: 13px; color: #64748b; margin: 0 0 16px; line-height: 1.6; text-align: center; }
        .rfap-modal-input { width: 100%; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; font-family: inherit; resize: vertical; box-sizing: border-box; }
        .rfap-modal-input:focus { outline: none; border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15); }
        .rfap-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

        .rfap-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 800; cursor: pointer; transition: 0.15s; border: none; }
        .rfap-btn.primary { background: #10b981; color: #fff; }
        .rfap-btn.primary:hover { background: #059669; }
        .rfap-btn.danger { background: #ef4444; color: #fff; }
        .rfap-btn.danger:hover { background: #dc2626; }
        .rfap-btn.ghost { background: transparent; color: #94a3b8; }
        .rfap-btn.ghost:hover { color: #475569; }
        .rfap-btn.outline { background: #fff; color: #475569; border: 1px solid #cbd5e1; }

        @media (max-width: 1024px) {
          .rfap-layout { grid-template-columns: 1fr; }
          .rfap-stats { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}

// ---- 詳細パネル ----
function DetailPanel({ app, onApprove, onReject }: { app: Application; onApprove: () => void; onReject: () => void }) {
  const canAct = app.status === "承認待ち";
  return (
    <div className="dp-panel">
      <div className="dp-panel-head">
        <div>
          <div className="dp-panel-id mono">{app.id}</div>
          <div className="dp-panel-title">{app.memberName} <span className="dp-panel-memberid">({app.memberId})</span></div>
        </div>
        <div className="dp-panel-amount">
          <span>返金合計</span>
          <strong>¥{app.totalAmount.toLocaleString()}</strong>
        </div>
      </div>

      <div className="dp-grid">
        <div className="dp-field">
          <div className="dp-label">対象期間</div>
          <div className="dp-value">{app.targetMonthFrom === app.targetMonthTo ? app.targetMonthFrom : `${app.targetMonthFrom} 〜 ${app.targetMonthTo}`}</div>
        </div>
        <div className="dp-field">
          <div className="dp-label">申請日時</div>
          <div className="dp-value mono">{app.submittedAt}</div>
        </div>
        <div className="dp-field">
          <div className="dp-label">申請者</div>
          <div className="dp-value">{app.applicantName} <span className="dp-value-sub">{app.applicantDept} / {app.applicantEmail}</span></div>
        </div>
      </div>

      <section className="dp-section">
        <div className="dp-section-title"><Receipt size={14} /> 返金項目</div>
        <div className="dp-items">
          {app.items.map((it) => (
            <div className="dp-item" key={it.id}>
              <div>
                <div className="dp-item-label">{it.label}</div>
                <div className="dp-item-cat">{it.category}</div>
              </div>
              <div className="dp-item-amount">¥{it.amount.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="dp-section">
        <div className="dp-section-title"><FileText size={14} /> 申請理由</div>
        <div className="dp-reason">{app.reason}</div>
      </section>

      <section className="dp-section">
        <div className="dp-section-title"><CreditCard size={14} /> 返金先口座</div>
        <div className="dp-account">
          <div><span>金融機関</span><strong>{app.account.bankName}</strong></div>
          <div><span>支店</span><strong>{app.account.branchName}</strong></div>
          <div><span>種別</span><strong>{app.account.accountType}</strong></div>
          <div><span>口座番号</span><strong className="mono">{app.account.accountNumber}</strong></div>
          <div className="dp-account-full"><span>名義人</span><strong>{app.account.holderName}</strong></div>
        </div>
      </section>

      <section className="dp-section">
        <div className="dp-section-title"><Send size={14} /> 承認進捗</div>
        <div className="dp-timeline">
          {app.steps.map((s, idx) => (
            <div className="dp-tl-item" key={idx}>
              <div className="dp-tl-marker" style={{ background: STATE_COLOR[s.state] }}>
                {s.state === "完了" && <Check size={12} />}
                {s.state === "差戻し" && <X size={12} />}
              </div>
              <div className="dp-tl-body">
                <div className="dp-tl-head">
                  <span className="dp-tl-role">{s.approver.role}</span>
                  <span className="dp-tl-state" style={{ color: STATE_COLOR[s.state] }}>{s.state}</span>
                </div>
                <div className="dp-tl-name">{s.approver.name} <span>{s.approver.dept}</span></div>
                {s.actedAt && <div className="dp-tl-time mono">{s.actedAt}</div>}
                {s.comment && <div className="dp-tl-comment">「{s.comment}」</div>}
              </div>
              {idx < app.steps.length - 1 && <div className="dp-tl-bar" />}
            </div>
          ))}
        </div>
      </section>

      <div className="dp-actions">
        {canAct ? (
          <>
            <button className="rfap-btn outline danger-text" onClick={onReject}>
              <X size={14} /> 差戻し
            </button>
            <button className="rfap-btn primary" onClick={onApprove}>
              <Check size={14} /> この申請を承認する
            </button>
          </>
        ) : (
          <div className="dp-acted-banner" style={{ background: `${STATUS_COLOR[app.status]}15`, color: STATUS_COLOR[app.status] }}>
            <Check size={14} /> 処理済み — {app.myAction?.state} @ {app.myAction?.actedAt}
          </div>
        )}
      </div>

      <style jsx>{`
        .dp-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 20px; }
        .dp-panel-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
        .dp-panel-id { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: #94a3b8; }
        .dp-panel-title { font-size: 22px; font-weight: 900; color: #0f172a; margin-top: 4px; }
        .dp-panel-memberid { font-size: 13px; color: #94a3b8; font-weight: 600; }
        .dp-panel-amount { text-align: right; }
        .dp-panel-amount span { display: block; font-size: 11px; color: #94a3b8; font-weight: 700; }
        .dp-panel-amount strong { font-size: 26px; font-weight: 900; color: #b45309; }

        .dp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .dp-field { background: #f8fafc; border-radius: 10px; padding: 10px 14px; }
        .dp-label { font-size: 10px; font-weight: 800; color: #94a3b8; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px; }
        .dp-value { font-size: 13px; font-weight: 700; color: #0f172a; }
        .dp-value-sub { font-size: 11px; color: #94a3b8; font-weight: 500; display: block; margin-top: 2px; }
        .dp-value.mono, .dp-account strong.mono { font-family: 'SF Mono', Menlo, monospace; }

        .dp-section { display: flex; flex-direction: column; gap: 10px; }
        .dp-section-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .dp-items { display: flex; flex-direction: column; gap: 6px; }
        .dp-item { display: flex; justify-content: space-between; padding: 12px 16px; background: #f8fafc; border-radius: 10px; }
        .dp-item-label { font-size: 13px; font-weight: 700; color: #0f172a; }
        .dp-item-cat { font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 2px; }
        .dp-item-amount { font-size: 14px; font-weight: 800; color: #b45309; }

        .dp-reason { padding: 14px 16px; background: #f8fafc; border-radius: 10px; font-size: 13px; line-height: 1.6; color: #0f172a; white-space: pre-wrap; }

        .dp-account { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px; background: #f8fafc; border-radius: 10px; }
        .dp-account > div { display: flex; flex-direction: column; gap: 2px; }
        .dp-account span { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .dp-account strong { font-size: 13px; color: #0f172a; font-weight: 700; }
        .dp-account-full { grid-column: span 2; }

        .dp-timeline { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
        .dp-tl-item { display: grid; grid-template-columns: 28px 1fr; gap: 12px; position: relative; padding-bottom: 8px; }
        .dp-tl-marker { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; }
        .dp-tl-bar { position: absolute; left: 13px; top: 28px; bottom: -8px; width: 2px; background: #e2e8f0; }
        .dp-tl-head { display: flex; justify-content: space-between; align-items: center; }
        .dp-tl-role { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .dp-tl-state { font-size: 11px; font-weight: 800; }
        .dp-tl-name { font-size: 13px; font-weight: 700; color: #0f172a; }
        .dp-tl-name span { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .dp-tl-time { font-size: 11px; color: #94a3b8; }
        .dp-tl-comment { font-size: 12px; color: #475569; font-style: italic; background: #fef3c7; border-radius: 6px; padding: 6px 10px; margin-top: 4px; }

        .dp-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
        .danger-text { color: #ef4444 !important; border-color: #fecaca !important; }
        .danger-text:hover { background: #fef2f2; border-color: #ef4444 !important; }
        .dp-acted-banner { padding: 10px 16px; border-radius: 10px; display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; }

        @media (max-width: 768px) {
          .dp-grid, .dp-account { grid-template-columns: repeat(2, 1fr); }
          .dp-account-full { grid-column: span 2; }
        }
      `}</style>
    </div>
  );
}
