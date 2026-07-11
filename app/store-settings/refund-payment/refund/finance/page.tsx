"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Search, Check, X, Database, Clock,
  Receipt, FileText, Calculator, DollarSign, Download,
  Building2, FileSpreadsheet, AlertCircle, CheckCircle2, ChevronDown
} from "lucide-react";
import type { RefundApplication as ApiApplication } from "@/types/refundApplication";
import { useRefundGuard } from "@/lib/useRefundGuard";

type RefundApp = {
  id: string;
  updatedAt: string; // 楽観ロック用 (表示中の版)
  applicantName: string;
  applicantDept: string;
  memberId: string;
  memberName: string;
  targetMonthFrom: string;
  targetMonthTo: string;
  items: { id: string; label: string; amount: number; category: string }[];
  totalAmount: number;
  reason: string;
  account: { bankCode: string; bankName: string; branchCode: string; branchName: string; accountType: "1" | "2"; accountTypeLabel: "普通" | "当座"; accountNumber: string; holderName: string };
  approverName: string;
  approvedAt: string;
  approverComment?: string;
  status: "CSV出力待ち" | "振込手配中" | "振込完了" | "差戻し";
  batchId?: string;          // どのCSVバッチに含まれたか
  scheduledTransferDate?: string;
  transferCompletedAt?: string;
  failure?: {
    reason: FailureReason;
    detail?: string;
    failedAt: string;
    operator: string;
  };
};

type FailureReason =
  | "口座番号相違"
  | "受取人名相違"
  | "口座解約済み"
  | "支店統廃合"
  | "受取人死亡"
  | "資金不足（依頼人）"
  | "その他";

const FAILURE_REASONS: FailureReason[] = [
  "口座番号相違", "受取人名相違", "口座解約済み", "支店統廃合", "受取人死亡", "資金不足（依頼人）", "その他",
];

type CsvBatch = {
  id: string;
  generatedAt: string;
  count: number;
  totalAmount: number;
  bankBreakdown: { bankCode: string; bankName: string; count: number; amount: number }[];
  status: "出力済み" | "振込完了" | "一部完了";
  scheduledTransferDate: string;
  operator: string;
};

const APPROVERS = {
  finance: { role: "経理部", name: "—", dept: "—", email: "" },
};

// API → ローカル finance ステータス
function deriveStatus(a: ApiApplication): RefundApp["status"] | null {
  // 振込手配中: バッチ組入れ済み、振込未完了
  if (a.status === "振込手配中") return "振込手配中";
  // 振込完了: 経理が transfer 成功で承認済みに
  if (a.status === "承認済み" && a.transferResult === "成功") return "振込完了";
  // 差戻し (経理由来のみ): transferResult=失敗
  if (a.status === "差戻し" && a.transferResult === "失敗") return "差戻し";
  // 経理段階に到達済み (approver 完了) で finance 対応中: CSV出力待ち
  const approverStep = a.steps?.find((s) => s.role === "approver");
  const financeStep = a.steps?.find((s) => s.role === "finance");
  if (a.status === "承認待ち" && approverStep?.state === "完了" && financeStep?.state === "対応中") {
    return "CSV出力待ち";
  }
  return null; // 経理画面では扱わない
}

function apiToLocal(a: ApiApplication): RefundApp {
  const approverStep = a.steps?.find((s) => s.role === "approver");
  const applicantStep = a.steps?.find((s) => s.role === "applicant");
  const financeStep = a.steps?.find((s) => s.role === "finance");
  const bank = a.bankAccount;
  // 当座は accountType="当座"。bank が null なら "普通" 既定で構わない (表示用)。
  const accountTypeIs1 = bank?.accountType !== "当座";
  return {
    id: a.applicationId,
    updatedAt: a.updatedAt || "",
    applicantName: a.createdByName || "—",
    applicantDept: applicantStep?.dept || "—",
    memberId: a.memberNo,
    memberName: a.memberName,
    targetMonthFrom: a.targetMonthFrom,
    targetMonthTo: a.targetMonthTo,
    items: (a.items ?? []).map((it) => ({ id: it.id, label: it.label, amount: it.amount, category: it.category ?? "その他" })),
    totalAmount: a.totalAmount,
    reason: a.reason,
    account: {
      bankCode: bank?.bankCode || "",
      bankName: bank?.bankName || "",
      branchCode: bank?.branchCode || "",
      branchName: bank?.branchName || "",
      accountType: accountTypeIs1 ? "1" : "2",
      accountTypeLabel: bank?.accountType || "普通",
      accountNumber: bank?.accountNumber || "",
      holderName: bank?.holderName || "",
    },
    approverName: approverStep?.userName || "—",
    approvedAt: approverStep?.actedAt || "",
    approverComment: approverStep?.comment,
    status: deriveStatus(a) ?? "CSV出力待ち",
    batchId: a.transferBatchId,
    scheduledTransferDate: a.transferScheduledDate,
    transferCompletedAt: a.transferCompletedAt,
    failure: a.failureReason
      ? {
          reason: a.failureReason as FailureReason,
          detail: a.failureDetail,
          failedAt: a.transferAttemptedAt || "",
          operator: financeStep?.userName || "—",
        }
      : undefined,
  };
}

const STATUS_COLOR: Record<RefundApp["status"], string> = {
  CSV出力待ち: "#f59e0b",
  振込手配中: "#0ea5e9",
  振込完了: "#10b981",
  差戻し: "#ef4444",
};
const BATCH_STATUS_COLOR: Record<CsvBatch["status"], string> = {
  出力済み: "#0ea5e9",
  振込完了: "#10b981",
  一部完了: "#f59e0b",
};

