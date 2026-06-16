"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Check, Search, User, Wallet, ClipboardCheck,
  X, AlertCircle, FileText, Database, AlertTriangle
} from "lucide-react";
import type {
  DepositApplication as ApiDepositApplication,
  UnpaidItem as ApiUnpaidItem,
  PaymentMethod,
} from "@/types/depositApplication";

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
  category: string;
};

type DepositRow = {
  id: string;
  memberId: string;
  memberName: string;
  totalAmount: number;
  itemCount: number;
  paymentMethod: string;
  scheduledDate: string;
  status: ApiDepositApplication["status"];
  createdAt: string;
};

type ClubOption = { clubCode: string; clubName?: string; clubNameShort?: string };

const STATUS_COLOR: Record<ApiDepositApplication["status"], string> = {
  下書き: "#94a3b8",
  受付中: "#f59e0b",
  消込完了: "#10b981",
  差戻し: "#ef4444",
};

const PAYMENT_METHODS: PaymentMethod[] = ["現金", "銀行振込", "クレジット再請求", "コンビニ収納", "店舗端末(PayPay等)"];

function useDebounce<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const STEPS = [
  { id: 1, label: "会員選択", icon: <User size={16} /> },
  { id: 2, label: "未納項目", icon: <Wallet size={16} /> },
  { id: 3, label: "確認", icon: <ClipboardCheck size={16} /> },
];

