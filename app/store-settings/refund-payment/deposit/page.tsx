"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Check, Search, User, Wallet, ClipboardCheck,
  X, AlertCircle, FileText, Database, AlertTriangle
} from "lucide-react";

type Member = {
  memberId: string;
  name: string;
  kana: string;
  phone: string;
  plan: string;
};

type UnpaidItem = {
  id: string;
  label: string;
  targetMonth: string;
  amount: number;
  dueDate: string;
  overdueDays: number;
  category: "月会費" | "オプション" | "事務手数料" | "違約金";
};

type DepositApplication = {
  id: string;
  memberId: string;
  memberName: string;
  totalAmount: number;
  itemCount: number;
  paymentMethod: string;
  scheduledDate: string;
  status: "登録済み" | "保留" | "差戻し";
  createdAt: string;
};

const MOCK_MEMBERS: Member[] = [
  { memberId: "M0001234", name: "山田 太郎", kana: "ヤマダ タロウ", phone: "090-1234-5678", plan: "プレミアム" },
  { memberId: "M0002345", name: "佐藤 花子", kana: "サトウ ハナコ", phone: "080-9876-5432", plan: "スタンダード" },
  { memberId: "M0003456", name: "鈴木 一郎", kana: "スズキ イチロウ", phone: "070-1111-2222", plan: "プレミアム" },
  { memberId: "M0004567", name: "高橋 美咲", kana: "タカハシ ミサキ", phone: "090-3333-4444", plan: "1980円会員" },
  { memberId: "M0005678", name: "田中 健太", kana: "タナカ ケンタ", phone: "080-5555-6666", plan: "法人個人A" },
];

const MOCK_UNPAID: Record<string, UnpaidItem[]> = {
  M0001234: [
    { id: "u1", label: "月会費（2026年3月分）", targetMonth: "2026-03", amount: 7980, dueDate: "2026-03-27", overdueDays: 45, category: "月会費" },
    { id: "u2", label: "FIT365あんしんサポート（3月分）", targetMonth: "2026-03", amount: 550, dueDate: "2026-03-27", overdueDays: 45, category: "オプション" },
    { id: "u3", label: "月会費（2026年4月分）", targetMonth: "2026-04", amount: 7980, dueDate: "2026-04-27", overdueDays: 15, category: "月会費" },
  ],
  M0002345: [],
  M0003456: [
    { id: "u4", label: "月会費（2026年4月分）", targetMonth: "2026-04", amount: 7980, dueDate: "2026-04-27", overdueDays: 15, category: "月会費" },
  ],
  M0004567: [
    { id: "u5", label: "月会費（2026年2月分）", targetMonth: "2026-02", amount: 1980, dueDate: "2026-02-27", overdueDays: 74, category: "月会費" },
    { id: "u6", label: "月会費（2026年3月分）", targetMonth: "2026-03", amount: 1980, dueDate: "2026-03-27", overdueDays: 45, category: "月会費" },
    { id: "u7", label: "月会費（2026年4月分）", targetMonth: "2026-04", amount: 1980, dueDate: "2026-04-27", overdueDays: 15, category: "月会費" },
    { id: "u8", label: "事務手数料", targetMonth: "2026-02", amount: 3300, dueDate: "2026-02-27", overdueDays: 74, category: "事務手数料" },
  ],
  M0005678: [
    { id: "u9", label: "違約金（中途解約）", targetMonth: "2026-04", amount: 5500, dueDate: "2026-04-30", overdueDays: 12, category: "違約金" },
  ],
};

