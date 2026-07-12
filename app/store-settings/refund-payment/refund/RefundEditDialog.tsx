// app/store-settings/refund-payment/refund/RefundEditDialog.tsx
// 返金申請後の「編集」画面を独立させたダイアログ。
// ドラフト状態はこのコンポーネント内で自己管理し、保存時に onSave(draft) を呼ぶ。
// スタイルは refund/page.tsx の global CSS (rfa-*) をそのまま利用する。
"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

export type RefundEditItem = { id: string; label: string; amount: number };

export type RefundEditAccount = {
  bankName: string;
  branchName: string;
  accountType: "普通" | "当座";
  accountNumber: string;
  holderName: string;
  bankCode?: string;
  branchCode?: string;
  source?: string;
};

export type RefundEditTarget = {
  id: string;
  memberName: string;
  memberId: string;
  reason: string;
  items: RefundEditItem[];
  account?: RefundEditAccount;
};

const EMPTY_ACCOUNT: RefundEditAccount = {
  bankName: "", branchName: "", accountType: "普通", accountNumber: "", holderName: "",
};

export default function RefundEditDialog({
  app,
  saving,
  onClose,
  onSave,
}: {
  /** 編集対象。null でダイアログ非表示。 */
  app: RefundEditTarget | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: { reason: string; items: RefundEditItem[]; account: RefundEditAccount }) => void;
}) {
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<RefundEditItem[]>([]);
  const [account, setAccount] = useState<RefundEditAccount>(EMPTY_ACCOUNT);

  // 対象が変わったらドラフトを初期化
  useEffect(() => {
    if (app) {
      setReason(app.reason);
      setItems(app.items.map((it) => ({ ...it })));
      setAccount({ ...EMPTY_ACCOUNT, ...(app.account ?? {}) });
    }
  }, [app]);

  if (!app) return null;

  const accountValid = !!(account.bankName && account.branchName && account.accountNumber && account.holderName);
  const setAcc = (patch: Partial<RefundEditAccount>) => setAccount((a) => ({ ...a, ...patch }));

  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  return (
    <div className="rfa-modal-bg" onClick={() => !saving && onClose()}>
      <div className="rfa-edit-modal" onClick={(e) => e.stopPropagation()}>
        <button className="rfa-modal-close" onClick={onClose} disabled={saving}>
          <X size={18} />
        </button>
        <div className="rfa-edit-modal-head">
          <h3>申請を編集</h3>
          <p>
            申請ID <span className="mono">{app.id}</span> / {app.memberName}（{app.memberId}）
          </p>
        </div>
        <div className="rfa-edit-modal-body">
          <div className="rfa-edit-field">
            <label>申請理由</label>
            <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="rfa-edit-field">
            <label>返金項目</label>
            {items.length === 0 ? (
              <div className="rfa-edit-empty">項目がありません</div>
            ) : (
              <ul className="rfa-edit-items">
                {items.map((it, idx) => (
                  <li key={it.id}>
                    <span className="rfa-edit-item-label">{it.label}</span>
                    <div className="rfa-edit-item-amount">
                      <span>¥</span>
                      <input
                        type="number"
                        min={0}
                        value={it.amount}
                        onChange={(e) => {
                          const next = [...items];
                          next[idx] = { ...it, amount: Math.max(0, Number(e.target.value) || 0) };
                          setItems(next);
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="rfa-edit-total">
              合計 <strong>¥{total.toLocaleString()}</strong>
            </div>
          </div>
          <div className="rfa-edit-field">
            <label>振込先口座</label>
            <div className="rfa-edit-acc">
              <div className="rfa-edit-acc-row">
                <input placeholder="銀行名" value={account.bankName} onChange={(e) => setAcc({ bankName: e.target.value })} />
                <input placeholder="支店名" value={account.branchName} onChange={(e) => setAcc({ branchName: e.target.value })} />
              </div>
              <div className="rfa-edit-acc-row">
                <select value={account.accountType} onChange={(e) => setAcc({ accountType: e.target.value as "普通" | "当座" })}>
                  <option value="普通">普通</option>
                  <option value="当座">当座</option>
                </select>
                <input placeholder="口座番号" value={account.accountNumber} onChange={(e) => setAcc({ accountNumber: e.target.value.replace(/[^0-9]/g, "") })} />
              </div>
              <input placeholder="口座名義（カナ）" value={account.holderName} onChange={(e) => setAcc({ holderName: e.target.value })} />
              {!accountValid && <div className="rfa-edit-acc-hint">銀行名・支店名・口座番号・名義は必須です</div>}
            </div>
          </div>
        </div>
        <div className="rfa-edit-modal-footer">
          <button className="rfa-btn ghost" onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button
            className="rfa-btn primary"
            onClick={() => onSave({ reason, items, account })}
            disabled={saving || reason.trim().length === 0 || !accountValid}
          >
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