// CSVエスケープ
function csvField(v: string | number): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const bom = "﻿"; // Excelで文字化け回避
  const blob = new Blob([bom + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RefundFinancePage() {
  const guardAllowed = useRefundGuard("canFinance");
  const today = new Date().toISOString().slice(0, 10);
  const [apps, setApps] = useState<RefundApp[]>([]);
  const [batches, setBatches] = useState<CsvBatch[]>([]);
  const [loading, setLoading] = useState(true);

  // 一覧の取得
  const reload = async () => {
    try {
      const res = await fetch("/api/store-settings/refund-payment/applications?queue=finance", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "取得失敗");
      const all = data.applications as ApiApplication[];
      // 経理ステージに到達したもの (deriveStatus が null を返さないもの) のみ
      const reached = all.filter((a) => deriveStatus(a) !== null);
      const local = reached.map(apiToLocal);
      setApps(local);

      // バッチを transferBatchId で集約して導出
      const batchMap = new Map<string, CsvBatch>();
      reached.forEach((a) => {
        const bid = a.transferBatchId;
        if (!bid) return;
        const existing = batchMap.get(bid);
        const bank = a.bankAccount;
        if (existing) {
          existing.count += 1;
          existing.totalAmount += a.totalAmount;
          const bd = existing.bankBreakdown.find((b) => b.bankCode === (bank?.bankCode || ""));
          if (bd) {
            bd.count += 1;
            bd.amount += a.totalAmount;
          } else if (bank) {
            existing.bankBreakdown.push({ bankCode: bank.bankCode || "", bankName: bank.bankName, count: 1, amount: a.totalAmount });
          }
        } else {
          batchMap.set(bid, {
            id: bid,
            generatedAt: (a.transferArrangedAt ?? "").replace("T", " ").slice(0, 16),
            count: 1,
            totalAmount: a.totalAmount,
            bankBreakdown: bank ? [{ bankCode: bank.bankCode || "", bankName: bank.bankName, count: 1, amount: a.totalAmount }] : [],
            status: "出力済み",
            scheduledTransferDate: a.transferScheduledDate || "",
            operator: a.steps?.find((s) => s.role === "finance")?.userName || "—",
          });
        }
      });
      // 各バッチの status を内訳から再計算
      batchMap.forEach((b) => {
        const inBatch = local.filter((x) => x.batchId === b.id);
        const stillArranged = inBatch.some((x) => x.status === "振込手配中");
        const anyDone = inBatch.some((x) => x.status === "振込完了");
        const anyReturned = inBatch.some((x) => x.status === "差戻し");
        if (stillArranged) b.status = "出力済み";
        else if (anyDone && !anyReturned) b.status = "振込完了";
        else if (anyDone || anyReturned) b.status = "一部完了";
      });
      setBatches(Array.from(batchMap.values()).sort((x, y) => y.generatedAt.localeCompare(x.generatedAt)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    reload();
  }, []);
  const [tab, setTab] = useState<"pending" | "arranged" | "returned" | "done" | "all">("pending");
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchMonth, setBatchMonth] = useState<"all" | string>("all"); // YYYY-MM or "all"
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupByBank, setGroupByBank] = useState(true);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);

  // 各種モーダル
  const [csvModal, setCsvModal] = useState<{ open: boolean; scheduledDate: string } | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState<string | null>(null); // batchId
  const [completeOne, setCompleteOne] = useState<string | null>(null);          // appId
  const [failureModal, setFailureModal] = useState<{ appId: string; reason: FailureReason; detail: string } | null>(null);

  const filtered = useMemo(() => {
    return apps.filter((a) => {
      if (tab === "pending" && a.status !== "CSV出力待ち") return false;
      if (tab === "arranged" && a.status !== "振込手配中") return false;
      if (tab === "returned" && a.status !== "差戻し") return false;
      if (tab === "done" && a.status !== "振込完了") return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.id.toLowerCase().includes(q) ||
          a.memberName.toLowerCase().includes(q) ||
          a.memberId.toLowerCase().includes(q) ||
          a.account.bankName.toLowerCase().includes(q) ||
          a.account.holderName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [apps, tab, search]);

  // 銀行別グルーピング
  const groupedByBank = useMemo(() => {
    const map = new Map<string, { bankCode: string; bankName: string; items: RefundApp[]; total: number }>();
    filtered.forEach((a) => {
      const key = a.account.bankCode;
      const cur = map.get(key) ?? { bankCode: a.account.bankCode, bankName: a.account.bankName, items: [], total: 0 };
      cur.items.push(a);
      cur.total += a.totalAmount;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((x, y) => y.total - x.total);
  }, [filtered]);

  const currentYm = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const stats = useMemo(() => {
    const pending = apps.filter((a) => a.status === "CSV出力待ち");
    const arranged = apps.filter((a) => a.status === "振込手配中");
    const returned = apps.filter((a) => a.status === "差戻し");
    const done = apps.filter((a) => a.status === "振込完了");
    return {
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, a) => s + a.totalAmount, 0),
      arrangedCount: arranged.length,
      arrangedAmount: arranged.reduce((s, a) => s + a.totalAmount, 0),
      returnedCount: returned.length,
      returnedAmount: returned.reduce((s, a) => s + a.totalAmount, 0),
      doneCount: done.length,
      monthAmount: done.filter((a) => a.transferCompletedAt?.startsWith(currentYm)).reduce((s, a) => s + a.totalAmount, 0),
    };
  }, [apps, currentYm]);

  // 各バッチに紐づく内訳
  const batchBreakdown = useMemo(() => {
    const map = new Map<string, { arranged: number; returned: number; done: number }>();
    apps.forEach((a) => {
      if (!a.batchId) return;
      const cur = map.get(a.batchId) ?? { arranged: 0, returned: 0, done: 0 };
      if (a.status === "振込手配中") cur.arranged++;
      else if (a.status === "差戻し") cur.returned++;
      else if (a.status === "振込完了") cur.done++;
      map.set(a.batchId, cur);
    });
    return map;
  }, [apps]);

  // バッチの月一覧（フィルタ用）
  const batchMonths = useMemo(() => {
    const set = new Set<string>();
    batches.forEach((b) => set.add(b.generatedAt.slice(0, 7))); // YYYY-MM
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [batches]);

  // 検索・月でフィルタ→月別にグルーピング
  const filteredBatchGroups = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    const filtered = batches.filter((b) => {
      if (batchMonth !== "all" && b.generatedAt.slice(0, 7) !== batchMonth) return false;
      if (!q) return true;
      const inMembers = apps.some((a) =>
        a.batchId === b.id && (
          a.memberName.toLowerCase().includes(q) ||
          a.memberId.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q)
        )
      );
      return (
        b.id.toLowerCase().includes(q) ||
        b.generatedAt.toLowerCase().includes(q) ||
        b.scheduledTransferDate.toLowerCase().includes(q) ||
        b.bankBreakdown.some((bd) => bd.bankName.toLowerCase().includes(q) || bd.bankCode.includes(q)) ||
        inMembers
      );
    });
    const groups = new Map<string, { count: number; amount: number; items: CsvBatch[] }>();
    filtered.forEach((b) => {
      const m = b.generatedAt.slice(0, 7);
      const cur = groups.get(m) ?? { count: 0, amount: 0, items: [] };
      cur.count += b.count;
      cur.amount += b.totalAmount;
      cur.items.push(b);
      groups.set(m, cur);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, g]) => ({ month, ...g }));
  }, [batches, apps, batchSearch, batchMonth]);

  const filteredBatchTotal = filteredBatchGroups.reduce((s, g) => s + g.items.length, 0);

  const selectableIds = useMemo(() => filtered.filter((a) => a.status === "CSV出力待ち").map((a) => a.id), [filtered]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectBank = (items: RefundApp[]) => {
    const targetIds = items.filter((a) => a.status === "CSV出力待ち").map((a) => a.id);
    const allChecked = targetIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allChecked) targetIds.forEach((id) => next.delete(id));
      else targetIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const selectAllPending = () => {
    if (selectedIds.size === selectableIds.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(selectableIds));
  };

  const selectedApps = useMemo(() => apps.filter((a) => selectedIds.has(a.id) && a.status === "CSV出力待ち"), [apps, selectedIds]);
  const selectedTotal = selectedApps.reduce((s, a) => s + a.totalAmount, 0);
  const selectedBanks = useMemo(() => {
    const m = new Map<string, { bankCode: string; bankName: string; count: number; total: number }>();
    selectedApps.forEach((a) => {
      const k = a.account.bankCode;
      const cur = m.get(k) ?? { bankCode: a.account.bankCode, bankName: a.account.bankName, count: 0, total: 0 };
      cur.count++; cur.total += a.totalAmount;
      m.set(k, cur);
    });
    return Array.from(m.values());
  }, [selectedApps]);

  // CSV出力実行（全銀協 1ファイル）
  const doCsvExport = () => {
    if (!csvModal) return;
    if (selectedApps.length === 0) { alert("対象がありません"); return; }
    const scheduled = csvModal.scheduledDate || today;

    const stamp = new Date();
    const stampShort = stamp.toISOString().slice(0, 10).replace(/-/g, "");
    // batchId: 日付 + 時刻 + 乱数 で衝突しないようにする (オペレータ・セッション間でも安全)
    const hhmm = `${String(stamp.getHours()).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}`;
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    const batchId = `BATCH-${stampShort}-${hhmm}-${rand}`;
    const total = selectedApps.reduce((s, a) => s + a.totalAmount, 0);

    // 全銀協 総合振込フォーマット（CSV版）
    // レコード区分 1=ヘッダ, 2=データ, 8=トレーラ, 9=エンド
    const yymmdd = stampShort.slice(2);                          // YYMMDD
    const scheduledYmd = scheduled.replace(/-/g, "").slice(2);   // YYMMDD
    const senderCode = "0000001234";                              // 委託者コード（仮）
    const senderKana = "ｵｶﾓﾄｸﾞﾙｰﾌﾟ";
    const senderBankCode = "0009";                                // 委託元銀行（仮：三井住友）
    const senderBankName = "ﾐﾂｲｽﾐﾄﾓ";
    const senderBranchCode = "001";
    const senderBranchName = "ﾎﾝﾃﾝ";
    const senderAcctType = "1";                                   // 普通
    const senderAcct = "0000001";

    const header = [
      "1", "21", senderCode, senderKana, yymmdd, scheduledYmd,
      senderBankCode, senderBankName, senderBranchCode, senderBranchName,
      senderAcctType, senderAcct, "",
    ];
    const data = selectedApps.map((a) => [
      "2",
      a.account.bankCode,
      a.account.bankName,
      a.account.branchCode,
      a.account.branchName,
      "",                                  // 手形交換所番号
      a.account.accountType,               // 1=普通, 2=当座
      a.account.accountNumber,
      a.account.holderName,
      String(a.totalAmount),
      "7",                                  // 新規コード（7=テレ振込）
      a.memberId,                           // 顧客コード1
      a.id,                                 // 顧客コード2
      "",                                   // EDI情報
    ]);
    const trailer = ["8", String(selectedApps.length), String(total), "", ""];
    const end = ["9", "", "", ""];

    const csv = [header, ...data, trailer, end].map((r) => r.map(csvField).join(",")).join("\r\n");
    downloadFile(`zengin_refund_${stampShort}.csv`, csv);

    // API: 選択した各 app を arrange (振込手配中) に
    Promise.all(
      selectedApps.map((a) =>
        fetch(`/api/store-settings/refund-payment/applications/${encodeURIComponent(a.id)}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "arrange", batchId, scheduledDate: scheduled, comment: `CSV出力(${batchId})`, expectedUpdatedAt: a.updatedAt }),
        })
      )
    )
      .catch((e) => console.error("arrange failed", e))
      .finally(() => reload());

    // 銀行別内訳サマリ CSV (社内管理用)
    const summaryHeaders = ["バッチID", "申請ID", "会員ID", "会員名", "銀行コード", "銀行名", "支店", "種別", "口座番号", "名義人", "金額", "申請理由"];
    const summaryRows = selectedApps.map((a) => [
      batchId, a.id, a.memberId, a.memberName,
      a.account.bankCode, a.account.bankName, a.account.branchName,
      a.account.accountTypeLabel, a.account.accountNumber, a.account.holderName,
      String(a.totalAmount), a.reason,
    ]);
    const summaryCsv = [summaryHeaders, ...summaryRows].map((r) => r.map(csvField).join(",")).join("\r\n");
    downloadFile(`refund_summary_${stampShort}.csv`, summaryCsv);

    // 楽観 UI 更新は API レスポンスを待つ。整合性優先 (race を避ける)。
    setSelectedIds(new Set());
    setCsvModal(null);
  };

  const stampNow = () => {
    const n = new Date();
    return n.toISOString().slice(0, 10) + " " + n.toTimeString().slice(0, 5);
  };

  // バッチのステータスを内訳から再計算
  const recomputeBatchStatus = (allApps: RefundApp[], batchId: string): CsvBatch["status"] => {
    const inBatch = allApps.filter((a) => a.batchId === batchId);
    if (inBatch.length === 0) return "出力済み";
    const stillArranged = inBatch.some((a) => a.status === "振込手配中");
    const anyDone = inBatch.some((a) => a.status === "振込完了");
    const anyReturned = inBatch.some((a) => a.status === "差戻し");
    if (stillArranged) return "出力済み";
    if (anyDone && anyReturned) return "一部完了";
    if (anyDone && !anyReturned) return "振込完了";
    return "一部完了";
  };

  // 1件単位の振込完了 (API)
  const markOneComplete = async (id: string) => {
    try {
      const app = apps.find((x) => x.id === id);
      const res = await fetch(`/api/store-settings/refund-payment/applications/${encodeURIComponent(id)}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transfer", result: "成功", expectedUpdatedAt: app?.updatedAt }),
      });
      const data = await res.json();
      if (res.status === 409) {
        alert(data?.error || "他のユーザにより更新されています。再読込します。");
        await reload();
        setCompleteOne(null);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data?.error || "更新失敗");
      await reload();
    } catch (e: any) {
      alert(e?.message || "エラー");
    }
    setCompleteOne(null);
  };

  // バッチ全件まとめて振込完了 (API)
  const markBatchComplete = async (batchId: string) => {
    const targets = apps.filter((a) => a.batchId === batchId && a.status === "振込手配中");
    try {
      await Promise.all(
        targets.map((a) =>
          fetch(`/api/store-settings/refund-payment/applications/${encodeURIComponent(a.id)}/transition`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "transfer", result: "成功", expectedUpdatedAt: a.updatedAt }),
          })
        )
      );
      await reload();
    } catch (e: any) {
      alert(e?.message || "一括更新エラー");
    }
    setConfirmTransfer(null);
  };

  // 振込失敗 → 自動的に差戻し (API)
  const submitFailure = async () => {
    if (!failureModal) return;
    try {
      const app = apps.find((x) => x.id === failureModal.appId);
      const res = await fetch(`/api/store-settings/refund-payment/applications/${encodeURIComponent(failureModal.appId)}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer",
          result: "失敗",
          failureReason: failureModal.reason,
          failureDetail: failureModal.detail || undefined,
          expectedUpdatedAt: app?.updatedAt,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        alert(data?.error || "他のユーザにより更新されています。再読込します。");
        await reload();
        setFailureModal(null);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data?.error || "更新失敗");
      await reload();
    } catch (e: any) {
      alert(e?.message || "エラー");
    }
    setFailureModal(null);
  };

  // 権限ガード: 経理(finance)のみ。判定中/不許可は本体を描画しない。
  if (guardAllowed !== true) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 14 }}>
        {guardAllowed === false ? "権限がありません。リダイレクトします…" : "読み込み中…"}
      </div>
    );
  }

  return (
    <div className="rff-root">
      <header className="rff-header">
        <div className="rff-header-inner">
          <div className="rff-brand">
            <Link href="/store-settings/refund-payment" className="rff-back-link"><ArrowLeft size={20} /></Link>
            <div className="rff-title-group">
              <h1 className="rff-main-title">返金申請 経理処理</h1>
              <p className="rff-sub-title">本部 経理部 ／ 担当: {APPROVERS.finance.name}</p>
            </div>
          </div>
          <div className="rff-data-badge">
            <Database size={14} /><span>DynamoDB 連携 / 全銀協CSV</span>
          </div>
        </div>
      </header>

      <main className="rff-container">
        {/* 統計 */}
        <div className="rff-stats">
          <div className="rff-stat" style={{ ["--c" as any]: "#f59e0b" }}>
            <div className="rff-stat-label"><Clock size={14} /> CSV出力待ち</div>
            <div className="rff-stat-num">{stats.pendingCount} <small>件</small></div>
            <div className="rff-stat-sub">合計 ¥{stats.pendingAmount.toLocaleString()}</div>
          </div>
          <div className="rff-stat" style={{ ["--c" as any]: "#0ea5e9" }}>
            <div className="rff-stat-label"><Download size={14} /> 振込手配中</div>
            <div className="rff-stat-num">{stats.arrangedCount} <small>件</small></div>
            <div className="rff-stat-sub">¥{stats.arrangedAmount.toLocaleString()}</div>
          </div>
          <div className="rff-stat" style={{ ["--c" as any]: "#ef4444" }}>
            <div className="rff-stat-label"><AlertCircle size={14} /> 振込失敗・差戻し</div>
            <div className="rff-stat-num">{stats.returnedCount} <small>件</small></div>
            <div className="rff-stat-sub">¥{stats.returnedAmount.toLocaleString()} / 申請者修正待ち</div>
          </div>
          <div className="rff-stat" style={{ ["--c" as any]: "#10b981" }}>
            <div className="rff-stat-label"><Check size={14} /> 振込完了</div>
            <div className="rff-stat-num">{stats.doneCount} <small>件</small></div>
            <div className="rff-stat-sub">直近30日</div>
          </div>
        </div>

        {/* 一括選択バー */}
        {tab === "pending" && selectedIds.size > 0 && (
          <div className="rff-selection-bar">
            <div className="rff-selection-info">
              <span className="rff-selection-badge">{selectedIds.size} 件選択中</span>
              <span>合計 <strong>¥{selectedTotal.toLocaleString()}</strong></span>
              <span className="rff-selection-banks">
                {selectedBanks.map((b) => (
                  <span key={b.bankCode} className="rff-bank-chip">
                    {b.bankName} {b.count}件
                  </span>
                ))}
              </span>
            </div>
            <div className="rff-selection-actions">
              <button className="rff-btn ghost" onClick={() => setSelectedIds(new Set())}>選択解除</button>
              <button
                className="rff-btn primary"
                onClick={() => setCsvModal({ open: true, scheduledDate: today })}
              >
                <FileSpreadsheet size={14} /> 全銀協CSVを出力（{selectedIds.size} 件 / {selectedBanks.length} 銀行）
              </button>
            </div>
          </div>
        )}

        {/* リスト */}
        <section className="rff-section">
          <div className="rff-section-head">
            <div className="rff-tabs">
              <button className={`rff-tab ${tab === "pending" ? "active" : ""}`} onClick={() => { setTab("pending"); setSelectedIds(new Set()); }}>
                CSV出力待ち <span>{stats.pendingCount}</span>
              </button>
              <button className={`rff-tab ${tab === "arranged" ? "active" : ""}`} onClick={() => setTab("arranged")}>
                振込手配中 <span>{stats.arrangedCount}</span>
              </button>
              <button className={`rff-tab ${tab === "returned" ? "active" : ""}`} onClick={() => setTab("returned")}>
                振込失敗・差戻し中 <span>{stats.returnedCount}</span>
              </button>
              <button className={`rff-tab ${tab === "done" ? "active" : ""}`} onClick={() => setTab("done")}>
                振込完了 <span>{stats.doneCount}</span>
              </button>
              <button className={`rff-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
                すべて <span>{apps.length}</span>
              </button>
            </div>
            <div className="rff-toolbar">
              <div className="rff-search-bar">
                <Search size={14} />
                <input placeholder="申請ID / 会員 / 銀行 / 名義人 で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <label className="rff-toggle">
                <input type="checkbox" checked={groupByBank} onChange={(e) => setGroupByBank(e.target.checked)} />
                <Building2 size={14} /> 銀行別にまとめる
              </label>
              {tab === "pending" && selectableIds.length > 0 && (
                <button className="rff-link-btn" onClick={selectAllPending}>
                  {selectedIds.size === selectableIds.length ? "全選択解除" : "全選択"}
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rff-empty">該当する申請はありません</div>
          ) : groupByBank ? (
            <div className="rff-groups">
              {groupedByBank.map((g) => {
                const selectable = g.items.filter((a) => a.status === "CSV出力待ち");
                const allChecked = selectable.length > 0 && selectable.every((a) => selectedIds.has(a.id));
                return (
                  <div className="rff-group" key={g.bankCode}>
                    <div className="rff-group-head">
                      <div className="rff-group-head-left">
                        {selectable.length > 0 && tab === "pending" && (
                          <label className="rff-check-wrap">
                            <input type="checkbox" checked={allChecked} onChange={() => toggleSelectBank(g.items)} />
                            <span className="rff-check" />
                          </label>
                        )}
                        <Building2 size={16} />
                        <span className="rff-group-bank">{g.bankName}</span>
                        <span className="rff-group-code mono">#{g.bankCode}</span>
                      </div>
                      <div className="rff-group-head-right">
                        <span className="rff-group-count">{g.items.length} 件</span>
                        <span className="rff-group-amount">¥{g.total.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="rff-rows">
                      {g.items.map((a) => (
                        <AppRow
                          key={a.id}
                          app={a}
                          selectable={a.status === "CSV出力待ち" && tab === "pending"}
                          checked={selectedIds.has(a.id)}
                          onToggle={() => toggleSelect(a.id)}
                          expanded={expandedAppId === a.id}
                          onExpand={() => setExpandedAppId(expandedAppId === a.id ? null : a.id)}
                          onComplete={() => setCompleteOne(a.id)}
                          onFail={() => setFailureModal({ appId: a.id, reason: FAILURE_REASONS[0], detail: "" })}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rff-rows">
              {filtered.map((a) => (
                <AppRow
                  key={a.id}
                  app={a}
                  selectable={a.status === "CSV出力待ち" && tab === "pending"}
                  checked={selectedIds.has(a.id)}
                  onToggle={() => toggleSelect(a.id)}
                  expanded={expandedAppId === a.id}
                  onExpand={() => setExpandedAppId(expandedAppId === a.id ? null : a.id)}
                  onComplete={() => setCompleteOne(a.id)}
                  onFail={() => setFailureModal({ appId: a.id, reason: FAILURE_REASONS[0], detail: "" })}
                />
              ))}
            </div>
          )}
        </section>

        {/* CSVバッチ履歴 */}
        <section className="rff-section">
          <div className="rff-section-toolbar">
            <h2 className="rff-section-h"><FileSpreadsheet size={18} /> CSV出力バッチ履歴</h2>
            <span className="rff-section-meta">{filteredBatchTotal} 件 / 全 {batches.length} バッチ</span>
          </div>

          <div className="rff-batch-controls">
            <div className="rff-search-bar">
              <Search size={14} />
              <input
                placeholder="バッチID / 銀行 / 会員 / 申請ID で検索"
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
              />
              {batchSearch && (
                <button className="rff-search-clear" onClick={() => setBatchSearch("")}>
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="rff-month-tabs">
              <button className={`rff-month-tab ${batchMonth === "all" ? "active" : ""}`} onClick={() => setBatchMonth("all")}>
                すべて
              </button>
              {batchMonths.map((m) => (
                <button key={m} className={`rff-month-tab ${batchMonth === m ? "active" : ""}`} onClick={() => setBatchMonth(m)}>
                  {m.replace("-", "年")}月
                </button>
              ))}
            </div>
          </div>

          {filteredBatchGroups.length === 0 && <div className="rff-empty">該当するバッチはありません</div>}

          {filteredBatchGroups.map((group) => (
          <div className="rff-month-group" key={group.month}>
            <div className="rff-month-head">
              <div className="rff-month-label">
                <span className="rff-month-y">{group.month.split("-")[0]}年</span>
                <span className="rff-month-m">{Number(group.month.split("-")[1])}月</span>
              </div>
              <div className="rff-month-stats">
                <span>{group.items.length} バッチ</span>
                <span>·</span>
                <span>{group.count} 件</span>
                <span>·</span>
                <strong>¥{group.amount.toLocaleString()}</strong>
              </div>
            </div>
          <div className="rff-batch-table">
            <div className="rff-batch-th">
              <span>バッチID</span>
              <span>出力日時</span>
              <span>件数 / 銀行内訳</span>
              <span>処理内訳</span>
              <span>合計金額</span>
              <span>振込予定日</span>
              <span>ステータス</span>
              <span>操作</span>
            </div>
            {group.items.map((b) => {
              const bd = batchBreakdown.get(b.id) ?? { arranged: 0, returned: 0, done: 0 };
              const isOpen = expandedBatchId === b.id;
              const inBatch = apps.filter((a) => a.batchId === b.id);
              const hasIssue = bd.returned > 0;
              return (
                <React.Fragment key={b.id}>
                  <div className={`rff-batch-tr ${isOpen ? "open" : ""} ${hasIssue ? "has-issue" : ""}`} onClick={() => setExpandedBatchId(isOpen ? null : b.id)}>
                    <span className="mono">{b.id}</span>
                    <span className="mono">{b.generatedAt}</span>
                    <span className="rff-batch-bd">
                      <span className="rff-batch-count">{b.count}件 / {b.bankBreakdown.length}行</span>
                      <span className="rff-batch-breakdown">
                        {b.bankBreakdown.map((x) => (
                          <span key={x.bankCode} className="rff-bank-chip sm">{x.bankName} {x.count}</span>
                        ))}
                      </span>
                    </span>
                    <span className="rff-batch-progress">
                      {bd.done > 0 && <span className="rff-prog-chip done">完了 {bd.done}</span>}
                      {bd.arranged > 0 && <span className="rff-prog-chip arranged">手配中 {bd.arranged}</span>}
                      {bd.returned > 0 && <span className="rff-prog-chip returned">差戻し {bd.returned}</span>}
                    </span>
                    <span><strong>¥{b.totalAmount.toLocaleString()}</strong></span>
                    <span className="mono">{b.scheduledTransferDate}</span>
                    <span>
                      <span className="rff-status-chip" style={{ background: `${BATCH_STATUS_COLOR[b.status]}15`, color: BATCH_STATUS_COLOR[b.status] }}>
                        {b.status}
                      </span>
                    </span>
                    <span onClick={(e) => e.stopPropagation()}>
                      {bd.arranged > 0 ? (
                        <button className="rff-btn primary sm" onClick={() => setConfirmTransfer(b.id)}>
                          <CheckCircle2 size={12} /> 残り{bd.arranged}件 完了
                        </button>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700 }}>{isOpen ? "▲ 閉じる" : "▼ 詳細"}</span>
                      )}
                    </span>
                  </div>

                  {isOpen && (
                    <div className="rff-batch-detail">
                      <div className="rff-batch-detail-head">
                        <span>バッチ {b.id} に含まれる申請 — クリックで個別操作</span>
                      </div>
                      <div className="rff-batch-detail-list">
                        {inBatch.map((a) => (
                          <div className={`rff-batch-item state-${a.status}`} key={a.id}>
                            <span className="mono">{a.id}</span>
                            <span>
                              <strong>{a.memberName}</strong> <span className="rff-history-sub mono">{a.memberId}</span>
                            </span>
                            <span>{a.account.bankName} {a.account.branchName}</span>
                            <span className="mono">{a.account.accountTypeLabel} {a.account.accountNumber}</span>
                            <span><strong>¥{a.totalAmount.toLocaleString()}</strong></span>
                            <span className="rff-status-chip" style={{ background: `${STATUS_COLOR[a.status]}15`, color: STATUS_COLOR[a.status] }}>
                              {a.status}
                            </span>
                            <span className="rff-batch-item-actions">
                              {a.status === "振込手配中" && (
                                <>
                                  <button className="rff-mini-btn danger" onClick={() => setFailureModal({ appId: a.id, reason: FAILURE_REASONS[0], detail: "" })}>失敗→差戻し</button>
                                  <button className="rff-mini-btn primary" onClick={() => setCompleteOne(a.id)}>完了</button>
                                </>
                              )}
                              {a.status === "差戻し" && a.failure && (
                                <span title={a.failure.detail ?? a.failure.reason} className="rff-batch-item-note">{a.failure.reason}</span>
                              )}
                              {a.status === "差戻し" && !a.failure && (
                                <span className="rff-batch-item-note">差戻し中</span>
                              )}
                              {a.status === "振込完了" && (
                                <span className="rff-batch-item-note">{a.transferCompletedAt}</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          </div>
          ))}
        </section>
      </main>

      {/* CSV出力モーダル */}
      {csvModal?.open && (
        <div className="rff-modal-bg" onClick={() => setCsvModal(null)}>
          <div className="rff-modal large" onClick={(e) => e.stopPropagation()}>
            <button className="rff-modal-close" onClick={() => setCsvModal(null)}><X size={18} /></button>
            <h3><FileSpreadsheet size={20} /> 全銀協 振込CSVを出力</h3>
            <p>
              選択された <strong>{selectedIds.size} 件</strong> の返金申請を、
              全銀協データ伝送方式に準じた <strong>1ファイル</strong> に統合して出力します。
              社内管理用の内訳サマリCSVも同時にダウンロードされます。
            </p>

            <div className="rff-modal-summary">
              <div className="rff-modal-summary-row"><span>選択件数</span><strong>{selectedIds.size} 件</strong></div>
              <div className="rff-modal-summary-row"><span>振込金額合計</span><strong style={{ color: "#6d28d9" }}>¥{selectedTotal.toLocaleString()}</strong></div>
              <div className="rff-modal-summary-row"><span>対象銀行</span><strong>{selectedBanks.length} 行</strong></div>
            </div>

            <div className="rff-modal-banks">
              <div className="rff-modal-banks-h">出力ファイル</div>
              <div className="rff-modal-bank-row">
                <div>
                  <div className="rff-modal-bank-name"><FileSpreadsheet size={14} /> 全銀協 総合振込CSV</div>
                  <div className="rff-modal-bank-file mono">zengin_refund_{today.replace(/-/g, "")}.csv</div>
                </div>
                <div className="rff-modal-bank-amount">{selectedIds.size}件 / ¥{selectedTotal.toLocaleString()}</div>
              </div>
              <div className="rff-modal-bank-row">
                <div>
                  <div className="rff-modal-bank-name"><FileText size={14} /> 社内管理用 内訳サマリ</div>
                  <div className="rff-modal-bank-file mono">refund_summary_{today.replace(/-/g, "")}.csv</div>
                </div>
                <div className="rff-modal-bank-amount">参考</div>
              </div>
            </div>

            <div className="rff-modal-breakdown">
              <div className="rff-modal-banks-h">含まれる銀行</div>
              <div className="rff-modal-breakdown-chips">
                {selectedBanks.map((b) => (
                  <span key={b.bankCode} className="rff-bank-chip">
                    <Building2 size={11} /> {b.bankName} <small className="mono">#{b.bankCode}</small> {b.count}件
                  </span>
                ))}
              </div>
            </div>

            <div className="rff-form-row">
              <label>振込予定日 <span className="req">*</span></label>
              <input
                type="date"
                value={csvModal.scheduledDate}
                min={today}
                onChange={(e) => setCsvModal({ ...csvModal, scheduledDate: e.target.value })}
              />
              <small className="rff-form-hint">各銀行へのCSV取込・振込実行日を指定します。</small>
            </div>

            <div className="rff-modal-hint">
              <AlertCircle size={14} />
              <span>レコード形式: 1=ヘッダ / 2=データ / 8=トレーラ / 9=エンド。BOM付きUTF-8で出力されます。</span>
            </div>

            <div className="rff-modal-actions">
              <button className="rff-btn ghost" onClick={() => setCsvModal(null)}>キャンセル</button>
              <button className="rff-btn primary" onClick={doCsvExport}>
                <Download size={14} /> 全銀協CSVを出力 / 振込手配中へ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 振込完了確認モーダル */}
      {confirmTransfer && (() => {
        const b = batches.find((x) => x.id === confirmTransfer);
        if (!b) return null;
        const arrangedInBatch = apps.filter((a) => a.batchId === b.id && a.status === "振込手配中").length;
        return (
          <div className="rff-modal-bg" onClick={() => setConfirmTransfer(null)}>
            <div className="rff-modal" onClick={(e) => e.stopPropagation()}>
              <button className="rff-modal-close" onClick={() => setConfirmTransfer(null)}><X size={18} /></button>
              <div className="rff-modal-icon ok"><CheckCircle2 size={28} /></div>
              <h3 className="center">バッチの振込完了処理</h3>
              <p className="center">
                バッチ <strong className="mono">{b.id}</strong> のうち、現在「振込手配中」の <strong>{arrangedInBatch} 件</strong> を「振込完了」として記録します。
                振込失敗として個別記録済みの行には影響しません。
              </p>
              <div className="rff-modal-actions">
                <button className="rff-btn ghost" onClick={() => setConfirmTransfer(null)}>キャンセル</button>
                <button className="rff-btn primary" onClick={() => markBatchComplete(b.id)}>
                  <Check size={14} /> {arrangedInBatch} 件を振込完了に
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 1件単位 振込完了 */}
      {completeOne && (() => {
        const a = apps.find((x) => x.id === completeOne);
        if (!a) return null;
        return (
          <div className="rff-modal-bg" onClick={() => setCompleteOne(null)}>
            <div className="rff-modal" onClick={(e) => e.stopPropagation()}>
              <button className="rff-modal-close" onClick={() => setCompleteOne(null)}><X size={18} /></button>
              <div className="rff-modal-icon ok"><CheckCircle2 size={28} /></div>
              <h3 className="center">この振込を完了にしますか？</h3>
              <p className="center">
                <strong className="mono">{a.id}</strong> / {a.memberName}（¥{a.totalAmount.toLocaleString()}）を「振込完了」に変更します。
              </p>
              <div className="rff-modal-actions">
                <button className="rff-btn ghost" onClick={() => setCompleteOne(null)}>キャンセル</button>
                <button className="rff-btn primary" onClick={() => markOneComplete(a.id)}>
                  <Check size={14} /> 振込完了にする
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 振込失敗 */}
      {failureModal && (() => {
        const a = apps.find((x) => x.id === failureModal.appId);
        if (!a) return null;
        return (
          <div className="rff-modal-bg" onClick={() => setFailureModal(null)}>
            <div className="rff-modal large" onClick={(e) => e.stopPropagation()}>
              <button className="rff-modal-close" onClick={() => setFailureModal(null)}><X size={18} /></button>
              <h3 style={{ color: "#dc2626" }}><AlertCircle size={20} /> 振込失敗 → 自動差戻し</h3>
              <p>
                <strong className="mono">{a.id}</strong> / {a.memberName}（¥{a.totalAmount.toLocaleString()}）の振込が銀行側で失敗した場合の処理です。
                失敗理由を記録すると<strong>即座に申請者へ差戻され</strong>、申請者が口座情報を修正して再申請できます。
              </p>

              <div className="rff-modal-summary">
                <div className="rff-modal-summary-row"><span>振込先</span><strong>{a.account.bankName} {a.account.branchName}</strong></div>
                <div className="rff-modal-summary-row"><span>口座</span><strong className="mono">{a.account.accountTypeLabel} {a.account.accountNumber}</strong></div>
                <div className="rff-modal-summary-row"><span>名義人</span><strong>{a.account.holderName}</strong></div>
              </div>

              <div className="rff-form-row">
                <label>失敗理由 <span className="req">*</span></label>
                <select
                  value={failureModal.reason}
                  onChange={(e) => setFailureModal({ ...failureModal, reason: e.target.value as FailureReason })}
                  style={{ padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }}
                >
                  {FAILURE_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="rff-form-row">
                <label>詳細・コメント</label>
                <textarea
                  rows={3}
                  value={failureModal.detail}
                  onChange={(e) => setFailureModal({ ...failureModal, detail: e.target.value })}
                  placeholder="例) 銀行返却エラー: 受取人名相違。正しいカナ名義を申請者に確認のこと"
                  style={{ padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}
                />
              </div>

              <div className="rff-modal-hint">
                <AlertCircle size={14} />
                <span>記録と同時にステータスは「差戻し」となり、申請者に通知されます。申請者が修正・再申請するまで経理側での再操作は不要です。</span>
              </div>

              <div className="rff-modal-actions">
                <button className="rff-btn ghost" onClick={() => setFailureModal(null)}>キャンセル</button>
                <button className="rff-btn danger" onClick={submitFailure}>
                  <AlertCircle size={14} /> 失敗記録 → 自動差戻し
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <style jsx global>{`
        .rff-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .rff-header { background: #fff; height: 72px; border-bottom: 2px solid #8b5cf6; position: sticky; top: 0; z-index: 50; }
        .rff-header-inner { max-width: 1400px; margin: 0 auto; height: 100%; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
        .rff-brand { display: flex; align-items: center; gap: 20px; }
        .rff-back-link { color: #94a3b8; display: flex; }
        .rff-back-link:hover { color: #8b5cf6; }
        .rff-main-title { font-size: 18px; font-weight: 800; margin: 0; color: #1e293b; }
        .rff-sub-title { font-size: 13px; color: #64748b; font-weight: 600; margin: 0; }
        .rff-data-badge { display: flex; align-items: center; gap: 6px; background: #f5f3ff; color: #6d28d9; padding: 6px 12px; border-radius: 20px; border: 1px solid #ddd6fe; font-size: 11px; font-weight: 700; }

        .rff-container { max-width: 1400px; margin: 0 auto; padding: 24px; }

        .rff-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
        .rff-stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; border-left: 4px solid var(--c); }
        .rff-stat-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .rff-stat-num { font-size: 26px; font-weight: 900; color: #0f172a; line-height: 1; }
        .rff-stat-num small { font-size: 14px; color: #94a3b8; margin-left: 4px; }
        .rff-stat-sub { font-size: 11px; color: #94a3b8; margin-top: 6px; font-weight: 600; }

        .rff-selection-bar { position: sticky; top: 72px; z-index: 40; background: linear-gradient(90deg, #ede9fe 0%, #faf5ff 100%); border: 1px solid #c4b5fd; border-radius: 12px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; box-shadow: 0 4px 12px -4px rgba(139, 92, 246, 0.2); }
        .rff-selection-info { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 13px; }
        .rff-selection-badge { background: #8b5cf6; color: #fff; padding: 4px 12px; border-radius: 20px; font-weight: 800; font-size: 12px; }
        .rff-selection-info strong { color: #6d28d9; font-weight: 800; }
        .rff-selection-banks { display: flex; gap: 6px; flex-wrap: wrap; }
        .rff-bank-chip { background: #fff; border: 1px solid #c4b5fd; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: #6d28d9; }
        .rff-selection-actions { display: flex; gap: 8px; }

        .rff-section { margin-bottom: 32px; }
        .rff-section-h { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800; margin: 0 0 12px; color: #1e293b; }
        .rff-section-head { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
        .rff-tabs { display: flex; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 10px; width: fit-content; }
        .rff-tab { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border: none; background: transparent; border-radius: 7px; font-size: 12px; font-weight: 700; color: #64748b; cursor: pointer; }
        .rff-tab.active { background: #fff; color: #6d28d9; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        .rff-tab span { font-size: 10px; padding: 1px 6px; background: #e2e8f0; color: #64748b; border-radius: 8px; font-weight: 800; }
        .rff-tab.active span { background: #f5f3ff; color: #6d28d9; }

        .rff-toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .rff-search-bar { flex: 1; min-width: 280px; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #94a3b8; }
        .rff-search-bar:focus-within { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15); }
        .rff-search-bar input { flex: 1; border: none; outline: none; font-size: 13px; background: transparent; }
        .rff-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #475569; cursor: pointer; background: #fff; border: 1px solid #cbd5e1; padding: 7px 12px; border-radius: 10px; }
        .rff-toggle input { accent-color: #8b5cf6; }
        .rff-link-btn { background: none; border: none; color: #8b5cf6; font-size: 12px; font-weight: 700; cursor: pointer; padding: 6px 10px; }
        .rff-link-btn:hover { text-decoration: underline; }

        /* Groups */
        .rff-groups { display: flex; flex-direction: column; gap: 14px; }
        .rff-group { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
        .rff-group-head { background: linear-gradient(90deg, #f5f3ff 0%, #fff 100%); padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd6fe; }
        .rff-group-head-left { display: flex; align-items: center; gap: 10px; color: #6d28d9; }
        .rff-group-bank { font-size: 15px; font-weight: 800; }
        .rff-group-code { font-size: 11px; color: #94a3b8; font-weight: 700; }
        .rff-group-head-right { display: flex; align-items: center; gap: 14px; }
        .rff-group-count { font-size: 11px; font-weight: 800; color: #64748b; background: #fff; padding: 3px 10px; border-radius: 12px; border: 1px solid #e2e8f0; }
        .rff-group-amount { font-size: 16px; font-weight: 900; color: #6d28d9; }

        .rff-rows { display: flex; flex-direction: column; }

        /* Checkbox */
        .rff-check-wrap { display: flex; cursor: pointer; align-items: center; }
        .rff-check-wrap input { display: none; }
        .rff-check { width: 18px; height: 18px; border: 2px solid #cbd5e1; border-radius: 5px; display: inline-block; position: relative; transition: 0.15s; }
        .rff-check-wrap input:checked + .rff-check { background: #8b5cf6; border-color: #8b5cf6; }
        .rff-check-wrap input:checked + .rff-check::after { content: ""; position: absolute; left: 4px; top: 1px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }

        /* Batch table */
        .rff-section-toolbar { display: flex; justify-content: space-between; align-items: end; margin-bottom: 12px; }
        .rff-section-meta { font-size: 11px; color: #94a3b8; font-weight: 600; }

        .rff-batch-controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
        .rff-batch-controls .rff-search-bar { flex: 1; min-width: 280px; }
        .rff-search-clear { background: none; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center; }
        .rff-search-clear:hover { color: #ef4444; }
        .rff-month-tabs { display: flex; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 10px; flex-wrap: wrap; }
        .rff-month-tab { padding: 6px 12px; border: none; background: transparent; border-radius: 7px; font-size: 12px; font-weight: 700; color: #64748b; cursor: pointer; transition: 0.15s; }
        .rff-month-tab:hover { color: #6d28d9; }
        .rff-month-tab.active { background: #fff; color: #6d28d9; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }

        .rff-month-group { margin-bottom: 20px; }
        .rff-month-head { background: linear-gradient(90deg, #f5f3ff 0%, #fff 100%); border: 1px solid #ddd6fe; border-radius: 10px 10px 0 0; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; border-bottom: none; }
        .rff-month-label { display: flex; align-items: baseline; gap: 4px; color: #6d28d9; }
        .rff-month-y { font-size: 13px; font-weight: 700; }
        .rff-month-m { font-size: 22px; font-weight: 900; }
        .rff-month-stats { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #64748b; font-weight: 700; }
        .rff-month-stats strong { color: #6d28d9; font-weight: 900; font-size: 14px; }
        .rff-month-group .rff-batch-table { border-radius: 0 0 12px 12px; border-top: none; }

        .rff-batch-table { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
        .rff-batch-th, .rff-batch-tr { display: grid; grid-template-columns: 150px 120px 1fr 1fr 110px 100px 90px 130px; gap: 12px; padding: 12px 18px; align-items: center; }
        .rff-batch-tr { cursor: pointer; transition: 0.15s; }
        .rff-batch-tr:hover { background: #faf5ff; }
        .rff-batch-tr.open { background: #faf5ff; border-bottom: none; }
        .rff-batch-tr.has-issue { background: linear-gradient(90deg, #fef2f2 0%, transparent 30%); }
        .rff-batch-tr.has-issue.open { background: linear-gradient(90deg, #fef2f2 0%, #faf5ff 50%); }
        .rff-batch-bd { display: flex; flex-direction: column; gap: 4px; }
        .rff-batch-count { font-size: 12px; font-weight: 800; color: #475569; }
        .rff-batch-breakdown { display: flex; gap: 4px; flex-wrap: wrap; }
        .rff-bank-chip.sm { font-size: 10px; padding: 1px 8px; }
        .rff-batch-progress { display: flex; gap: 4px; flex-wrap: wrap; }
        .rff-prog-chip { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px; }
        .rff-prog-chip.done { background: #d1fae5; color: #047857; }
        .rff-prog-chip.arranged { background: #dbeafe; color: #1d4ed8; }
        .rff-prog-chip.failed { background: #fee2e2; color: #b91c1c; }
        .rff-prog-chip.returned { background: #fef3c7; color: #b45309; }

        .rff-batch-detail { background: #faf5ff; border-bottom: 1px solid #e2e8f0; padding: 12px 18px 16px; }
        .rff-batch-detail-head { font-size: 10px; font-weight: 800; color: #6d28d9; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; padding: 6px 12px; background: #fff; border-radius: 6px; border: 1px solid #ddd6fe; }
        .rff-batch-detail-list { display: flex; flex-direction: column; gap: 6px; }
        .rff-batch-item { display: grid; grid-template-columns: 140px 1.4fr 1.2fr 140px 90px 100px 1fr; gap: 10px; align-items: center; padding: 10px 14px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; }
        .rff-batch-item.state-振込失敗 { border-color: #fecaca; background: #fef9f9; }
        .rff-batch-item.state-差戻し { border-color: #fed7aa; background: #fffaf2; }
        .rff-batch-item.state-振込完了 { opacity: 0.7; }
        .rff-batch-item .rff-history-sub { font-size: 10px; }
        .rff-batch-item-actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
        .rff-batch-item-note { font-size: 10px; color: #94a3b8; font-weight: 600; padding: 2px 8px; background: #f1f5f9; border-radius: 6px; }
        .rff-mini-btn { padding: 4px 10px; font-size: 10px; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; }
        .rff-mini-btn.primary { background: #10b981; color: #fff; }
        .rff-mini-btn.primary:hover { background: #059669; }
        .rff-mini-btn.danger { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
        .rff-mini-btn.danger:hover { background: #fef2f2; }
        .rff-mini-btn.warning { background: #f59e0b; color: #fff; }
        .rff-mini-btn.warning:hover { background: #d97706; }

        .rff-modal-breakdown { background: #f8fafc; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
        .rff-modal-breakdown-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .rff-batch-th { background: #f8fafc; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0; }
        .rff-batch-tr { font-size: 12px; font-weight: 600; border-bottom: 1px solid #f1f5f9; }
        .rff-batch-tr:last-child { border-bottom: none; }
        .rff-batch-tr small { color: #94a3b8; font-weight: 500; }
        .rff-status-chip { font-size: 10px; font-weight: 800; padding: 3px 10px; border-radius: 20px; }
        :global(.mono), .mono { font-family: 'SF Mono', Menlo, monospace; }

        .rff-empty { padding: 32px 20px; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; background: #fff; border: 1px dashed #e2e8f0; border-radius: 12px; }

        /* Modal */
        .rff-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
        .rff-modal { background: #fff; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; position: relative; max-height: 90vh; overflow-y: auto; }
        .rff-modal.large { max-width: 640px; }
        .rff-modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #94a3b8; cursor: pointer; }
        .rff-modal h3 { font-size: 20px; font-weight: 800; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; color: #6d28d9; }
        .rff-modal h3.center { justify-content: center; }
        .rff-modal p { font-size: 13px; color: #64748b; margin: 0 0 16px; line-height: 1.6; }
        .rff-modal p.center { text-align: center; }
        .rff-modal strong { color: #0f172a; font-weight: 800; }
        .rff-modal-icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
        .rff-modal-icon.ok { background: #d1fae5; color: #059669; }
        .rff-modal-summary { background: #faf5ff; border: 1px solid #ddd6fe; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
        .rff-modal-summary-row { display: flex; justify-content: space-between; font-size: 13px; }
        .rff-modal-summary-row span { color: #64748b; font-weight: 700; }
        .rff-modal-banks { background: #f8fafc; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
        .rff-modal-banks-h { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .rff-modal-bank-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #fff; border-radius: 6px; margin-bottom: 4px; }
        .rff-modal-bank-row:last-child { margin-bottom: 0; }
        .rff-modal-bank-name { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 6px; color: #0f172a; }
        .rff-modal-bank-name small { color: #94a3b8; }
        .rff-modal-bank-file { font-size: 10px; color: #94a3b8; margin-top: 2px; }
        .rff-modal-bank-amount { font-size: 12px; font-weight: 800; color: #6d28d9; }
        .rff-modal-hint { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #fef3c7; color: #92400e; border-radius: 10px; font-size: 12px; font-weight: 600; margin-top: 12px; }

        .rff-form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
        .rff-form-row label { font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; }
        .rff-form-row .req { color: #ef4444; }
        .rff-form-row input { padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-family: inherit; }
        .rff-form-row input:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15); }
        .rff-form-hint { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .rff-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

        .rff-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 800; cursor: pointer; transition: 0.15s; border: none; }
        .rff-btn.sm { padding: 6px 12px; font-size: 11px; }
        .rff-btn.primary { background: #8b5cf6; color: #fff; }
        .rff-btn.primary:hover { background: #7c3aed; }
        .rff-btn.danger { background: #ef4444; color: #fff; }
        .rff-btn.outline { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
        .rff-btn.ghost { background: transparent; color: #94a3b8; }
        .rff-btn.ghost:hover { color: #475569; }

        @media (max-width: 1024px) {
          .rff-stats { grid-template-columns: repeat(2, 1fr); }
          .rff-batch-th, .rff-batch-tr { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}

// ---- 申請行 ----
function AppRow({
  app,
  selectable,
  checked,
  onToggle,
  expanded,
  onExpand,
  onComplete,
  onFail,
}: {
  app: RefundApp;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  onComplete?: () => void;
  onFail?: () => void;
}) {
  return (
    <div className={`row ${expanded ? "open" : ""} ${checked ? "selected" : ""}`}>
      <div className="row-summary" onClick={onExpand}>
        {selectable ? (
          <label className="row-check-wrap" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={checked} onChange={onToggle} />
            <span className="row-check" />
          </label>
        ) : (
          <div className="row-check-placeholder" />
        )}
        <div className="row-main">
          <div className="row-id mono">{app.id}</div>
          <div className="row-member">
            {app.memberName} <span className="row-memberid">({app.memberId})</span>
          </div>
        </div>
        <div className="row-period mono">
          {app.targetMonthFrom === app.targetMonthTo ? app.targetMonthFrom : `${app.targetMonthFrom}〜${app.targetMonthTo}`}
        </div>
        <div className="row-account">
          <div className="row-account-bank">{app.account.bankName} {app.account.branchName}</div>
          <div className="row-account-detail mono">{app.account.accountTypeLabel} {app.account.accountNumber} / {app.account.holderName}</div>
        </div>
        <div className="row-amount">¥{app.totalAmount.toLocaleString()}</div>
        <span className="row-status" style={{ background: `${STATUS_COLOR[app.status]}15`, color: STATUS_COLOR[app.status] }}>{app.status}</span>
        <ChevronDown size={14} className="row-chev" />
      </div>

      {expanded && (
        <div className="row-detail">
          <div className="row-detail-grid">
            <div>
              <div className="row-detail-label">申請者</div>
              <div className="row-detail-value">{app.applicantName}<small>{app.applicantDept}</small></div>
            </div>
            <div>
              <div className="row-detail-label">承認者</div>
              <div className="row-detail-value">{app.approverName}<small className="mono">{app.approvedAt}</small></div>
            </div>
            <div>
              <div className="row-detail-label">CSVバッチ</div>
              <div className="row-detail-value mono">{app.batchId ?? "—"}</div>
            </div>
            <div>
              <div className="row-detail-label">振込予定日 / 完了日</div>
              <div className="row-detail-value mono">{app.scheduledTransferDate ?? "—"}{app.transferCompletedAt ? ` / ${app.transferCompletedAt}` : ""}</div>
            </div>
          </div>

          <div className="row-detail-section">
            <div className="row-detail-label">返金項目</div>
            <ul className="row-items">
              {app.items.map((it) => (
                <li key={it.id}><span>{it.label}<small>{it.category}</small></span><strong>¥{it.amount.toLocaleString()}</strong></li>
              ))}
            </ul>
          </div>

          <div className="row-detail-section">
            <div className="row-detail-label">申請理由</div>
            <div className="row-reason">{app.reason}</div>
            {app.approverComment && (
              <div className="row-approver-comment"><strong>承認者：</strong>{app.approverComment}</div>
            )}
          </div>

          {app.failure && (
            <div className="row-detail-section">
              <div className="row-detail-label" style={{ color: "#b91c1c" }}>振込失敗 記録</div>
              <div className="row-failure">
                <div className="row-failure-row">
                  <span>失敗理由</span>
                  <strong>{app.failure.reason}</strong>
                </div>
                {app.failure.detail && (
                  <div className="row-failure-row">
                    <span>詳細</span>
                    <span>{app.failure.detail}</span>
                  </div>
                )}
                <div className="row-failure-row">
                  <span>記録</span>
                  <span className="mono">{app.failure.failedAt} / {app.failure.operator}</span>
                </div>
              </div>
            </div>
          )}

          {app.status === "振込手配中" && (
            <div className="row-detail-actions">
              <button className="row-act danger" onClick={onFail}>
                振込失敗（自動差戻し）
              </button>
              <button className="row-act primary" onClick={onComplete}>
                振込完了
              </button>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .row { border-bottom: 1px solid #f1f5f9; transition: 0.1s; }
        .row:last-child { border-bottom: none; }
        .row.selected { background: #faf5ff; }
        .row-summary { display: grid; grid-template-columns: 28px 1.4fr 100px 1.6fr 130px 110px 16px; gap: 12px; padding: 14px 18px; align-items: center; cursor: pointer; }
        .row-summary:hover { background: #f8fafc; }
        .row.selected .row-summary { background: #faf5ff; }
        .row-check-wrap { display: flex; cursor: pointer; }
        .row-check-wrap input { display: none; }
        .row-check { width: 18px; height: 18px; border: 2px solid #cbd5e1; border-radius: 5px; display: inline-block; position: relative; transition: 0.15s; }
        .row-check-wrap input:checked + .row-check { background: #8b5cf6; border-color: #8b5cf6; }
        .row-check-wrap input:checked + .row-check::after { content: ""; position: absolute; left: 4px; top: 1px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
        .row-check-placeholder { width: 18px; height: 18px; }

        .row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .row-id { font-family: 'SF Mono', Menlo, monospace; font-size: 10px; font-weight: 800; color: #94a3b8; }
        .row-member { font-size: 14px; font-weight: 800; color: #0f172a; }
        .row-memberid { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .row-period { font-size: 11px; color: #475569; font-weight: 700; }
        .row-account { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .row-account-bank { font-size: 12px; font-weight: 700; color: #0f172a; }
        .row-account-detail { font-size: 11px; color: #94a3b8; }
        .row-amount { font-size: 15px; font-weight: 900; color: #6d28d9; text-align: right; }
        .row-status { font-size: 10px; font-weight: 800; padding: 3px 10px; border-radius: 20px; text-align: center; }
        .row-chev { color: #cbd5e1; transition: 0.2s; }
        .row.open .row-chev { transform: rotate(180deg); color: #8b5cf6; }

        .row-detail { padding: 16px 24px 20px; background: #fafbfc; display: flex; flex-direction: column; gap: 14px; border-top: 1px dashed #e2e8f0; }
        .row-detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .row-detail-label { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
        .row-detail-value { font-size: 13px; font-weight: 700; color: #0f172a; }
        .row-detail-value small { display: block; font-size: 11px; color: #94a3b8; font-weight: 500; margin-top: 2px; }
        .row-detail-section { display: flex; flex-direction: column; gap: 6px; }
        .row-items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
        .row-items li { display: flex; justify-content: space-between; padding: 8px 12px; background: #fff; border-radius: 8px; font-size: 12px; }
        .row-items li small { display: block; color: #94a3b8; font-weight: 500; }
        .row-items li strong { color: #6d28d9; font-weight: 800; }
        .row-reason { font-size: 13px; color: #475569; padding: 10px 14px; background: #fff; border-radius: 8px; line-height: 1.6; white-space: pre-wrap; }
        .row-approver-comment { font-size: 12px; color: #92400e; padding: 8px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; font-style: italic; }

        .row-failure { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
        .row-failure-row { display: grid; grid-template-columns: 100px 1fr; gap: 12px; font-size: 12px; }
        .row-failure-row > span:first-child { font-size: 10px; font-weight: 800; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.05em; }
        .row-failure-row strong { color: #7f1d1d; font-weight: 800; }

        .row-detail-actions { display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px; border-top: 1px dashed #e2e8f0; }
        .row-act { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 800; cursor: pointer; border: none; transition: 0.15s; }
        .row-act.primary { background: #10b981; color: #fff; }
        .row-act.primary:hover { background: #059669; }
        .row-act.danger { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
        .row-act.danger:hover { background: #fef2f2; border-color: #ef4444; }
        .row-act.warning { background: #f59e0b; color: #fff; }
        .row-act.warning:hover { background: #d97706; }
        :global(.mono) { font-family: 'SF Mono', Menlo, monospace; }

        @media (max-width: 1024px) {
          .row-summary { grid-template-columns: 28px 1fr 110px 16px; }
          .row-period, .row-account, .row-status { display: none; }
          .row-detail-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}