const MOCK_HISTORY: DepositApplication[] = [
  {
    id: "DP-20260411-001",
    memberId: "M0008912",
    memberName: "松本 拓海",
    totalAmount: 9080,
    itemCount: 2,
    paymentMethod: "現金",
    scheduledDate: "2026-04-11",
    status: "登録済み",
    createdAt: "2026-04-11",
  },
  {
    id: "DP-20260409-002",
    memberId: "M0001234",
    memberName: "山田 太郎",
    totalAmount: 7980,
    itemCount: 1,
    paymentMethod: "銀行振込",
    scheduledDate: "2026-04-15",
    status: "保留",
    createdAt: "2026-04-09",
  },
  {
    id: "DP-20260403-003",
    memberId: "M0006543",
    memberName: "渡辺 結衣",
    totalAmount: 3300,
    itemCount: 1,
    paymentMethod: "クレジット再請求",
    scheduledDate: "2026-04-20",
    status: "差戻し",
    createdAt: "2026-04-03",
  },
];

const STATUS_COLOR: Record<DepositApplication["status"], string> = {
  登録済み: "#10b981",
  保留: "#f59e0b",
  差戻し: "#ef4444",
};

const PAYMENT_METHODS = ["現金", "銀行振込", "クレジット再請求", "コンビニ収納", "店舗端末（PayPay等）"];

const STEPS = [
  { id: 1, label: "会員選択", icon: <User size={16} /> },
  { id: 2, label: "未納項目", icon: <Wallet size={16} /> },
  { id: 3, label: "確認", icon: <ClipboardCheck size={16} /> },
];

