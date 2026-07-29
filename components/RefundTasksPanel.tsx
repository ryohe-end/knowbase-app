"use client";

// TOP「対応依頼」欄。返金ワークフローの自分の対応待ち(承認/経理/差戻し再申請)を表示し、
// クリックで該当画面へ。対応が無ければ非表示(ワークフローが止まらないよう可視化)。
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Item = { applicationId: string; clubCode: string; memberName: string; memberNo: string; totalAmount: number; status: string; createdAt: string };
type Bucket = { count: number; items: Item[] };
type Tasks = { approver: Bucket; finance: Bucket; mine: Bucket };

const SECTIONS: { key: keyof Tasks; label: string; color: string; href: string; hint: string }[] = [
  { key: "approver", label: "承認待ち", color: "#f59e0b", href: "/store-settings/refund-payment/refund/approver", hint: "あなたの承認を待っています" },
  { key: "finance", label: "経理処理待ち", color: "#2563eb", href: "/store-settings/refund-payment/refund/finance", hint: "CSV出力・振込手配が必要です" },
  { key: "mine", label: "差戻し（要 再申請）", color: "#dc2626", href: "/store-settings/refund-payment/refund", hint: "修正して再申請してください" },
];

export default function RefundTasksPanel() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Tasks | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/store-settings/refund-payment/my-tasks", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (json?.ok) setTasks(json.tasks);
      } catch { /* 権限なし/未ログイン等は無視 */ }
    })();
  }, []);

  const total = useMemo(() => (tasks ? tasks.approver.count + tasks.finance.count + tasks.mine.count : 0), [tasks]);
  if (!tasks || total === 0) return null;

  const visible = SECTIONS.filter((s) => tasks[s.key].count > 0);

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>📋</span>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>対応依頼</div>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#dc2626", borderRadius: 999, padding: "2px 8px" }}>{total}</span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>返金ワークフロー</span>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {visible.map((s) => {
          const b = tasks[s.key];
          return (
            <div key={s.key} style={{ border: "1px solid #f1f5f9", borderRadius: 12, overflow: "hidden" }}>
              <button
                onClick={() => router.push(s.href)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", background: `${s.color}0d`, border: "none", cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
                  <span style={{ fontWeight: 800, fontSize: 13, color: "#0f172a" }}>{s.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: s.color }}>{b.count}件</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{s.hint}</span>
                </span>
                <span style={{ fontSize: 12, color: s.color, fontWeight: 700, whiteSpace: "nowrap" }}>開く →</span>
              </button>
              <div>
                {b.items.slice(0, 5).map((it) => (
                  <button
                    key={it.applicationId}
                    onClick={() => router.push(s.href)}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 14px", borderTop: "1px solid #f8fafc", background: "#fff", border: "none", borderTopWidth: 1, cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#94a3b8", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{it.applicationId}</span>
                      <span style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>{it.memberName}</span>
                      <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 6 }}>{it.clubCode}</span>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap" }}>¥{(it.totalAmount || 0).toLocaleString()}</span>
                  </button>
                ))}
                {b.count > 5 && (
                  <div style={{ padding: "6px 14px", fontSize: 11, color: "#94a3b8", borderTop: "1px solid #f8fafc" }}>ほか {b.count - 5} 件…「開く」で全件表示</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
