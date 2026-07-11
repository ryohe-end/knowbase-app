// app/store-settings/refund-payment/refund/RefundEditDialog.tsx
// 返金申請後の「編集」画面を独立させたダイアログ。
// ドラフト状態はこのコンポーネント内で自己管理し、保存時に onSave(draft) を呼ぶ。
// スタイルは refund/page.tsx の global CSS (rfa-*) をそのまま利用する。
"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

export type RefundEditItem = { id: string; label: string; amount: number };

export type RefundEditTarget = {
  id: string;
  memberName: string;
  memberId: string;
  reason: string;
  items: RefundEditItem[];
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
  onSave: (draft: { reason: string; items: RefundEditItem[] }) => void;
}) {
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<RefundEditItem[]>([]);

  // 対象が変わったらドラフトを初期化
  useEffect(() => {
    if (app) {
      setReason(app.reason);
      setItems(app.items.map((it) => ({ ...it })));
    }
  }, [app]);

  if (!app) return null;

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
                          next[idx] = { ...it, amount: Number(e.target.value) || 0 };
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
        </div>
        <div className="rfa-edit-modal-footer">
          <button className="rfa-btn ghost" onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button
            className="rfa-btn primary"
            onClick={() => onSave({ reason, items })}
            disabled={saving || reason.trim().length === 0}
          >
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