export default function DepositApplicationPage() {
  const shopName = "旭川アモール";
  const shopId = "000121";

  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [scheduledDate, setScheduledDate] = useState("");
  const [memo, setMemo] = useState("");
  const [successOpen, setSuccessOpen] = useState(false);

  // 今日のISO日付（デフォルト/最小値用）
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filteredMembers = useMemo(() => {
    if (!searchQuery) return MOCK_MEMBERS;
    const q = searchQuery.toLowerCase();
    return MOCK_MEMBERS.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.kana.toLowerCase().includes(q) ||
        m.memberId.toLowerCase().includes(q) ||
        m.phone.includes(q)
    );
  }, [searchQuery]);

  const unpaidItems = selectedMember ? MOCK_UNPAID[selectedMember.memberId] ?? [] : [];

  const totalAmount = useMemo(() => {
    return unpaidItems
      .filter((it) => selectedItemIds.has(it.id))
      .reduce((sum, it) => sum + it.amount, 0);
  }, [selectedItemIds, unpaidItems]);

  const canNext = () => {
    if (step === 1) return !!selectedMember;
    if (step === 2) return selectedItemIds.size > 0;
    if (step === 3) return !!paymentMethod && !!scheduledDate;
    return false;
  };

  const reset = () => {
    setStep(1);
    setSearchQuery("");
    setSelectedMember(null);
    setSelectedItemIds(new Set());
    setPaymentMethod(PAYMENT_METHODS[0]);
    setScheduledDate("");
    setMemo("");
  };

  const toggleItem = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedItemIds.size === unpaidItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(unpaidItems.map((i) => i.id)));
    }
  };

  return (
    <div className="dp-root">
      <header className="dp-header">
        <div className="dp-header-inner">
          <div className="dp-brand">
            <Link href="/store-settings/refund-payment" className="dp-back-link">
              <ArrowLeft size={20} />
            </Link>
            <div className="dp-title-group">
              <h1 className="dp-main-title">入金申請（未納金登録）</h1>
              <p className="dp-sub-title">{shopId} {shopName}</p>
            </div>
          </div>
          <div className="dp-data-badge">
            <Database size={14} />
            <span>Oracle 連携（モック）</span>
          </div>
        </div>
      </header>

      <main className="dp-main">
        <div className="dp-container">
          {/* Stepper */}
          <div className="dp-stepper">
            {STEPS.map((s, idx) => (
              <React.Fragment key={s.id}>
                <div className={`dp-step ${step >= s.id ? "active" : ""} ${step === s.id ? "current" : ""}`}>
                  <div className="dp-step-circle">
                    {step > s.id ? <Check size={16} /> : s.icon}
                  </div>
                  <div className="dp-step-label">{s.label}</div>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`dp-step-bar ${step > s.id ? "active" : ""}`} />
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="dp-card">
            {/* Step 1 */}
            {step === 1 && (
              <div className="dp-step-body">
                <div className="dp-step-head">
                  <h2>Step 1. 対象会員の検索</h2>
                  <p>未納がある会員を検索し選択します。</p>
                </div>
                <div className="dp-search-bar">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="会員番号 / 氏名 / カナ / 電話番号"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="dp-member-list">
                  {filteredMembers.length === 0 && (
                    <div className="dp-empty">条件に一致する会員が見つかりません</div>
                  )}
                  {filteredMembers.map((m) => {
                    const unpaidCount = (MOCK_UNPAID[m.memberId] ?? []).length;
                    const unpaidTotal = (MOCK_UNPAID[m.memberId] ?? []).reduce((s, i) => s + i.amount, 0);
                    return (
                      <button
                        key={m.memberId}
                        className={`dp-member-row ${selectedMember?.memberId === m.memberId ? "selected" : ""}`}
                        onClick={() => setSelectedMember(m)}
                      >
                        <div className="dp-member-id">{m.memberId}</div>
                        <div className="dp-member-name">
                          <div>{m.name}</div>
                          <div className="dp-member-kana">{m.kana}</div>
                        </div>
                        <div className="dp-member-plan">{m.plan}</div>
                        <div className="dp-member-unpaid">
                          {unpaidCount > 0 ? (
                            <>
                              <AlertTriangle size={12} />
                              <span>未納 {unpaidCount}件 / ¥{unpaidTotal.toLocaleString()}</span>
                            </>
                          ) : (
                            <span className="dp-no-unpaid">未納なし</span>
                          )}
                        </div>
                        <div className="dp-member-radio">
                          {selectedMember?.memberId === m.memberId ? <Check size={16} /> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2 */}
            {step === 2 && selectedMember && (
              <div className="dp-step-body">
                <div className="dp-step-head-row">
                  <div className="dp-step-head">
                    <h2>Step 2. 未納項目の選択</h2>
                    <p>{selectedMember.name} 様の未納項目です。入金する項目を選択してください。</p>
                  </div>
                  {unpaidItems.length > 0 && (
                    <button className="dp-link-btn" onClick={selectAll}>
                      {selectedItemIds.size === unpaidItems.length ? "全選択解除" : "すべて選択"}
                    </button>
                  )}
                </div>

                {unpaidItems.length === 0 ? (
                  <div className="dp-empty-state">
                    <div className="dp-empty-icon">🎉</div>
                    <h3>未納はありません</h3>
                    <p>この会員には現在登録できる未納項目がありません。</p>
                  </div>
                ) : (
                  <>
                    <div className="dp-items">
                      {unpaidItems.map((it) => {
                        const checked = selectedItemIds.has(it.id);
                        return (
                          <div key={it.id} className={`dp-item-row ${checked ? "checked" : ""}`}>
                            <label className="dp-item-check">
                              <input type="checkbox" checked={checked} onChange={() => toggleItem(it.id)} />
                              <span className="dp-item-checkbox" />
                            </label>
                            <div className="dp-item-main">
                              <div className="dp-item-label">{it.label}</div>
                              <div className="dp-item-meta">
                                <span className={`dp-item-cat cat-${it.category}`}>{it.category}</span>
                                <span>請求月: {it.targetMonth}</span>
                                <span>引落予定日: {it.dueDate}</span>
                                {it.overdueDays > 0 && (
                                  <span className="dp-overdue">{it.overdueDays}日経過</span>
                                )}
                              </div>
                            </div>
                            <div className="dp-item-amount">
                              ¥ {it.amount.toLocaleString()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="dp-total">
                      <span>入金合計</span>
                      <span className="dp-total-amount">¥ {totalAmount.toLocaleString()}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 3 */}
            {step === 3 && selectedMember && (
              <div className="dp-step-body">
                <div className="dp-step-head">
                  <h2>Step 3. 入金内容の確認</h2>
                  <p>入金方法を選択し、内容を確認して登録してください。</p>
                </div>

                <div className="dp-summary">
                  <div className="dp-summary-row">
                    <span>会員</span>
                    <span>
                      {selectedMember.memberId} / {selectedMember.name}（{selectedMember.plan}）
                    </span>
                  </div>
                  <div className="dp-summary-row">
                    <span>入金対象</span>
                    <div className="dp-summary-items">
                      {unpaidItems
                        .filter((it) => selectedItemIds.has(it.id))
                        .map((it) => (
                          <div key={it.id}>
                            ・{it.label} — ¥{it.amount.toLocaleString()}
                          </div>
                        ))}
                    </div>
                  </div>
                  {scheduledDate && (
                    <div className="dp-summary-row">
                      <span>入金予定日</span>
                      <span>{scheduledDate}</span>
                    </div>
                  )}
                  <div className="dp-summary-row total-row">
                    <span>入金合計</span>
                    <span className="dp-total-amount">¥ {totalAmount.toLocaleString()}</span>
                  </div>
                </div>

                <div className="dp-form-row">
                  <label>入金方法 <span className="dp-required">*</span></label>
                  <div className="dp-method-grid">
                    {PAYMENT_METHODS.map((m) => (
                      <label key={m} className={`dp-method-chip ${paymentMethod === m ? "selected" : ""}`}>
                        <input
                          type="radio"
                          name="payment"
                          value={m}
                          checked={paymentMethod === m}
                          onChange={() => setPaymentMethod(m)}
                        />
                        <span>{m}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="dp-form-row">
                  <label>入金予定日 <span className="dp-required">*</span></label>
                  <div className="dp-date-row">
                    <input
                      type="date"
                      className="dp-input dp-date"
                      value={scheduledDate}
                      min={today}
                      onChange={(e) => setScheduledDate(e.target.value)}
                    />
                    <div className="dp-quick-pick">
                      {[
                        { label: "本日", offset: 0 },
                        { label: "明日", offset: 1 },
                        { label: "3日後", offset: 3 },
                        { label: "1週間後", offset: 7 },
                        { label: "月末", offset: -1 },
                      ].map((q) => (
                        <button
                          key={q.label}
                          type="button"
                          className="dp-quick-chip"
                          onClick={() => {
                            const d = new Date();
                            if (q.offset === -1) {
                              d.setMonth(d.getMonth() + 1, 0);
                            } else {
                              d.setDate(d.getDate() + q.offset);
                            }
                            setScheduledDate(d.toISOString().slice(0, 10));
                          }}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="dp-date-hint">
                    実際に入金が確認できる日付を指定してください。Oracle 側ではこの日付で消込処理されます。
                  </div>
                </div>

                <div className="dp-form-row">
                  <label>備考（任意）</label>
                  <textarea
                    className="dp-input"
                    rows={3}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="例) 来店時に現金で受領、領収書発行済 など"
                  />
                </div>

                <div className="dp-hint">
                  <AlertCircle size={14} />
                  <span>登録すると Oracle 側の入金テーブルに反映され、対象項目は「入金済み」状態になります。</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="dp-actions">
            <button
              className="dp-btn ghost"
              onClick={() => (step === 1 ? null : setStep(step - 1))}
              disabled={step === 1}
            >
              戻る
            </button>
            <div className="dp-action-right">
              <button className="dp-btn outline" onClick={reset}>クリア</button>
              {step < 3 && (
                <button
                  className="dp-btn primary"
                  disabled={!canNext()}
                  onClick={() => setStep(step + 1)}
                >
                  次へ <ArrowRight size={16} />
                </button>
              )}
              {step === 3 && (
                <button
                  className="dp-btn primary"
                  disabled={!canNext()}
                  onClick={() => setSuccessOpen(true)}
                >
                  入金を登録する <Check size={16} />
                </button>
              )}
            </div>
          </div>

          {/* 履歴 */}
          <section className="dp-history">
            <div className="dp-history-head">
              <h2><FileText size={18} /> 直近の入金登録履歴</h2>
              <span className="dp-history-meta">最新3件 / 全件は管理者ポータルから</span>
            </div>
            <div className="dp-history-table">
              <div className="dp-history-th">
                <span>登録ID</span>
                <span>会員</span>
                <span>件数</span>
                <span>合計金額</span>
                <span>入金方法</span>
                <span>入金予定日</span>
                <span>ステータス</span>
                <span>登録日</span>
              </div>
              {MOCK_HISTORY.map((h) => (
                <div className="dp-history-tr" key={h.id}>
                  <span className="mono">{h.id}</span>
                  <span>
                    {h.memberName}
                    <span className="dp-history-sub">{h.memberId}</span>
                  </span>
                  <span>{h.itemCount}件</span>
                  <span>¥{h.totalAmount.toLocaleString()}</span>
                  <span>{h.paymentMethod}</span>
                  <span className="mono">{h.scheduledDate}</span>
                  <span>
                    <span className="dp-status-chip" style={{ background: `${STATUS_COLOR[h.status]}15`, color: STATUS_COLOR[h.status] }}>
                      {h.status}
                    </span>
                  </span>
                  <span>{h.createdAt}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Modal */}
      {successOpen && (
        <div className="dp-modal-bg" onClick={() => { setSuccessOpen(false); reset(); }}>
          <div className="dp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="dp-modal-close" onClick={() => { setSuccessOpen(false); reset(); }}>
              <X size={18} />
            </button>
            <div className="dp-modal-icon"><Check size={32} /></div>
            <h3>入金を登録しました（モック）</h3>
            <p>Oracle 側の入金テーブルへ反映されます。</p>
            <button className="dp-btn primary" onClick={() => { setSuccessOpen(false); reset(); }}>
              続けて登録
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        .dp-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .dp-header { background: #fff; height: 72px; border-bottom: 2px solid #10b981; position: sticky; top: 0; z-index: 50; }
        .dp-header-inner { max-width: 1240px; margin: 0 auto; height: 100%; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
        .dp-brand { display: flex; align-items: center; gap: 20px; }
        .dp-back-link { color: #94a3b8; display: flex; }
        .dp-back-link:hover { color: #10b981; }
        .dp-title-group { line-height: 1.2; }
        .dp-main-title { font-size: 18px; font-weight: 800; margin: 0; color: #1e293b; }
        .dp-sub-title { font-size: 13px; color: #64748b; font-weight: 600; margin: 0; }
        .dp-data-badge { display: flex; align-items: center; gap: 6px; background: #ecfdf5; color: #047857; padding: 6px 12px; border-radius: 20px; border: 1px solid #a7f3d0; font-size: 11px; font-weight: 700; }

        .dp-container { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }

        .dp-stepper { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
        .dp-step { display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; }
        .dp-step-circle { width: 36px; height: 36px; border-radius: 50%; background: #fff; border: 2px solid #e2e8f0; display: flex; align-items: center; justify-content: center; color: #94a3b8; transition: 0.2s; }
        .dp-step.active .dp-step-circle { background: #10b981; border-color: #10b981; color: #fff; }
        .dp-step.current .dp-step-circle { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2); }
        .dp-step-label { font-size: 11px; font-weight: 700; color: #94a3b8; }
        .dp-step.active .dp-step-label { color: #10b981; }
        .dp-step-bar { flex: 1; height: 2px; background: #e2e8f0; margin: 0 4px; margin-bottom: 22px; }
        .dp-step-bar.active { background: #10b981; }

        .dp-card { background: #fff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; }
        .dp-step-body { display: flex; flex-direction: column; gap: 20px; }
        .dp-step-head h2 { font-size: 20px; font-weight: 800; margin: 0 0 6px 0; }
        .dp-step-head p { font-size: 13px; color: #64748b; margin: 0; }
        .dp-step-head-row { display: flex; justify-content: space-between; align-items: end; }

        .dp-form-row { display: flex; flex-direction: column; gap: 8px; }
        .dp-form-row label { font-size: 13px; font-weight: 700; color: #475569; }
        .dp-required { color: #ef4444; }
        .dp-input { width: 100%; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; background: #fff; }
        .dp-input:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
        textarea.dp-input { resize: vertical; font-family: inherit; }
        .dp-hint { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; border-radius: 10px; font-size: 12px; font-weight: 600; }
        .dp-link-btn { background: none; border: none; color: #10b981; font-size: 12px; font-weight: 700; cursor: pointer; }
        .dp-link-btn:hover { text-decoration: underline; }

        .dp-search-bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #94a3b8; }
        .dp-search-bar:focus-within { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
        .dp-search-bar input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; }
        .dp-member-list { display: flex; flex-direction: column; gap: 4px; max-height: 360px; overflow-y: auto; border: 1px solid #f1f5f9; border-radius: 10px; }
        .dp-member-row { display: grid; grid-template-columns: 120px 1fr 110px 1fr 32px; align-items: center; gap: 16px; padding: 14px 18px; background: #fff; border: none; border-bottom: 1px solid #f1f5f9; cursor: pointer; text-align: left; transition: 0.15s; }
        .dp-member-row:hover { background: #f8fafc; }
        .dp-member-row.selected { background: #ecfdf5; }
        .dp-member-id { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; font-weight: 700; color: #475569; }
        .dp-member-name { font-size: 14px; font-weight: 700; color: #0f172a; }
        .dp-member-kana { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .dp-member-plan { font-size: 11px; padding: 4px 8px; background: #e0f2fe; color: #0369a1; border-radius: 6px; font-weight: 700; text-align: center; }
        .dp-member-unpaid { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; color: #b45309; }
        .dp-no-unpaid { color: #94a3b8; font-weight: 600; }
        .dp-member-radio { color: #10b981; display: flex; justify-content: center; }
        .dp-empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; }

        .dp-empty-state { text-align: center; padding: 48px 24px; background: #f8fafc; border-radius: 12px; }
        .dp-empty-icon { font-size: 40px; margin-bottom: 12px; }
        .dp-empty-state h3 { font-size: 16px; font-weight: 800; margin: 0 0 6px 0; }
        .dp-empty-state p { font-size: 13px; color: #64748b; margin: 0; }

        .dp-items { display: flex; flex-direction: column; gap: 8px; }
        .dp-item-row { display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: 16px; padding: 16px 20px; background: #fafbfc; border: 1px solid #e2e8f0; border-radius: 12px; transition: 0.15s; }
        .dp-item-row.checked { background: #ecfdf5; border-color: #a7f3d0; }
        .dp-item-check { display: flex; cursor: pointer; }
        .dp-item-check input { display: none; }
        .dp-item-checkbox { width: 20px; height: 20px; border: 2px solid #cbd5e1; border-radius: 6px; display: inline-block; position: relative; transition: 0.15s; }
        .dp-item-row.checked .dp-item-checkbox { background: #10b981; border-color: #10b981; }
        .dp-item-row.checked .dp-item-checkbox::after { content: ""; position: absolute; left: 5px; top: 1px; width: 6px; height: 11px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
        .dp-item-label { font-size: 14px; font-weight: 700; color: #0f172a; }
        .dp-item-meta { font-size: 11px; color: #94a3b8; font-weight: 600; display: flex; gap: 12px; margin-top: 4px; align-items: center; flex-wrap: wrap; }
        .dp-item-cat { padding: 2px 8px; border-radius: 4px; background: #e2e8f0; color: #475569; }
        .dp-item-cat.cat-月会費 { background: #dbeafe; color: #1d4ed8; }
        .dp-item-cat.cat-オプション { background: #fce7f3; color: #be185d; }
        .dp-item-cat.cat-事務手数料 { background: #fef3c7; color: #b45309; }
        .dp-item-cat.cat-違約金 { background: #fee2e2; color: #b91c1c; }
        .dp-overdue { color: #b91c1c; font-weight: 800; }
        .dp-item-amount { font-size: 16px; font-weight: 800; color: #0f172a; }

        .dp-total { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; background: #0f172a; color: #fff; border-radius: 12px; font-size: 14px; font-weight: 700; }
        .dp-total-amount { font-size: 22px; font-weight: 900; color: #34d399; }

        .dp-summary { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
        .dp-summary-row { display: grid; grid-template-columns: 120px 1fr; gap: 16px; font-size: 13px; align-items: start; }
        .dp-summary-row > span:first-child { color: #94a3b8; font-weight: 700; }
        .dp-summary-row > span:last-child, .dp-summary-items { color: #0f172a; font-weight: 600; }
        .dp-summary-items { display: flex; flex-direction: column; gap: 4px; }
        .dp-summary-row.total-row { padding-top: 14px; border-top: 1px solid #e2e8f0; align-items: center; }

        .dp-method-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
        .dp-method-chip { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; cursor: pointer; font-size: 13px; font-weight: 600; transition: 0.15s; }
        .dp-method-chip:hover { border-color: #10b981; }
        .dp-method-chip.selected { background: #ecfdf5; border-color: #10b981; color: #047857; }
        .dp-method-chip input { accent-color: #10b981; }

        .dp-date-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .dp-date { max-width: 200px; }
        .dp-quick-pick { display: flex; gap: 6px; flex-wrap: wrap; }
        .dp-quick-chip { padding: 6px 12px; border-radius: 20px; border: 1px solid #cbd5e1; background: #fff; font-size: 12px; font-weight: 600; color: #475569; cursor: pointer; transition: 0.15s; }
        .dp-quick-chip:hover { border-color: #10b981; color: #10b981; background: #ecfdf5; }
        .dp-date-hint { font-size: 11px; color: #94a3b8; font-weight: 600; }

        .dp-actions { margin-top: 20px; display: flex; justify-content: space-between; }
        .dp-action-right { display: flex; gap: 10px; }
        .dp-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 800; cursor: pointer; transition: 0.15s; border: none; }
        .dp-btn.primary { background: #10b981; color: #fff; }
        .dp-btn.primary:hover:not(:disabled) { background: #059669; }
        .dp-btn.primary:disabled { background: #cbd5e1; cursor: not-allowed; }
        .dp-btn.outline { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
        .dp-btn.outline:hover { background: #f8fafc; }
        .dp-btn.ghost { background: transparent; color: #94a3b8; }
        .dp-btn.ghost:hover:not(:disabled) { color: #475569; }
        .dp-btn.ghost:disabled { opacity: 0.4; cursor: not-allowed; }

        .dp-history { margin-top: 48px; }
        .dp-history-head { display: flex; justify-content: space-between; align-items: end; margin-bottom: 12px; }
        .dp-history-head h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800; margin: 0; color: #1e293b; }
        .dp-history-meta { font-size: 11px; color: #94a3b8; font-weight: 600; }
        .dp-history-table { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
        .dp-history-th, .dp-history-tr { display: grid; grid-template-columns: 150px 1.2fr 60px 100px 120px 110px 90px 90px; gap: 12px; padding: 12px 20px; align-items: center; }
        .dp-history-th { background: #f8fafc; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0; }
        .dp-history-tr { border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 600; }
        .dp-history-tr:last-child { border-bottom: none; }
        .dp-history-tr .mono { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; color: #475569; }
        .dp-history-sub { display: block; font-size: 10px; color: #94a3b8; font-weight: 500; }
        .dp-status-chip { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; }

        .dp-modal-bg { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .dp-modal { background: #fff; border-radius: 16px; padding: 32px; max-width: 420px; width: 90%; position: relative; text-align: center; }
        .dp-modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #94a3b8; cursor: pointer; }
        .dp-modal-icon { width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 50%; background: #d1fae5; color: #059669; display: flex; align-items: center; justify-content: center; }
        .dp-modal h3 { font-size: 18px; font-weight: 800; margin: 0 0 8px 0; }
        .dp-modal p { font-size: 13px; color: #64748b; margin: 0 0 20px 0; }
      `}</style>
    </div>
  );
}