export default function DepositApplicationPage() {
  // クラブセレクタ
  const [clubOptions, setClubOptions] = useState<ClubOption[]>([]);
  const [shopId, setShopId] = useState<string>("");
  const shopName = useMemo(() => {
    const c = clubOptions.find((x) => x.clubCode === shopId);
    return c?.clubNameShort || c?.clubName || "";
  }, [clubOptions, shopId]);

  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PAYMENT_METHODS[0]);
  const [scheduledDate, setScheduledDate] = useState("");
  const [memo, setMemo] = useState("");
  const [successOpen, setSuccessOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 会員検索 (API)
  const [memberSearchResults, setMemberSearchResults] = useState<Member[]>([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState<string | null>(null);

  // 未納項目 (API)
  const [unpaidItemsApi, setUnpaidItemsApi] = useState<UnpaidItem[]>([]);
  const [unpaidLoading, setUnpaidLoading] = useState(false);

  // 履歴 (API)
  const [history, setHistory] = useState<DepositRow[]>([]);

  // 今日のISO日付（デフォルト/最小値用）
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // 初回ロード
  useEffect(() => {
    (async () => {
      try {
        const [hRes, cRes] = await Promise.all([
          fetch("/api/store-settings/refund-payment/deposit/applications?queue=all", { cache: "no-store" }),
          fetch("/api/store-settings/refund-payment/clubs", { cache: "no-store" }),
        ]);
        const hData = await hRes.json();
        if (hData.ok && Array.isArray(hData.applications)) {
          setHistory(hData.applications.map((a: ApiDepositApplication): DepositRow => ({
            id: a.applicationId,
            memberId: a.memberNo,
            memberName: a.memberName,
            totalAmount: a.totalAmount,
            itemCount: a.unpaidItems?.length ?? 0,
            paymentMethod: a.paymentMethod,
            scheduledDate: a.scheduledDate,
            status: a.status,
            createdAt: (a.createdAt ?? "").slice(0, 10),
          })));
        }
        const cData = await cRes.json();
        if (cData.ok && Array.isArray(cData.clubs)) {
          setClubOptions(cData.clubs);
          if (cData.clubs.length === 1) setShopId(cData.clubs[0].clubCode);
        }
      } catch (e) {
        console.error("deposit initial load failed", e);
      }
    })();
  }, []);

  // 会員検索: /api/admin/member-search (debounce)
  const debouncedQuery = useDebounce(searchQuery, 300);
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setMemberSearchResults([]);
      setMemberSearchError(null);
      return;
    }
    const inferType = (val: string): string => {
      if (/^M\d+$/i.test(val) || /^\d{6,}$/.test(val)) return "member_no";
      if (/^[\d-]+$/.test(val)) return "phone";
      if (/^[ァ-ヶー\s]+$/.test(val)) return "name_kana";
      return "name_kanji";
    };
    const ctrl = new AbortController();
    setMemberSearchLoading(true);
    setMemberSearchError(null);
    (async () => {
      try {
        const url = `/api/admin/member-search?type=${inferType(q)}&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data?.error || "検索失敗");
        const rows = Array.isArray(data.results) ? data.results : [];
        const members: Member[] = rows.map((m: any) => ({
          memberId: String(m.memberNo ?? m.kojinSeq ?? ""),
          name: String(m.nameKanji ?? ""),
          kana: String([m.nameKanaSei, m.nameKanaMei].filter(Boolean).join(" ")),
          phone: String(m.phone ?? ""),
          plan: String(m.plan ?? ""),
        }));
        setMemberSearchResults(members);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setMemberSearchError(e?.message || "検索エラー");
          setMemberSearchResults([]);
        }
      } finally {
        setMemberSearchLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [debouncedQuery]);
  const filteredMembers = memberSearchResults;

  // 会員選択 → 未納項目取得 (API)
  useEffect(() => {
    if (!selectedMember || !shopId) {
      setUnpaidItemsApi([]);
      return;
    }
    const ctrl = new AbortController();
    setUnpaidLoading(true);
    (async () => {
      try {
        const url = `/api/store-settings/refund-payment/deposit/unpaid?memberNo=${encodeURIComponent(selectedMember.memberId)}&clubCode=${encodeURIComponent(shopId)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json();
        if (data.ok) {
          const items: UnpaidItem[] = (data.items as ApiUnpaidItem[] ?? []).map((it) => ({
            id: it.id,
            label: it.label,
            targetMonth: it.targetMonth ?? "",
            amount: it.amount,
            dueDate: it.dueDate ?? "",
            overdueDays: it.overdueDays ?? 0,
            category: it.category ?? "その他",
          }));
          setUnpaidItemsApi(items);
          if (data.member?.plan && !selectedMember.plan) {
            setSelectedMember({ ...selectedMember, plan: data.member.plan });
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") console.error("unpaid fetch error", e);
      } finally {
        setUnpaidLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [selectedMember, shopId]);

  // 会員選択変更時は選択項目をクリア
  useEffect(() => {
    setSelectedItemIds(new Set());
  }, [selectedMember?.memberId]);

  const unpaidItems = unpaidItemsApi;

  const totalAmount = useMemo(() => {
    return unpaidItems
      .filter((it) => selectedItemIds.has(it.id))
      .reduce((sum, it) => sum + it.amount, 0);
  }, [selectedItemIds, unpaidItems]);

  const canNext = () => {
    if (!shopId) return false;
    if (step === 1) return !!selectedMember;
    if (step === 2) return selectedItemIds.size > 0;
    if (step === 3) return !!paymentMethod && !!scheduledDate;
    return false;
  };

  // 履歴 reload
  const reloadHistory = async () => {
    try {
      const res = await fetch("/api/store-settings/refund-payment/deposit/applications?queue=all", { cache: "no-store" });
      const data = await res.json();
      if (data.ok && Array.isArray(data.applications)) {
        setHistory(data.applications.map((a: ApiDepositApplication): DepositRow => ({
          id: a.applicationId,
          memberId: a.memberNo,
          memberName: a.memberName,
          totalAmount: a.totalAmount,
          itemCount: a.unpaidItems?.length ?? 0,
          paymentMethod: a.paymentMethod,
          scheduledDate: a.scheduledDate,
          status: a.status,
          createdAt: (a.createdAt ?? "").slice(0, 10),
        })));
      }
    } catch (e) {
      console.error("history reload failed", e);
    }
  };

  const handleSubmit = async () => {
    if (!selectedMember || !shopId) return;
    const items = unpaidItems.filter((it) => selectedItemIds.has(it.id));
    setSubmitting(true);
    try {
      const saveRes = await fetch("/api/store-settings/refund-payment/deposit/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clubCode: shopId,
          memberNo: selectedMember.memberId,
          memberName: selectedMember.name,
          memberKana: selectedMember.kana,
          memberPhone: selectedMember.phone,
          memberPlan: selectedMember.plan,
          unpaidItems: items.map((i) => ({
            id: i.id,
            label: i.label,
            amount: i.amount,
            targetMonth: i.targetMonth,
            dueDate: i.dueDate,
            overdueDays: i.overdueDays,
            category: i.category,
          })),
          paymentMethod,
          scheduledDate,
          memo,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.ok) throw new Error(saveData?.error || "保存失敗");
      const saved: ApiDepositApplication = saveData.application;

      // submit transition
      const trRes = await fetch(
        `/api/store-settings/refund-payment/deposit/applications/${encodeURIComponent(saved.applicationId)}/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "submit", comment: "店舗から連絡を受け申請しました" }),
        }
      );
      const trData = await trRes.json();
      if (!trRes.ok || !trData.ok) throw new Error(trData?.error || "送信失敗");
      setSuccessOpen(true);
      reloadHistory().catch((e) => console.error("post-submit reload failed", e));
    } catch (e: any) {
      alert(e?.message || "送信エラー");
    } finally {
      setSubmitting(false);
    }
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
              <p className="dp-sub-title">{shopId ? `${shopId} ${shopName}` : "クラブ未選択"}</p>
            </div>
          </div>
          <div className="dp-club-selector">
            <label>クラブ:</label>
            <select
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
              className="dp-club-select"
            >
              <option value="">選択してください</option>
              {clubOptions.map((c) => (
                <option key={c.clubCode} value={c.clubCode}>
                  {c.clubCode} {c.clubNameShort || c.clubName || ""}
                </option>
              ))}
            </select>
          </div>
          <div className="dp-data-badge">
            <Database size={14} />
            <span>DynamoDB 連携</span>
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
                  {memberSearchLoading && <span className="dp-search-status">検索中...</span>}
                </div>
                {memberSearchError && (
                  <div className="dp-hint" style={{ background: "#fef2f2", color: "#b91c1c", borderColor: "#fecaca" }}>
                    <AlertCircle size={14} />
                    <span>検索エラー: {memberSearchError}</span>
                  </div>
                )}
                <div className="dp-member-list">
                  {!searchQuery && (
                    <div className="dp-empty">会員番号・氏名・カナ・電話番号で検索してください</div>
                  )}
                  {searchQuery && !memberSearchLoading && filteredMembers.length === 0 && !memberSearchError && (
                    <div className="dp-empty">条件に一致する会員が見つかりません</div>
                  )}
                  {filteredMembers.map((m) => {
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
                        <div className="dp-member-phone">{m.phone}</div>
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

                {unpaidLoading ? (
                  <div className="dp-empty-state">
                    <div className="dp-empty-icon">⏳</div>
                    <h3>未納項目を取得中...</h3>
                  </div>
                ) : unpaidItems.length === 0 ? (
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
                  disabled={!canNext() || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? "送信中..." : "入金を登録する"} <Check size={16} />
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
              {history.slice(0, 3).map((h) => (
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
            <h3>入金を登録しました</h3>
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
        .dp-club-selector { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #475569; font-weight: 600; }
        .dp-club-select { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; font-weight: 600; color: #0f172a; background: #fff; min-width: 200px; }
        .dp-club-select:focus { outline: none; border-color: #10b981; }
        .dp-search-status { font-size: 11px; color: #94a3b8; font-weight: 600; margin-left: 8px; }

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
