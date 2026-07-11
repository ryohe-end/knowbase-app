"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Check, Search, Calendar, User, Receipt,
  ClipboardCheck, X, AlertCircle, FileText, Database, CreditCard,
  Edit3, RefreshCw, Send, ChevronRight
} from "lucide-react";
import type {
  RefundApplication as ApiApplication,
  ApprovalStep as ApiStep,
  BankAccount as ApiBankAccount,
} from "@/types/refundApplication";
import RefundEditDialog from "./RefundEditDialog";

// ---- 型 (UI 用ローカル型 — API 型 [types/refundApplication] とは adapt で接続) ----
type BankAccount = {
  bankCode?: string;
  bankName: string;
  branchCode?: string;
  branchName: string;
  accountType: "普通" | "当座";
  accountNumber: string;
  holderName: string;
  source: "登録済み（引落口座）" | "登録済み（過去返金）" | "未登録";
};

type BankSuggest = {
  code: string;
  name: string;
  halfWidthKana?: string;
  hiragana?: string;
};

type Member = {
  memberId: string;
  name: string;
  kana: string;
  phone: string;
  plan: string;
  account: BankAccount;
};

type RefundableItem = {
  id: string;
  label: string;
  amount: number;
  paidAt: string;
  targetMonth: string;
  category: "月会費" | "オプション" | "事務手数料" | "1Day" | "その他";
};

// ---- 承認フロー（固定3段階） ----
type Approver = { role: string; name: string; dept: string; email: string };

const APPROVERS = {
  applicant: { role: "申請者", name: "遠藤 涼平", dept: "旭川アモール 店舗", email: "r-endo@okamoto-group.co.jp" } as Approver,
  approver: { role: "承認者", name: "後藤 充洋", dept: "旭川アモール 店長", email: "goto@fit365.jp" } as Approver,
  finance: { role: "経理部", name: "経理部 担当", dept: "本部 経理部", email: "keiri@fit365.jp" } as Approver,
};

// 表示用フォールバック (実際の名前は API ステップで上書きされる)
const APPROVAL_FLOW: Approver[] = [APPROVERS.applicant, APPROVERS.approver, APPROVERS.finance];

// 役割表示 (API → ローカル role/3 段ラベル変換)
function roleLabel(role: ApiStep["role"]): "申請者" | "承認者" | "経理部" {
  if (role === "approver") return "承認者";
  if (role === "finance") return "経理部";
  return "申請者";
}
function labelToRole(label: string): ApiStep["role"] {
  if (label === "承認者") return "approver";
  if (label === "経理部") return "finance";
  return "applicant";
}

// API → UI 変換
function apiToUi(a: ApiApplication): RefundApplication {
  return {
    id: a.applicationId,
    targetMonthFrom: a.targetMonthFrom,
    targetMonthTo: a.targetMonthTo,
    memberId: a.memberNo,
    memberName: a.memberName,
    items: (a.items ?? []).map((it) => ({ id: it.id, label: it.label, amount: it.amount })),
    totalAmount: a.totalAmount,
    reason: a.reason,
    // 申請者画面では「振込手配中」を「承認待ち」相当として表示
    status: a.status === "振込手配中" ? "承認待ち" : (a.status as RefundApplication["status"]),
    createdAt: (a.createdAt ?? "").slice(0, 10),
    steps: (a.steps ?? []).map((s) => ({
      approver: {
        role: roleLabel(s.role),
        name: s.userName || "",
        dept: s.dept || "",
        email: s.email || "",
      },
      state: s.state,
      actedAt: s.actedAt,
      comment: s.comment,
    })),
    account: a.bankAccount
      ? {
          bankCode: a.bankAccount.bankCode,
          bankName: a.bankAccount.bankName,
          branchCode: a.bankAccount.branchCode,
          branchName: a.bankAccount.branchName,
          accountType: a.bankAccount.accountType,
          accountNumber: a.bankAccount.accountNumber,
          holderName: a.bankAccount.holderName,
          source: (a.bankAccount.source as BankAccount["source"]) || "登録済み（過去返金）",
        }
      : undefined,
    _raw: a,
  };
}

// UI → API へ送る payload を構築
function uiToApiPayload(
  u: Partial<RefundApplication>,
  clubCode: string,
  member: { memberId: string; name: string; kana?: string; phone?: string; plan?: string } | null,
): Partial<ApiApplication> {
  return {
    applicationId: u.id,
    clubCode,
    status: u.status,
    memberNo: u.memberId ?? member?.memberId ?? "",
    memberName: u.memberName ?? member?.name ?? "",
    memberKana: member?.kana,
    memberPhone: member?.phone,
    memberPlan: member?.plan,
    targetMonthFrom: u.targetMonthFrom ?? "",
    targetMonthTo: u.targetMonthTo ?? "",
    items: u.items,
    totalAmount: u.totalAmount,
    reason: u.reason,
    bankAccount: u.account
      ? {
          bankCode: u.account.bankCode,
          bankName: u.account.bankName,
          branchCode: u.account.branchCode,
          branchName: u.account.branchName,
          accountType: u.account.accountType,
          accountNumber: u.account.accountNumber,
          holderName: u.account.holderName,
          source: u.account.source,
        }
      : undefined,
    steps: (u.steps ?? []).map((s) => ({
      role: labelToRole(s.approver.role),
      userId: "",
      userName: s.approver.name,
      dept: s.approver.dept,
      email: s.approver.email,
      state: s.state,
      actedAt: s.actedAt,
      comment: s.comment,
    })),
  };
}

type StepState = "完了" | "対応中" | "未対応" | "差戻し";
type ApprovalStep = {
  approver: Approver;
  state: StepState;
  actedAt?: string;
  comment?: string;
};

type RefundApplication = {
  id: string;
  targetMonthFrom: string;
  targetMonthTo: string;
  memberId: string;
  memberName: string;
  items: { id: string; label: string; amount: number }[];
  totalAmount: number;
  reason: string;
  status: "下書き" | "承認待ち" | "承認済み" | "差戻し";
  createdAt: string;
  steps: ApprovalStep[];
  account?: BankAccount;
  // 編集保存で全フィールドを維持して送り返すための元 API オブジェクト (DEMO は未設定)
  _raw?: ApiApplication;
};


const STATUS_COLOR: Record<RefundApplication["status"], string> = {
  下書き: "#94a3b8",
  承認待ち: "#f59e0b",
  承認済み: "#10b981",
  差戻し: "#ef4444",
};

const STEPS = [
  { id: 1, label: "対象期間", icon: <Calendar size={16} /> },
  { id: 2, label: "会員検索", icon: <User size={16} /> },
  { id: 3, label: "返金項目", icon: <Receipt size={16} /> },
  { id: 4, label: "確認", icon: <ClipboardCheck size={16} /> },
];

// デモ用: 申請 → 承認者承認 → 経理処理 まで完了している返金申請の例
const DEMO_APPLICATIONS: RefundApplication[] = [
  {
    id: "DEMO-REF-001",
    targetMonthFrom: "2026-03",
    targetMonthTo: "2026-03",
    memberId: "9001234",
    memberName: "山田 太郎",
    items: [
      { id: "d1-1", label: "2026年3月 月会費", amount: 8800 },
      { id: "d1-2", label: "2026年3月 水素水オプション", amount: 1100 },
    ],
    totalAmount: 9900,
    reason: "入院により休会扱いとなったため、3月分会費の返金を申請します。",
    status: "承認済み",
    createdAt: "2026-04-02",
    steps: [
      { approver: { role: "申請者", name: "遠藤 涼平", dept: "旭川アモール 店舗", email: "r-endo@okamoto-group.co.jp" }, state: "完了", actedAt: "2026-04-02 10:14", comment: "添付の診断書通り休会扱い済み" },
      { approver: { role: "承認者", name: "後藤 充洋", dept: "旭川アモール 店長", email: "goto@fit365.jp" }, state: "完了", actedAt: "2026-04-02 15:42", comment: "事由・金額ともに妥当。承認します。" },
      { approver: { role: "経理部", name: "経理部 担当", dept: "本部 経理部", email: "keiri@fit365.jp" }, state: "完了", actedAt: "2026-04-04 11:08", comment: "登録口座へ振込完了 (振込日: 2026-04-04)" },
    ],
    account: {
      bankName: "三井住友銀行", branchName: "旭川支店", bankCode: "0009", branchCode: "521",
      accountType: "普通", accountNumber: "1234567", holderName: "ヤマダ タロウ",
      source: "登録済み（引落口座）",
    },
  },
  {
    id: "DEMO-REF-002",
    targetMonthFrom: "2026-02",
    targetMonthTo: "2026-02",
    memberId: "9002311",
    memberName: "佐藤 花子",
    items: [
      { id: "d2-1", label: "2026年2月 月会費", amount: 9900 },
    ],
    totalAmount: 9900,
    reason: "店舗工事による休館期間 (2/15-2/28) があったため日割相当分を返金。",
    status: "承認済み",
    createdAt: "2026-03-05",
    steps: [
      { approver: { role: "申請者", name: "遠藤 涼平", dept: "旭川アモール 店舗", email: "r-endo@okamoto-group.co.jp" }, state: "完了", actedAt: "2026-03-05 09:00", comment: "対象会員リストより自動算出" },
      { approver: { role: "承認者", name: "後藤 充洋", dept: "旭川アモール 店長", email: "goto@fit365.jp" }, state: "完了", actedAt: "2026-03-05 13:20", comment: "工事告知対応。承認。" },
      { approver: { role: "経理部", name: "経理部 担当", dept: "本部 経理部", email: "keiri@fit365.jp" }, state: "完了", actedAt: "2026-03-07 10:30", comment: "振込完了" },
    ],
    account: {
      bankName: "北海道銀行", branchName: "本店", bankCode: "0501", branchCode: "100",
      accountType: "普通", accountNumber: "7654321", holderName: "サトウ ハナコ",
      source: "登録済み（過去返金）",
    },
  },
];


// BankCode JP オートコンプリート用デバウンス hook
function useDebounce<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

// 銀行/支店オートコンプリート
function BankcodeAutocomplete({
  kind,
  bankCode,
  value,
  code,
  onPick,
  onChangeText,
  placeholder,
}: {
  kind: "bank" | "branch";
  bankCode?: string;
  value: string;
  code?: string;
  onPick: (item: BankSuggest) => void;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BankSuggest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounce(value, 280);

  React.useEffect(() => {
    if (!open) return;
    if (kind === "branch" && !bankCode) return;
    if (!debounced || debounced.trim().length === 0) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const fetchSuggest = async () => {
      setLoading(true);
      setError(null);
      try {
        const url =
          kind === "bank"
            ? `/api/bankcode/banks?q=${encodeURIComponent(debounced)}&limit=15`
            : `/api/bankcode/branches?bankCode=${encodeURIComponent(bankCode!)}&q=${encodeURIComponent(debounced)}&limit=20`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "検索に失敗しました");
          setItems([]);
        } else {
          const list: BankSuggest[] = kind === "bank" ? data.banks ?? [] : data.branches ?? [];
          setItems(list);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setError("通信エラー");
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchSuggest();
    return () => ctrl.abort();
  }, [debounced, open, kind, bankCode]);

  return (
    <div className="rfa-ac">
      <div className="rfa-ac-input-wrap">
        <input
          className="rfa-input"
          value={value}
          onChange={(e) => { onChangeText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          disabled={kind === "branch" && !bankCode}
        />
        {code && <span className="rfa-ac-code">{code}</span>}
      </div>
      {open && (loading || error || items.length > 0 || (value && !loading)) && (
        <div className="rfa-ac-dropdown">
          {loading && <div className="rfa-ac-msg">検索中…</div>}
          {error && <div className="rfa-ac-msg error">{error}</div>}
          {!loading && !error && items.length === 0 && value && (
            <div className="rfa-ac-msg">候補なし</div>
          )}
          {items.map((it) => (
            <button
              key={it.code}
              className="rfa-ac-item"
              onMouseDown={(e) => { e.preventDefault(); onPick(it); setOpen(false); }}
            >
              <span className="rfa-ac-item-name">{it.name}</span>
              <span className="rfa-ac-item-meta">
                {it.halfWidthKana && <span>{it.halfWidthKana}</span>}
                <span className="rfa-ac-item-code">#{it.code}</span>
              </span>
            </button>
          ))}
          <div className="rfa-ac-footer">出典: BankCode JP</div>
        </div>
      )}
    </div>
  );
}

type ClubOption = { clubCode: string; clubName?: string; clubNameShort?: string };

// クラブ検索付きセレクタ
function ClubSearchSelect({
  clubs,
  value,
  onChange,
}: {
  clubs: ClubOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = clubs.find((c) => c.clubCode === value) || null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter((c) =>
      c.clubCode.toLowerCase().includes(q) ||
      (c.clubNameShort || "").toLowerCase().includes(q) ||
      (c.clubName || "").toLowerCase().includes(q)
    );
  }, [clubs, query]);

  const displayLabel = selected
    ? `${selected.clubCode} ${selected.clubNameShort || selected.clubName || ""}`
    : "選択してください";

  return (
    <div className="rfa-club-search" ref={wrapRef}>
      <button
        type="button"
        className="rfa-club-search-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? "" : "rfa-club-search-placeholder"}>{displayLabel}</span>
        <span className="rfa-club-search-caret">▾</span>
      </button>
      {open && (
        <div className="rfa-club-search-dropdown">
          <div className="rfa-club-search-input-wrap">
            <Search size={14} />
            <input
              autoFocus
              type="text"
              className="rfa-club-search-input"
              placeholder="クラブコード / 名前で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="rfa-club-search-clear" onClick={() => setQuery("")}>✕</button>
            )}
          </div>
          <div className="rfa-club-search-list">
            {filtered.length === 0 && (
              <div className="rfa-club-search-empty">候補なし</div>
            )}
            {filtered.map((c) => (
              <button
                key={c.clubCode}
                type="button"
                className={`rfa-club-search-item ${c.clubCode === value ? "selected" : ""}`}
                onClick={() => { onChange(c.clubCode); setOpen(false); setQuery(""); }}
              >
                <span className="rfa-club-search-code">{c.clubCode}</span>
                <span className="rfa-club-search-name">{c.clubNameShort || c.clubName || ""}</span>
              </button>
            ))}
          </div>
          <div className="rfa-club-search-footer">{filtered.length} / {clubs.length} 件</div>
        </div>
      )}
    </div>
  );
}

export default function RefundApplicationPage() {
  // クラブセレクタ
  const [clubOptions, setClubOptions] = useState<ClubOption[]>([]);
  const [shopId, setShopId] = useState<string>("");
  const shopName = useMemo(() => {
    const c = clubOptions.find((x) => x.clubCode === shopId);
    return c?.clubNameShort || c?.clubName || "";
  }, [clubOptions, shopId]);

  const [step, setStep] = useState(1);
  const [targetMonthFrom, setTargetMonthFrom] = useState("");
  const [targetMonthTo, setTargetMonthTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [adjustedAmounts, setAdjustedAmounts] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [successOpen, setSuccessOpen] = useState(false);

  // 返金先口座
  const [accountEditing, setAccountEditing] = useState(false);
  const [accountDraft, setAccountDraft] = useState<BankAccount | null>(null);
  const [accountOverridden, setAccountOverridden] = useState(false);

  // 履歴 (API から取得)
  const [history, setHistory] = useState<RefundApplication[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"all" | RefundApplication["status"]>("all");
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"edit" | "resubmit" | null>(null);

  // 申請後の編集/削除モーダル (編集は独立ダイアログ RefundEditDialog が担う)
  const [editTargetApp, setEditTargetApp] = useState<RefundApplication | null>(null);
  const [deleteTargetApp, setDeleteTargetApp] = useState<RefundApplication | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingNow, setDeletingNow] = useState(false);

  const openEditModal = (app: RefundApplication) => setEditTargetApp(app);
  const closeEditModal = () => setEditTargetApp(null);
  const saveEdit = async (draft: { reason: string; items: { id: string; label: string; amount: number }[] }) => {
    if (!editTargetApp) return;
    const target = editTargetApp;
    setEditSaving(true);
    // DEMO レコードは API を持たないのでローカル更新のみ
    if (target.id.startsWith("DEMO-") || !target._raw) {
      const newTotal = draft.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
      setHistory((prev) => prev.map((h) => (
        h.id === target.id ? { ...h, reason: draft.reason, items: draft.items, totalAmount: newTotal } : h
      )));
      setEditSaving(false);
      closeEditModal();
      return;
    }
    try {
      // 元の API オブジェクトを維持し、reason/items だけ差し替えて送る (他フィールド消失を防ぐ)
      const payload = { ...target._raw, reason: draft.reason, items: draft.items };
      const res = await fetch("/api/store-settings/refund-payment/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "保存に失敗しました");
      const ui = apiToUi(data.application as ApiApplication);
      setHistory((prev) => prev.map((h) => (h.id === ui.id ? ui : h)));
      closeEditModal();
    } catch (e: any) {
      alert(e?.message || "保存エラー");
    } finally {
      setEditSaving(false);
    }
  };

  const openDeleteModal = (app: RefundApplication) => setDeleteTargetApp(app);
  const closeDeleteModal = () => setDeleteTargetApp(null);
  const confirmDelete = async () => {
    if (!deleteTargetApp) return;
    const target = deleteTargetApp;
    setDeletingNow(true);
    // DEMO レコードはローカル除外のみ
    if (target.id.startsWith("DEMO-")) {
      setHistory((prev) => prev.filter((h) => h.id !== target.id));
      setDeletingNow(false);
      closeDeleteModal();
      return;
    }
    try {
      const res = await fetch(
        `/api/store-settings/refund-payment/applications/${encodeURIComponent(target.id)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "削除に失敗しました");
      setHistory((prev) => prev.filter((h) => h.id !== target.id));
      closeDeleteModal();
    } catch (e: any) {
      alert(e?.message || "削除エラー");
    } finally {
      setDeletingNow(false);
    }
  };

  // 会員検索 (API)
  const [memberSearchResults, setMemberSearchResults] = useState<Member[]>([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState<string | null>(null);

  // 返金可能項目 (API)
  const [apiRefundableItems, setApiRefundableItems] = useState<RefundableItem[]>([]);

  // 申請中フラグ
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false); // 送信前の最終確認

  // 初回ロード: 自分の申請履歴 + クラブ一覧を取得
  useEffect(() => {
    (async () => {
      try {
        const [appRes, clubRes] = await Promise.all([
          fetch("/api/store-settings/refund-payment/applications?queue=all", { cache: "no-store" }),
          fetch("/api/store-settings/refund-payment/clubs", { cache: "no-store" }),
        ]);
        const appData = await appRes.json();
        if (appData.ok && Array.isArray(appData.applications)) {
          const real = appData.applications.map((a: ApiApplication) => apiToUi(a));
          // DEMO_APPLICATIONS をデモ用に先頭に挿入 (実データと重複しない ID 接頭辞)
          setHistory([...DEMO_APPLICATIONS, ...real]);
        } else {
          setHistory([...DEMO_APPLICATIONS]);
        }
        const clubData = await clubRes.json();
        if (clubData.ok && Array.isArray(clubData.clubs)) {
          setClubOptions(clubData.clubs);
          // 自動選択: 1 件のみなら採用、それ以外は未選択 (ユーザに選ばせる)
          if (clubData.clubs.length === 1) {
            setShopId(clubData.clubs[0].clubCode);
          }
        }
      } catch (e) {
        console.error("Failed to fetch initial data", e);
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, []);

  // 履歴のみ再取得 (submit 後など)
  const reloadHistory = async () => {
    try {
      const res = await fetch("/api/store-settings/refund-payment/applications?queue=all", { cache: "no-store" });
      const data = await res.json();
      if (data.ok && Array.isArray(data.applications)) {
        const real = data.applications.map((a: ApiApplication) => apiToUi(a));
        setHistory([...DEMO_APPLICATIONS, ...real]);
      }
    } catch (e) {
      console.error("history reload failed", e);
    }
  };

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return history.filter((h) => {
      if (historyStatus !== "all" && h.status !== historyStatus) return false;
      if (!q) return true;
      return (
        h.id.toLowerCase().includes(q) ||
        h.memberId.toLowerCase().includes(q) ||
        h.memberName.toLowerCase().includes(q) ||
        h.reason.toLowerCase().includes(q) ||
        h.items.some((it) => it.label.toLowerCase().includes(q))
      );
    });
  }, [history, historySearch, historyStatus]);

  const historyCounts = useMemo(() => {
    const counts: Record<string, number> = { all: history.length, 下書き: 0, 承認待ち: 0, 承認済み: 0, 差戻し: 0 };
    history.forEach((h) => { counts[h.status] = (counts[h.status] ?? 0) + 1; });
    return counts;
  }, [history]);

  // 申請の編集/再申請をウィザードに読み込む
  const loadApplicationIntoWizard = (app: RefundApplication, mode: "edit" | "resubmit") => {
    // 申請レコードから会員情報を復元 (詳細はあくまでスナップショット)
    const member: Member = {
      memberId: app.memberId,
      name: app.memberName,
      kana: "",
      phone: "",
      plan: "",
      account: app.account ?? {
        bankName: "", branchName: "", accountType: "普通", accountNumber: "", holderName: "", source: "未登録",
      },
    };
    setTargetMonthFrom(app.targetMonthFrom);
    setTargetMonthTo(app.targetMonthTo);
    setSelectedMember(member);
    setSelectedItemIds(new Set(app.items.map((i) => i.id)));
    const adj: Record<string, number> = {};
    app.items.forEach((i) => { adj[i.id] = i.amount; });
    setAdjustedAmounts(adj);
    setReason(mode === "resubmit"
      ? `${app.reason}\n\n[再申請] ${app.steps.find((s) => s.state === "差戻し")?.comment ?? ""}`.trim()
      : app.reason
    );
    if (app.account) {
      setAccountDraft(app.account);
    }
    setEditingApplicationId(app.id);
    setEditMode(mode);
    setStep(1);
    setExpandedHistory(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditing = () => {
    setEditingApplicationId(null);
    setEditMode(null);
    reset();
  };

  // ---- 検索結果: /api/admin/member-search (admin 必須) ----
  const debouncedQuery = useDebounce(searchQuery, 300);
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setMemberSearchResults([]);
      setMemberSearchError(null);
      return;
    }
    // 検索 type の推定 (会員番号/電話/カナ/漢字)
    const inferType = (val: string): string => {
      if (/^M\d+$/i.test(val) || /^\d{6,}$/.test(val)) return "member_no";
      if (/^[\d\-]+$/.test(val)) return "phone";
      if (/^[ァ-ヶー\s]+$/.test(val)) return "name_kana";
      return "name_kanji";
    };
    const ctrl = new AbortController();
    setMemberSearchLoading(true);
    setMemberSearchError(null);
    (async () => {
      try {
        const type = inferType(q);
        const url = `/api/admin/member-search?type=${type}&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data?.error || "検索失敗");
        }
        // member-search のレスポンスフォーマット: { ok, results: [...], count }
        const rows = Array.isArray(data.results) ? data.results : (data.members ?? []);
        const members: Member[] = rows.map((m: any): Member => ({
          memberId: String(m.memberNo ?? m.member_no ?? m.kojinSeq ?? ""),
          name: String(m.nameKanji ?? m.name ?? m.fullName ?? ""),
          kana: String([m.nameKanaSei, m.nameKanaMei].filter(Boolean).join(" ") || m.kana || m.nameKana || ""),
          phone: String(m.phone ?? m.tel ?? ""),
          plan: String(m.plan ?? m.planName ?? ""),
          account: {
            bankName: "", branchName: "", accountType: "普通", accountNumber: "", holderName: "",
            source: "未登録",
          },
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

  // 会員選択が変わったら選択項目をクリア (前回会員の選択が残ると不整合)
  useEffect(() => {
    setSelectedItemIds(new Set());
    setAdjustedAmounts({});
  }, [selectedMember?.memberId]);

  // 会員が選択されたら member-detail (Oracle 経由) で口座+項目+プランを取得
  // Step 1 で選んだ対象期間を fromMonth/toMonth (YYYYMM) で渡して Oracle 側を絞る
  useEffect(() => {
    if (!selectedMember || !shopId) {
      setApiRefundableItems([]);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const fromMonth = targetMonthFrom ? targetMonthFrom.replace("-", "") : "";
        const toMonth = targetMonthTo ? targetMonthTo.replace("-", "") : "";
        let url =
          `/api/store-settings/refund-payment/member-detail?memberNo=${encodeURIComponent(selectedMember.memberId)}` +
          `&clubCode=${encodeURIComponent(shopId)}`;
        if (fromMonth) url += `&fromMonth=${fromMonth}`;
        if (toMonth) url += `&toMonth=${toMonth}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json();
        if (data.ok) {
          setApiRefundableItems((data.items ?? []) as RefundableItem[]);
          // 口座情報の自動適用
          if (data.account && !selectedMember.account.bankName) {
            setAccountDraft(data.account);
          }
          // プラン名等が返ってきたら selectedMember を補完
          if (data.member?.plan && !selectedMember.plan) {
            setSelectedMember({ ...selectedMember, plan: data.member.plan });
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") console.error("member-detail fetch error", e);
      }
    })();
    return () => ctrl.abort();
  }, [selectedMember, shopId, targetMonthFrom, targetMonthTo]);

  const refundableItems = useMemo(() => {
    return apiRefundableItems.filter((it) => {
      if (targetMonthFrom && it.targetMonth && it.targetMonth < targetMonthFrom) return false;
      if (targetMonthTo && it.targetMonth && it.targetMonth > targetMonthTo) return false;
      return true;
    });
  }, [apiRefundableItems, targetMonthFrom, targetMonthTo]);

  // 会員選択時、対象月変更時に口座draftを初期化
  React.useEffect(() => {
    if (selectedMember) {
      setAccountDraft(selectedMember.account);
      setAccountOverridden(false);
      setAccountEditing(false);
    } else {
      setAccountDraft(null);
    }
  }, [selectedMember]);

  const totalAmount = useMemo(() => {
    return refundableItems
      .filter((it) => selectedItemIds.has(it.id))
      .reduce((sum, it) => sum + (adjustedAmounts[it.id] ?? it.amount), 0);
  }, [selectedItemIds, adjustedAmounts, refundableItems]);

  const isPeriodValid = () => {
    if (!targetMonthFrom || !targetMonthTo) return false;
    return targetMonthFrom <= targetMonthTo;
  };

  const isAccountValid = () => {
    if (!accountDraft) return false;
    return !!(accountDraft.bankName && accountDraft.branchName && accountDraft.accountNumber && accountDraft.holderName);
  };

  const canNext = () => {
    if (!shopId) return false;
    if (step === 1) return isPeriodValid();
    if (step === 2) return !!selectedMember;
    if (step === 3) return selectedItemIds.size > 0;
    if (step === 4) return reason.trim().length > 0 && isAccountValid() && !accountEditing;
    return false;
  };

  const reset = () => {
    setStep(1);
    setTargetMonthFrom("");
    setTargetMonthTo("");
    setSearchQuery("");
    setSelectedMember(null);
    setSelectedItemIds(new Set());
    setAdjustedAmounts({});
    setReason("");
    setAccountEditing(false);
    setAccountDraft(null);
    setAccountOverridden(false);
    setEditingApplicationId(null);
    setEditMode(null);
  };

  const handleSubmit = async () => {
    if (!selectedMember || !accountDraft) {
      return;
    }
    const items = refundableItems
      .filter((it) => selectedItemIds.has(it.id))
      .map((it) => ({ id: it.id, label: it.label, amount: adjustedAmounts[it.id] ?? it.amount }));

    setSubmitting(true);
    try {
      // 1) upsert (保存) — 新規なら applicationId を取得
      const draftSteps: ApprovalStep[] = [
        { approver: APPROVERS.applicant, state: "未対応" },
        { approver: APPROVERS.approver, state: "未対応" },
        { approver: APPROVERS.finance, state: "未対応" },
      ];
      const payload = uiToApiPayload(
        {
          id: editingApplicationId || undefined,
          targetMonthFrom,
          targetMonthTo,
          memberId: selectedMember.memberId,
          memberName: selectedMember.name,
          items,
          totalAmount,
          reason,
          status: "下書き",
          steps: draftSteps,
          account: accountDraft,
        },
        shopId,
        {
          memberId: selectedMember.memberId,
          name: selectedMember.name,
          kana: selectedMember.kana,
          phone: selectedMember.phone,
          plan: selectedMember.plan,
        }
      );
      const saveRes = await fetch("/api/store-settings/refund-payment/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.ok) throw new Error(saveData?.error || "保存に失敗しました");
      const saved: ApiApplication = saveData.application;

      // 2) submit 遷移 (下書き → 承認待ち、自分のステップを完了に)
      const transitionRes = await fetch(
        `/api/store-settings/refund-payment/applications/${encodeURIComponent(saved.applicationId)}/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit",
            comment: editMode === "resubmit" ? "差戻しから再申請しました" : (editMode === "edit" ? "編集して再送信しました" : "申請しました"),
            expectedUpdatedAt: saved.updatedAt, // 楽観ロック(直前の保存版)
          }),
        }
      );
      const transitionData = await transitionRes.json();
      if (!transitionRes.ok || !transitionData.ok) throw new Error(transitionData?.error || "申請送信に失敗しました");
      const updated: ApiApplication = transitionData.application;

      const ui = apiToUi(updated);
      setHistory((prev) => {
        const idx = prev.findIndex((h) => h.id === ui.id);
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = ui;
          return copy;
        }
        return [ui, ...prev];
      });
      setConfirmOpen(false);
      setSuccessOpen(true);
      // サーバから完全な状態を取り直し (履歴の整合)
      reloadHistory().catch((e) => console.error("post-submit reload failed", e));
    } catch (e: any) {
      alert(e?.message || "送信エラー");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleItem = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="rfa-root">
      {/* Header */}
      <header className="rfa-header">
        <div className="rfa-header-inner">
          <div className="rfa-brand">
            <Link href="/store-settings/refund-payment" className="rfa-back-link">
              <ArrowLeft size={20} />
            </Link>
            <div className="rfa-title-group">
              <h1 className="rfa-main-title">返金申請ワークフロー</h1>
              <p className="rfa-sub-title">{shopId ? `${shopId} ${shopName}` : "クラブ未選択"}</p>
            </div>
          </div>
          <div className="rfa-club-selector">
            <label>クラブ:</label>
            <ClubSearchSelect
              clubs={clubOptions}
              value={shopId}
              onChange={setShopId}
            />
          </div>
          <div className="rfa-data-badge">
            <Database size={14} />
            <span>DynamoDB 連携</span>
          </div>
        </div>
      </header>

      <main className="rfa-main">
        <div className="rfa-container">
          {/* 編集モードバナー */}
          {editingApplicationId && (
            <div className={`rfa-edit-banner ${editMode === "resubmit" ? "resubmit" : ""}`}>
              <div className="rfa-edit-banner-left">
                <span className="rfa-edit-banner-tag">
                  {editMode === "resubmit" ? "再申請モード" : "編集モード"}
                </span>
                <span className="rfa-edit-banner-id">{editingApplicationId} を編集中</span>
                {editMode === "resubmit" && (
                  <span className="rfa-edit-banner-hint">差戻し内容を反映して再申請してください</span>
                )}
              </div>
              <button className="rfa-btn ghost sm" onClick={cancelEditing}>
                <X size={14} /> 編集をやめる
              </button>
            </div>
          )}

          {/* Stepper */}
          <div className="rfa-stepper">
            {STEPS.map((s, idx) => (
              <React.Fragment key={s.id}>
                <div className={`rfa-step ${step >= s.id ? "active" : ""} ${step === s.id ? "current" : ""}`}>
                  <div className="rfa-step-circle">
                    {step > s.id ? <Check size={16} /> : s.icon}
                  </div>
                  <div className="rfa-step-label">{s.label}</div>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`rfa-step-bar ${step > s.id ? "active" : ""}`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Step Content */}
          <div className="rfa-card">
            {/* Step 1 */}
            {step === 1 && (
              <div className="rfa-step-body">
                <div className="rfa-step-head">
                  <h2>Step 1. 対象期間の選択</h2>
                  <p>返金対象となる売上の期間（開始月〜終了月）を選択してください。同月返金の場合は両方に同じ月を指定します。</p>
                </div>
                <div className="rfa-period-row">
                  <div className="rfa-form-row">
                    <label>開始月</label>
                    <input
                      type="month"
                      value={targetMonthFrom}
                      onChange={(e) => setTargetMonthFrom(e.target.value)}
                      className="rfa-input"
                    />
                  </div>
                  <div className="rfa-period-sep">〜</div>
                  <div className="rfa-form-row">
                    <label>終了月</label>
                    <input
                      type="month"
                      value={targetMonthTo}
                      onChange={(e) => setTargetMonthTo(e.target.value)}
                      className="rfa-input"
                    />
                  </div>
                </div>

                <div className="rfa-quick-pick">
                  <span className="rfa-quick-label">クイック指定:</span>
                  {[
                    { label: "今月のみ", from: "2026-05", to: "2026-05" },
                    { label: "先月のみ", from: "2026-04", to: "2026-04" },
                    { label: "直近3ヶ月", from: "2026-03", to: "2026-05" },
                    { label: "今年", from: "2026-01", to: "2026-12" },
                  ].map((q) => (
                    <button
                      key={q.label}
                      className="rfa-quick-chip"
                      onClick={() => { setTargetMonthFrom(q.from); setTargetMonthTo(q.to); }}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>

                {targetMonthFrom && targetMonthTo && targetMonthFrom > targetMonthTo && (
                  <div className="rfa-error">
                    <AlertCircle size={14} />
                    <span>開始月は終了月以前を指定してください。</span>
                  </div>
                )}

                <div className="rfa-hint">
                  <AlertCircle size={14} />
                  <span>Oracle 側で当該期間にクローズ済みの売上のみが対象となります。</span>
                </div>
              </div>
            )}

            {/* Step 2 */}
            {step === 2 && (
              <div className="rfa-step-body">
                <div className="rfa-step-head">
                  <h2>Step 2. 対象会員の検索</h2>
                  <p>会員番号・氏名（漢字/カナ）・電話番号で検索できます。</p>
                </div>
                <div className="rfa-search-bar">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="会員番号 / 氏名 / カナ / 電話番号"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {memberSearchLoading && <span className="rfa-search-status">検索中...</span>}
                </div>
                {memberSearchError && (
                  <div className="rfa-error">
                    <AlertCircle size={14} />
                    <span>検索エラー: {memberSearchError}</span>
                  </div>
                )}
                <div className="rfa-member-list">
                  {!searchQuery && (
                    <div className="rfa-empty">会員番号・氏名・カナ・電話番号で検索してください</div>
                  )}
                  {searchQuery && !memberSearchLoading && !memberSearchError && filteredMembers.length === 0 && (
                    <div className="rfa-empty">条件に一致する会員が見つかりません</div>
                  )}
                  {filteredMembers.map((m) => (
                    <button
                      key={m.memberId}
                      className={`rfa-member-row ${selectedMember?.memberId === m.memberId ? "selected" : ""}`}
                      onClick={() => setSelectedMember(m)}
                    >
                      <div className="rfa-member-id">{m.memberId}</div>
                      <div className="rfa-member-name">
                        <div>{m.name}</div>
                        <div className="rfa-member-kana">{m.kana}</div>
                      </div>
                      <div className="rfa-member-plan">{m.plan}</div>
                      <div className="rfa-member-phone">{m.phone}</div>
                      <div className="rfa-member-radio">
                        {selectedMember?.memberId === m.memberId ? <Check size={16} /> : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3 */}
            {step === 3 && selectedMember && (
              <div className="rfa-step-body">
                <div className="rfa-step-head">
                  <h2>Step 3. 返金項目の選択</h2>
                  <p>
                    {targetMonthFrom === targetMonthTo
                      ? `${targetMonthFrom} 期間に該当する`
                      : `${targetMonthFrom} 〜 ${targetMonthTo} の期間に該当する`}
                    {" "}{selectedMember.name} 様の課金項目です。返金する項目を選択し、必要であれば金額を調整します。
                  </p>
                </div>
                <div className="rfa-items">
                  {refundableItems.length === 0 && (
                    <div className="rfa-empty">
                      対象月の課金項目はありません。
                      <br />
                      <small style={{ color: "#94a3b8" }}>
                        Step 1 に戻って対象期間を広げるか、Step 2 で別の会員を選択してください。
                      </small>
                    </div>
                  )}
                  {refundableItems.map((it) => {
                    const checked = selectedItemIds.has(it.id);
                    const adjustedValue = adjustedAmounts[it.id] ?? it.amount;
                    return (
                      <div key={it.id} className={`rfa-item-row ${checked ? "checked" : ""}`}>
                        <label className="rfa-item-check">
                          <input type="checkbox" checked={checked} onChange={() => toggleItem(it.id)} />
                          <span className="rfa-item-checkbox" />
                        </label>
                        <div className="rfa-item-main">
                          <div className="rfa-item-label">{it.label}</div>
                          <div className="rfa-item-meta">
                            <span className={`rfa-item-cat cat-${it.category}`}>{it.category}</span>
                            <span>支払日: {it.paidAt}</span>
                          </div>
                        </div>
                        <div className="rfa-item-amount">
                          <span>¥</span>
                          <input
                            type="number"
                            disabled={!checked}
                            value={adjustedValue}
                            min={0}
                            max={it.amount}
                            onChange={(e) =>
                              // 0〜元額 にクランプ (手入力/貼り付けで負数・元額超過を防ぐ)
                              setAdjustedAmounts((p) => ({
                                ...p,
                                [it.id]: Math.min(it.amount, Math.max(0, Number(e.target.value) || 0)),
                              }))
                            }
                          />
                          <span className="rfa-item-amount-orig">/ ¥{it.amount.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="rfa-total">
                  <span>返金合計</span>
                  <span className="rfa-total-amount">¥ {totalAmount.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* Step 4 */}
            {step === 4 && selectedMember && (
              <div className="rfa-step-body">
                <div className="rfa-step-head">
                  <h2>Step 4. 申請内容の確認</h2>
                  <p>申請理由を入力し、内容を確認して申請してください。</p>
                </div>

                <div className="rfa-summary">
                  <div className="rfa-summary-row">
                    <span>対象期間</span>
                    <span>
                      {targetMonthFrom === targetMonthTo
                        ? targetMonthFrom
                        : `${targetMonthFrom} 〜 ${targetMonthTo}`}
                    </span>
                  </div>
                  <div className="rfa-summary-row">
                    <span>会員</span>
                    <span>
                      {selectedMember.memberId} / {selectedMember.name}（{selectedMember.plan}）
                    </span>
                  </div>
                  <div className="rfa-summary-row">
                    <span>返金項目</span>
                    <div className="rfa-summary-items">
                      {refundableItems
                        .filter((it) => selectedItemIds.has(it.id))
                        .map((it) => (
                          <div key={it.id}>
                            ・{it.label} — ¥{(adjustedAmounts[it.id] ?? it.amount).toLocaleString()}
                          </div>
                        ))}
                    </div>
                  </div>
                  <div className="rfa-summary-row total-row">
                    <span>返金合計</span>
                    <span className="rfa-total-amount">¥ {totalAmount.toLocaleString()}</span>
                  </div>
                </div>

                {/* 返金先口座情報 */}
                <div className="rfa-account-section">
                  <div className="rfa-account-head">
                    <div className="rfa-account-title">
                      <CreditCard size={16} />
                      <span>返金先口座情報</span>
                      {accountDraft?.source && !accountOverridden && (
                        <span className={`rfa-account-source ${accountDraft.source === "未登録" ? "warn" : ""}`}>
                          {accountDraft.source}
                        </span>
                      )}
                      {accountOverridden && (
                        <span className="rfa-account-source override">本申請のみ上書き</span>
                      )}
                    </div>
                    {!accountEditing && (
                      <button
                        className="rfa-btn outline sm"
                        onClick={() => setAccountEditing(true)}
                      >
                        <Edit3 size={14} />
                        {accountDraft?.source === "未登録" ? "口座を登録" : "返金先を変更"}
                      </button>
                    )}
                  </div>

                  {!accountEditing && accountDraft && (
                    accountDraft.source === "未登録" ? (
                      <div className="rfa-account-empty">
                        <AlertCircle size={16} />
                        <div>
                          <div className="rfa-account-empty-h">返金先口座が登録されていません</div>
                          <div className="rfa-account-empty-p">「口座を登録」から本申請の返金先を入力してください。</div>
                        </div>
                      </div>
                    ) : (
                      <div className="rfa-account-view">
                        <div className="rfa-account-cell">
                          <div className="rfa-account-label">金融機関</div>
                          <div className="rfa-account-value">{accountDraft.bankName}</div>
                        </div>
                        <div className="rfa-account-cell">
                          <div className="rfa-account-label">支店</div>
                          <div className="rfa-account-value">{accountDraft.branchName}</div>
                        </div>
                        <div className="rfa-account-cell">
                          <div className="rfa-account-label">種別</div>
                          <div className="rfa-account-value">{accountDraft.accountType}</div>
                        </div>
                        <div className="rfa-account-cell">
                          <div className="rfa-account-label">口座番号</div>
                          <div className="rfa-account-value mono">{accountDraft.accountNumber}</div>
                        </div>
                        <div className="rfa-account-cell wide">
                          <div className="rfa-account-label">名義人（カナ）</div>
                          <div className="rfa-account-value">{accountDraft.holderName}</div>
                        </div>
                      </div>
                    )
                  )}

                  {accountEditing && accountDraft && (
                    <div className="rfa-account-edit">
                      <div className="rfa-bankcode-badge">
                        <Database size={12} />
                        <span>BankCode JP API 連携</span>
                      </div>
                      <div className="rfa-account-grid">
                        <div className="rfa-form-row">
                          <label>金融機関 <span className="rfa-required">*</span></label>
                          <BankcodeAutocomplete
                            kind="bank"
                            value={accountDraft.bankName}
                            code={accountDraft.bankCode}
                            onChangeText={(v) =>
                              setAccountDraft({ ...accountDraft, bankName: v, bankCode: undefined, branchName: "", branchCode: undefined })
                            }
                            onPick={(it) =>
                              setAccountDraft({ ...accountDraft, bankName: it.name, bankCode: it.code, branchName: "", branchCode: undefined })
                            }
                            placeholder="銀行名を入力（例: みずほ）"
                          />
                        </div>
                        <div className="rfa-form-row">
                          <label>支店名 <span className="rfa-required">*</span></label>
                          <BankcodeAutocomplete
                            kind="branch"
                            bankCode={accountDraft.bankCode}
                            value={accountDraft.branchName}
                            code={accountDraft.branchCode}
                            onChangeText={(v) =>
                              setAccountDraft({ ...accountDraft, branchName: v, branchCode: undefined })
                            }
                            onPick={(it) =>
                              setAccountDraft({ ...accountDraft, branchName: it.name, branchCode: it.code })
                            }
                            placeholder={accountDraft.bankCode ? "支店名を入力（例: 旭川）" : "先に金融機関を選択"}
                          />
                        </div>
                        <div className="rfa-form-row">
                          <label>預金種別 <span className="rfa-required">*</span></label>
                          <select
                            className="rfa-input"
                            value={accountDraft.accountType}
                            onChange={(e) => setAccountDraft({ ...accountDraft, accountType: e.target.value as "普通" | "当座" })}
                          >
                            <option value="普通">普通</option>
                            <option value="当座">当座</option>
                          </select>
                        </div>
                        <div className="rfa-form-row">
                          <label>口座番号 <span className="rfa-required">*</span></label>
                          <input
                            className="rfa-input"
                            value={accountDraft.accountNumber}
                            onChange={(e) => setAccountDraft({ ...accountDraft, accountNumber: e.target.value.replace(/[^0-9]/g, "") })}
                            placeholder="7桁"
                            inputMode="numeric"
                          />
                        </div>
                        <div className="rfa-form-row full">
                          <label>名義人（カナ） <span className="rfa-required">*</span></label>
                          <input
                            className="rfa-input"
                            value={accountDraft.holderName}
                            onChange={(e) => setAccountDraft({ ...accountDraft, holderName: e.target.value.toUpperCase() })}
                            placeholder="ヤマダ タロウ"
                          />
                        </div>
                      </div>
                      <div className="rfa-account-edit-actions">
                        <button
                          className="rfa-btn ghost sm"
                          onClick={() => {
                            if (selectedMember) {
                              setAccountDraft(selectedMember.account);
                              setAccountOverridden(false);
                            }
                            setAccountEditing(false);
                          }}
                        >
                          キャンセル
                        </button>
                        {selectedMember && accountDraft.source !== "未登録" && (
                          <button
                            className="rfa-btn outline sm"
                            onClick={() => {
                              setAccountDraft(selectedMember.account);
                              setAccountOverridden(false);
                            }}
                          >
                            <RefreshCw size={14} />
                            登録口座に戻す
                          </button>
                        )}
                        <button
                          className="rfa-btn primary sm"
                          disabled={!isAccountValid()}
                          onClick={() => {
                            setAccountEditing(false);
                            const orig = selectedMember?.account;
                            const changed =
                              !!orig &&
                              (orig.bankName !== accountDraft.bankName ||
                                orig.branchName !== accountDraft.branchName ||
                                orig.accountType !== accountDraft.accountType ||
                                orig.accountNumber !== accountDraft.accountNumber ||
                                orig.holderName !== accountDraft.holderName);
                            setAccountOverridden(changed);
                          }}
                        >
                          <Check size={14} />
                          確定
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rfa-form-row">
                  <label>申請理由 <span className="rfa-required">*</span></label>
                  <textarea
                    className="rfa-input"
                    rows={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="例) 設備停止に伴う返金、解約日の登録漏れ、重複徴収 など"
                  />
                </div>

                {/* 申請先 */}
                <div className="rfa-approval-section">
                  <div className="rfa-approval-head">
                    <div className="rfa-approval-title">
                      <Send size={16} />
                      <span>申請先（承認フロー）</span>
                    </div>
                    <span className="rfa-approval-rule">固定3段階フロー</span>
                  </div>
                  <div className="rfa-approval-flow">
                    {APPROVAL_FLOW.map((a, idx) => (
                      <React.Fragment key={a.role}>
                        {idx > 0 && (
                          <div className="rfa-approval-arrow">
                            <ChevronRight size={18} />
                            <span>Step {idx}</span>
                          </div>
                        )}
                        <div className={`rfa-approval-node ${idx === 0 ? "applicant" : ""}`}>
                          <div className="rfa-approval-role">{a.role}</div>
                          <div className="rfa-approval-name">{a.name}</div>
                          <div className="rfa-approval-dept">{a.dept}</div>
                          <div className="rfa-approval-email">{a.email}</div>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="rfa-approval-note">
                    <AlertCircle size={14} />
                    <span>
                      申請後は <strong>{APPROVERS.approver.name}</strong>（{APPROVERS.approver.role}）へ通知メールが送信されます。承認後に <strong>{APPROVERS.finance.role}</strong> へ回付され、最終承認で Oracle 側へ返金データが連携されます。
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="rfa-actions">
            <button
              className="rfa-btn ghost"
              onClick={() => (step === 1 ? null : setStep(step - 1))}
              disabled={step === 1}
            >
              戻る
            </button>
            <div className="rfa-action-right">
              <button className="rfa-btn outline" onClick={reset}>クリア</button>
              {step < 4 && (
                <button
                  className="rfa-btn primary"
                  disabled={!canNext()}
                  onClick={() => setStep(step + 1)}
                >
                  次へ <ArrowRight size={16} />
                </button>
              )}
              {step === 4 && (
                <button
                  className="rfa-btn primary"
                  disabled={!canNext() || submitting}
                  onClick={() => setConfirmOpen(true)}
                >
                  {submitting ? "送信中..." : "内容を確認して申請"} <Check size={16} />
                </button>
              )}
            </div>
          </div>

          {/* 申請履歴 */}
          <section className="rfa-history">
            <div className="rfa-history-head">
              <h2><FileText size={18} /> 申請履歴</h2>
              <span className="rfa-history-meta">{filteredHistory.length} 件表示 / 全 {history.length} 件</span>
            </div>

            <div className="rfa-history-controls">
              <div className="rfa-search-bar">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="申請ID / 会員番号 / 氏名 / 理由 / 項目で検索"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                />
                {historySearch && (
                  <button className="rfa-search-clear" onClick={() => setHistorySearch("")}>
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="rfa-status-tabs">
                {(["all", "下書き", "承認待ち", "承認済み", "差戻し"] as const).map((s) => (
                  <button
                    key={s}
                    className={`rfa-status-tab ${historyStatus === s ? "active" : ""}`}
                    onClick={() => setHistoryStatus(s)}
                  >
                    {s === "all" ? "すべて" : s}
                    <span className="rfa-status-tab-count">{historyCounts[s] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rfa-history-list">
              {filteredHistory.length === 0 && (
                <div className="rfa-empty" style={{ background: "#fff", border: "1px dashed #e2e8f0", borderRadius: 12 }}>
                  条件に合致する申請がありません
                </div>
              )}
              {filteredHistory.map((h) => (
                <HistoryCard
                  key={h.id}
                  app={h}
                  expanded={expandedHistory === h.id}
                  onToggle={() => setExpandedHistory(expandedHistory === h.id ? null : h.id)}
                  onEdit={() => openEditModal(h)}
                  onResubmit={() => loadApplicationIntoWizard(h, "resubmit")}
                  onDelete={() => openDeleteModal(h)}
                />
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* 編集は独立ダイアログに切り出し */}
      <RefundEditDialog
        app={editTargetApp}
        saving={editSaving}
        onClose={closeEditModal}
        onSave={saveEdit}
      />

      {/* 削除モーダル */}
      {deleteTargetApp && (
        <div className="rfa-modal-bg" onClick={() => !deletingNow && closeDeleteModal()}>
          <div className="rfa-delete-modal" onClick={(e) => e.stopPropagation()}>
            <button className="rfa-modal-close" onClick={closeDeleteModal} disabled={deletingNow}>
              <X size={18} />
            </button>
            <div className="rfa-delete-icon"><AlertCircle size={28} /></div>
            <h3>この申請を削除しますか？</h3>
            <p>
              <span className="mono">{deleteTargetApp.id}</span> / {deleteTargetApp.memberName}
              <br />¥{deleteTargetApp.totalAmount.toLocaleString()} / {deleteTargetApp.status}
            </p>
            <p className="rfa-delete-note">削除後は復元できません。承認担当者にも通知済みの場合は、削除前に取り消しの旨を共有してください。</p>
            <div className="rfa-edit-modal-footer">
              <button className="rfa-btn ghost" onClick={closeDeleteModal} disabled={deletingNow}>キャンセル</button>
              <button className="rfa-btn danger" onClick={confirmDelete} disabled={deletingNow}>
                {deletingNow ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {confirmOpen && selectedMember && accountDraft && (
        <div className="rfa-modal-bg" onClick={() => !submitting && setConfirmOpen(false)}>
          <div className="rfa-modal rfa-confirm" onClick={(e) => e.stopPropagation()}>
            <button className="rfa-modal-close" disabled={submitting} onClick={() => setConfirmOpen(false)}>
              <X size={18} />
            </button>
            <div className="rfa-modal-icon"><Check size={32} /></div>
            <h3>この内容で申請します</h3>
            <p>送信後は承認担当者へ通知されます。内容に誤りがないかご確認ください。</p>
            <div className="rfa-confirm-body">
              <div className="rfa-confirm-row">
                <span className="rfa-confirm-key">会員</span>
                <span className="rfa-confirm-val">{selectedMember.memberId} / {selectedMember.name}（{selectedMember.plan}）</span>
              </div>
              <div className="rfa-confirm-row">
                <span className="rfa-confirm-key">対象期間</span>
                <span className="rfa-confirm-val">{targetMonthFrom} 〜 {targetMonthTo}</span>
              </div>
              <div className="rfa-confirm-row">
                <span className="rfa-confirm-key">返金項目</span>
                <span className="rfa-confirm-val">
                  {refundableItems.filter((it) => selectedItemIds.has(it.id)).map((it) => (
                    <span key={it.id} className="rfa-confirm-item">
                      ・{it.label} — ¥{(adjustedAmounts[it.id] ?? it.amount).toLocaleString()}
                    </span>
                  ))}
                </span>
              </div>
              <div className="rfa-confirm-row rfa-confirm-total">
                <span className="rfa-confirm-key">返金合計</span>
                <span className="rfa-confirm-val">¥ {totalAmount.toLocaleString()}</span>
              </div>
              <div className="rfa-confirm-row">
                <span className="rfa-confirm-key">振込先</span>
                <span className="rfa-confirm-val">
                  {accountDraft.bankName} {accountDraft.branchName} / {accountDraft.accountType} {accountDraft.accountNumber}
                  <br />{accountDraft.holderName}
                </span>
              </div>
              <div className="rfa-confirm-row">
                <span className="rfa-confirm-key">申請理由</span>
                <span className="rfa-confirm-val">{reason}</span>
              </div>
            </div>
            <div className="rfa-confirm-actions">
              <button className="rfa-btn" disabled={submitting} onClick={() => setConfirmOpen(false)}>
                戻る
              </button>
              <button className="rfa-btn primary" disabled={submitting} onClick={handleSubmit}>
                {submitting ? "送信中..." : "この内容で申請する"} <Check size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {successOpen && (
        <div className="rfa-modal-bg" onClick={() => { setSuccessOpen(false); reset(); }}>
          <div className="rfa-modal" onClick={(e) => e.stopPropagation()}>
            <button className="rfa-modal-close" onClick={() => { setSuccessOpen(false); reset(); }}>
              <X size={18} />
            </button>
            <div className="rfa-modal-icon"><Check size={32} /></div>
            <h3>
              {editMode === "resubmit"
                ? "再申請を送信しました"
                : editMode === "edit"
                ? "申請を更新しました"
                : "申請を作成しました"}
            </h3>
            <p>
              {editMode === "resubmit"
                ? "差戻し内容を反映して再申請しました。承認者へ通知されます。"
                : "承認担当者へ通知され、承認後に Oracle 側へ反映されます。"}
            </p>
            <button className="rfa-btn primary" onClick={() => { setSuccessOpen(false); reset(); }}>
              履歴を確認する
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        .rfa-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .rfa-header { background: #fff; height: 72px; border-bottom: 2px solid #0ea5e9; position: sticky; top: 0; z-index: 50; }
        .rfa-header-inner { max-width: 1240px; margin: 0 auto; height: 100%; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
        .rfa-brand { display: flex; align-items: center; gap: 20px; }
        .rfa-back-link { color: #94a3b8; display: flex; }
        .rfa-back-link:hover { color: #0ea5e9; }
        .rfa-title-group { line-height: 1.2; }
        .rfa-main-title { font-size: 18px; font-weight: 800; margin: 0; color: #1e293b; }
        .rfa-sub-title { font-size: 13px; color: #64748b; font-weight: 600; margin: 0; }
        .rfa-data-badge { display: flex; align-items: center; gap: 6px; background: #f0f9ff; color: #0369a1; padding: 6px 12px; border-radius: 20px; border: 1px solid #bae6fd; font-size: 11px; font-weight: 700; }
        .rfa-club-selector { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #475569; font-weight: 600; }
        .rfa-club-select { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; font-weight: 600; color: #0f172a; background: #fff; min-width: 200px; }
        .rfa-club-select:focus { outline: none; border-color: #0ea5e9; }

        /* Club search select */
        .rfa-club-search { position: relative; min-width: 240px; }
        .rfa-club-search-trigger { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font-size: 12px; font-weight: 600; color: #0f172a; cursor: pointer; text-align: left; }
        .rfa-club-search-trigger:hover { border-color: #94a3b8; }
        .rfa-club-search-placeholder { color: #94a3b8; }
        .rfa-club-search-caret { color: #94a3b8; font-size: 10px; }
        .rfa-club-search-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 24px rgba(15,23,42,0.12); z-index: 200; overflow: hidden; }
        .rfa-club-search-input-wrap { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #f1f5f9; color: #94a3b8; }
        .rfa-club-search-input { flex: 1; border: none; outline: none; font-size: 12px; background: transparent; color: #0f172a; }
        .rfa-club-search-clear { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 12px; padding: 0 2px; }
        .rfa-club-search-clear:hover { color: #64748b; }
        .rfa-club-search-list { max-height: 280px; overflow-y: auto; }
        .rfa-club-search-empty { padding: 16px 12px; font-size: 12px; color: #94a3b8; text-align: center; }
        .rfa-club-search-item { width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: none; background: none; cursor: pointer; text-align: left; font-size: 12px; }
        .rfa-club-search-item:hover { background: #f1f5f9; }
        .rfa-club-search-item.selected { background: #eff6ff; color: #2563eb; font-weight: 700; }
        .rfa-club-search-code { font-family: "SF Mono", Menlo, monospace; color: #64748b; min-width: 50px; }
        .rfa-club-search-item.selected .rfa-club-search-code { color: #2563eb; }
        .rfa-club-search-name { color: #334155; flex: 1; }
        .rfa-club-search-item.selected .rfa-club-search-name { color: #2563eb; }
        .rfa-club-search-footer { font-size: 10px; color: #94a3b8; padding: 6px 12px; background: #f8fafc; border-top: 1px solid #f1f5f9; text-align: right; }

        .rfa-container { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }

        /* Stepper */
        .rfa-stepper { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
        .rfa-step { display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; }
        .rfa-step-circle { width: 36px; height: 36px; border-radius: 50%; background: #fff; border: 2px solid #e2e8f0; display: flex; align-items: center; justify-content: center; color: #94a3b8; transition: 0.2s; }
        .rfa-step.active .rfa-step-circle { background: #0ea5e9; border-color: #0ea5e9; color: #fff; }
        .rfa-step.current .rfa-step-circle { box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.2); }
        .rfa-step-label { font-size: 11px; font-weight: 700; color: #94a3b8; }
        .rfa-step.active .rfa-step-label { color: #0ea5e9; }
        .rfa-step-bar { flex: 1; height: 2px; background: #e2e8f0; margin: 0 4px; margin-bottom: 22px; }
        .rfa-step-bar.active { background: #0ea5e9; }

        /* Card */
        .rfa-card { background: #fff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; }
        .rfa-step-body { display: flex; flex-direction: column; gap: 20px; }
        .rfa-step-head h2 { font-size: 20px; font-weight: 800; margin: 0 0 6px 0; }
        .rfa-step-head p { font-size: 13px; color: #64748b; margin: 0; }

        /* Form */
        .rfa-form-row { display: flex; flex-direction: column; gap: 8px; }
        .rfa-form-row label { font-size: 13px; font-weight: 700; color: #475569; }
        .rfa-required { color: #ef4444; }
        .rfa-input { width: 100%; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; background: #fff; }
        .rfa-input:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15); }
        textarea.rfa-input { resize: vertical; font-family: inherit; }
        .rfa-hint { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; border-radius: 10px; font-size: 12px; font-weight: 600; }
        .rfa-error { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 10px; font-size: 12px; font-weight: 700; }

        /* Period */
        .rfa-period-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 14px; align-items: end; }
        .rfa-period-sep { padding-bottom: 12px; font-size: 16px; font-weight: 700; color: #94a3b8; text-align: center; }
        .rfa-quick-pick { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .rfa-quick-label { font-size: 12px; font-weight: 700; color: #64748b; }
        .rfa-quick-chip { padding: 6px 12px; border-radius: 20px; border: 1px solid #cbd5e1; background: #fff; font-size: 12px; font-weight: 600; color: #475569; cursor: pointer; transition: 0.15s; }
        .rfa-quick-chip:hover { border-color: #0ea5e9; color: #0ea5e9; background: #f0f9ff; }

        /* Account */
        .rfa-account-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
        .rfa-account-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .rfa-account-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; color: #1e293b; }
        .rfa-account-title svg { color: #0ea5e9; }
        .rfa-account-source { font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 12px; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
        .rfa-account-source.warn { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
        .rfa-account-source.override { background: #fef3c7; color: #b45309; border-color: #fde68a; }
        .rfa-account-view { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 20px; padding: 16px 20px; background: #f8fafc; border-radius: 10px; }
        .rfa-account-cell.wide { grid-column: span 2; }
        .rfa-account-label { font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px; }
        .rfa-account-value { font-size: 13px; font-weight: 700; color: #0f172a; }
        .rfa-account-value.mono { font-family: 'SF Mono', Menlo, monospace; letter-spacing: 0.05em; }
        .rfa-account-empty { display: flex; gap: 12px; padding: 16px 20px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; color: #b91c1c; align-items: center; }
        .rfa-account-empty-h { font-size: 13px; font-weight: 800; }
        .rfa-account-empty-p { font-size: 12px; font-weight: 600; margin-top: 2px; }
        .rfa-account-edit { padding: 16px 0 0; border-top: 1px dashed #e2e8f0; }
        .rfa-account-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
        .rfa-account-grid .rfa-form-row.full { grid-column: span 2; }
        .rfa-account-edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
        .rfa-btn.sm { padding: 6px 12px; font-size: 12px; }
        .rfa-bankcode-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; border-radius: 12px; font-size: 11px; font-weight: 700; margin-bottom: 12px; width: fit-content; }

        /* Bankcode autocomplete */
        .rfa-ac { position: relative; }
        .rfa-ac-input-wrap { position: relative; }
        .rfa-ac-code { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: #0369a1; background: #e0f2fe; padding: 2px 8px; border-radius: 6px; pointer-events: none; }
        .rfa-ac-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(0,0,0,0.12); max-height: 260px; overflow-y: auto; z-index: 30; }
        .rfa-ac-msg { padding: 12px 14px; font-size: 12px; color: #94a3b8; text-align: center; font-weight: 600; }
        .rfa-ac-msg.error { color: #b91c1c; background: #fef2f2; }
        .rfa-ac-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; background: #fff; border: none; border-bottom: 1px solid #f1f5f9; width: 100%; text-align: left; cursor: pointer; transition: 0.1s; }
        .rfa-ac-item:hover { background: #f0f9ff; }
        .rfa-ac-item:last-of-type { border-bottom: none; }
        .rfa-ac-item-name { font-size: 13px; font-weight: 700; color: #0f172a; }
        .rfa-ac-item-meta { display: flex; gap: 8px; align-items: center; font-size: 11px; color: #94a3b8; font-weight: 600; }
        .rfa-ac-item-code { font-family: 'SF Mono', Menlo, monospace; background: #e2e8f0; color: #475569; padding: 2px 6px; border-radius: 4px; }
        .rfa-ac-footer { padding: 6px 14px; font-size: 10px; color: #94a3b8; font-weight: 600; background: #f8fafc; border-top: 1px solid #f1f5f9; text-align: right; }

        /* Approval flow */
        .rfa-approval-section { background: linear-gradient(180deg, #f0f9ff 0%, #fff 100%); border: 1px solid #bae6fd; border-radius: 12px; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
        .rfa-approval-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
        .rfa-approval-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; color: #0369a1; }
        .rfa-approval-rule { font-size: 11px; font-weight: 800; color: #0369a1; background: #fff; border: 1px solid #bae6fd; padding: 4px 10px; border-radius: 20px; }
        .rfa-approval-flow { display: flex; align-items: stretch; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
        .rfa-approval-node { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; min-width: 180px; flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .rfa-approval-node.applicant { background: #f1f5f9; border-style: dashed; }
        .rfa-approval-role { font-size: 10px; font-weight: 800; color: #0ea5e9; text-transform: uppercase; letter-spacing: 0.05em; }
        .rfa-approval-node.applicant .rfa-approval-role { color: #64748b; }
        .rfa-approval-name { font-size: 14px; font-weight: 800; color: #0f172a; }
        .rfa-approval-dept { font-size: 11px; font-weight: 600; color: #64748b; }
        .rfa-approval-email { font-size: 11px; color: #94a3b8; font-family: 'SF Mono', Menlo, monospace; margin-top: 4px; }
        .rfa-approval-arrow { display: flex; flex-direction: column; align-items: center; justify-content: center; color: #0ea5e9; gap: 2px; padding: 0 4px; }
        .rfa-approval-arrow span { font-size: 9px; font-weight: 800; color: #0ea5e9; letter-spacing: 0.05em; }
        .rfa-approval-note { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #fff; border: 1px solid #bae6fd; border-radius: 10px; font-size: 12px; color: #0c4a6e; font-weight: 600; }
        .rfa-approval-note strong { color: #0369a1; font-weight: 800; }

        /* Search & member list */
        .rfa-search-bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #94a3b8; }
        .rfa-search-bar:focus-within { border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15); }
        .rfa-search-bar input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; }
        .rfa-member-list { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; border: 1px solid #f1f5f9; border-radius: 10px; }
        .rfa-member-row { display: grid; grid-template-columns: 120px 1fr 120px 140px 32px; align-items: center; gap: 16px; padding: 14px 18px; background: #fff; border: none; border-bottom: 1px solid #f1f5f9; cursor: pointer; text-align: left; transition: 0.15s; }
        .rfa-member-row:hover { background: #f8fafc; }
        .rfa-member-row.selected { background: #f0f9ff; }
        .rfa-member-id { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; font-weight: 700; color: #475569; }
        .rfa-member-name { font-size: 14px; font-weight: 700; color: #0f172a; }
        .rfa-member-kana { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .rfa-member-plan { font-size: 11px; padding: 4px 8px; background: #e0f2fe; color: #0369a1; border-radius: 6px; font-weight: 700; text-align: center; }
        .rfa-member-phone { font-size: 12px; color: #64748b; font-family: 'SF Mono', Menlo, monospace; }
        .rfa-member-radio { color: #0ea5e9; display: flex; justify-content: center; }
        .rfa-empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; }

        /* Items */
        .rfa-items { display: flex; flex-direction: column; gap: 8px; }
        .rfa-item-row { display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: 16px; padding: 16px 20px; background: #fafbfc; border: 1px solid #e2e8f0; border-radius: 12px; transition: 0.15s; }
        .rfa-item-row.checked { background: #f0f9ff; border-color: #bae6fd; }
        .rfa-item-check { display: flex; cursor: pointer; }
        .rfa-item-check input { display: none; }
        .rfa-item-checkbox { width: 20px; height: 20px; border: 2px solid #cbd5e1; border-radius: 6px; display: inline-block; position: relative; transition: 0.15s; }
        .rfa-item-row.checked .rfa-item-checkbox { background: #0ea5e9; border-color: #0ea5e9; }
        .rfa-item-row.checked .rfa-item-checkbox::after { content: ""; position: absolute; left: 5px; top: 1px; width: 6px; height: 11px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
        .rfa-item-label { font-size: 14px; font-weight: 700; color: #0f172a; }
        .rfa-item-meta { font-size: 11px; color: #94a3b8; font-weight: 600; display: flex; gap: 12px; margin-top: 4px; align-items: center; }
        .rfa-item-cat { padding: 2px 8px; border-radius: 4px; background: #e2e8f0; color: #475569; }
        .rfa-item-cat.cat-月会費 { background: #dbeafe; color: #1d4ed8; }
        .rfa-item-cat.cat-オプション { background: #fce7f3; color: #be185d; }
        .rfa-item-cat.cat-事務手数料 { background: #fef3c7; color: #b45309; }
        .rfa-item-cat.cat-1Day { background: #d1fae5; color: #047857; }
        .rfa-item-amount { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; }
        .rfa-item-amount input { width: 100px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; text-align: right; font-size: 14px; font-weight: 700; }
        .rfa-item-amount input:disabled { background: #f1f5f9; color: #94a3b8; }
        .rfa-item-amount-orig { font-size: 11px; color: #94a3b8; font-weight: 600; }

        .rfa-total { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; background: #0f172a; color: #fff; border-radius: 12px; font-size: 14px; font-weight: 700; }
        .rfa-total-amount { font-size: 22px; font-weight: 900; color: #38bdf8; }

        /* Summary */
        .rfa-summary { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
        .rfa-summary-row { display: grid; grid-template-columns: 120px 1fr; gap: 16px; font-size: 13px; align-items: start; }
        .rfa-summary-row > span:first-child { color: #94a3b8; font-weight: 700; }
        .rfa-summary-row > span:last-child, .rfa-summary-items { color: #0f172a; font-weight: 600; }
        .rfa-summary-items { display: flex; flex-direction: column; gap: 4px; }
        .rfa-summary-row.total-row { padding-top: 14px; border-top: 1px solid #e2e8f0; align-items: center; }

        /* Actions */
        .rfa-actions { margin-top: 20px; display: flex; justify-content: space-between; }
        .rfa-action-right { display: flex; gap: 10px; }
        .rfa-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 800; cursor: pointer; transition: 0.15s; border: none; }
        .rfa-btn.primary { background: #0ea5e9; color: #fff; }
        .rfa-btn.primary:hover:not(:disabled) { background: #0284c7; }
        .rfa-btn.primary:disabled { background: #cbd5e1; cursor: not-allowed; }
        .rfa-btn.outline { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
        .rfa-btn.outline:hover { background: #f8fafc; }
        .rfa-btn.ghost { background: transparent; color: #94a3b8; }
        .rfa-btn.ghost:hover:not(:disabled) { color: #475569; }
        .rfa-btn.ghost:disabled { opacity: 0.4; cursor: not-allowed; }
        .rfa-btn.danger { background: #ef4444; color: #fff; }
        .rfa-btn.danger:hover:not(:disabled) { background: #dc2626; }
        .rfa-btn.danger:disabled { background: #fca5a5; cursor: not-allowed; }

        /* Edit / Delete modals */
        .rfa-edit-modal { background: #fff; border-radius: 18px; max-width: 560px; width: 92vw; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 24px 48px rgba(15,23,42,0.18); position: relative; overflow: hidden; }
        .rfa-edit-modal-head { padding: 20px 24px 16px; border-bottom: 1px solid #f1f5f9; }
        .rfa-edit-modal-head h3 { margin: 0; font-size: 17px; font-weight: 800; color: #0f172a; }
        .rfa-edit-modal-head p { margin: 6px 0 0; font-size: 12px; color: #64748b; }
        .rfa-edit-modal-head .mono { font-family: 'SF Mono', Menlo, monospace; color: #475569; }
        .rfa-edit-modal-body { padding: 18px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 18px; }
        .rfa-edit-field { display: flex; flex-direction: column; gap: 6px; }
        .rfa-edit-field label { font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
        .rfa-edit-field textarea { resize: vertical; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; font-size: 13px; font-family: inherit; outline: none; }
        .rfa-edit-field textarea:focus { border-color: #0ea5e9; }
        .rfa-edit-items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .rfa-edit-items li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
        .rfa-edit-item-label { font-size: 13px; font-weight: 600; color: #0f172a; flex: 1; }
        .rfa-edit-item-amount { display: flex; align-items: center; gap: 4px; font-weight: 800; color: #0369a1; }
        .rfa-edit-item-amount input { width: 110px; padding: 6px 8px; border: 1.5px solid #cbd5e1; border-radius: 6px; font-size: 13px; text-align: right; outline: none; font-family: 'SF Mono', Menlo, monospace; }
        .rfa-edit-item-amount input:focus { border-color: #0ea5e9; }
        .rfa-edit-empty { padding: 12px; background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 8px; font-size: 12px; color: #94a3b8; text-align: center; }
        .rfa-edit-total { text-align: right; font-size: 12px; color: #64748b; padding-top: 4px; border-top: 1px dashed #e2e8f0; }
        .rfa-edit-total strong { font-size: 14px; color: #0369a1; margin-left: 6px; }
        .rfa-edit-modal-footer { padding: 14px 20px; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 10px; background: #fafbfc; }

        .rfa-delete-modal { background: #fff; border-radius: 18px; max-width: 420px; width: 92vw; padding: 24px 24px 0; position: relative; box-shadow: 0 24px 48px rgba(15,23,42,0.18); text-align: center; }
        .rfa-delete-modal h3 { margin: 8px 0 6px; font-size: 17px; font-weight: 800; color: #0f172a; }
        .rfa-delete-modal p { font-size: 13px; color: #475569; margin: 0; line-height: 1.7; }
        .rfa-delete-modal p.rfa-delete-note { margin-top: 12px; font-size: 12px; color: #94a3b8; }
        .rfa-delete-modal .mono { font-family: 'SF Mono', Menlo, monospace; color: #475569; font-weight: 700; }
        .rfa-delete-icon { width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 50%; background: #fee2e2; color: #b91c1c; display: flex; align-items: center; justify-content: center; }
        .rfa-delete-modal .rfa-edit-modal-footer { margin: 18px -24px 0; }

        /* History */
        .rfa-history { margin-top: 48px; }
        .rfa-history-head { display: flex; justify-content: space-between; align-items: end; margin-bottom: 12px; }
        .rfa-history-head h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800; margin: 0; color: #1e293b; }
        .rfa-history-meta { font-size: 11px; color: #94a3b8; font-weight: 600; }
        .rfa-history-list { display: flex; flex-direction: column; gap: 10px; }
        .rfa-history-sub { font-size: 11px; color: #94a3b8; font-weight: 500; font-family: 'SF Mono', Menlo, monospace; }

        /* History controls */
        .rfa-history-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
        .rfa-history-controls .rfa-search-bar { flex: 1; min-width: 280px; }
        .rfa-search-clear { background: none; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center; }
        .rfa-search-clear:hover { color: #ef4444; }
        .rfa-status-tabs { display: flex; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 10px; }
        .rfa-status-tab { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border: none; background: transparent; border-radius: 7px; font-size: 12px; font-weight: 700; color: #64748b; cursor: pointer; transition: 0.15s; }
        .rfa-status-tab:hover { color: #0ea5e9; }
        .rfa-status-tab.active { background: #fff; color: #0ea5e9; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        .rfa-status-tab-count { background: #e2e8f0; color: #64748b; font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 8px; }
        .rfa-status-tab.active .rfa-status-tab-count { background: #e0f2fe; color: #0369a1; }

        /* Edit mode banner */
        .rfa-edit-banner { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 20px; background: linear-gradient(90deg, #fef3c7 0%, #fff 100%); border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 10px; margin-bottom: 20px; }
        .rfa-edit-banner.resubmit { background: linear-gradient(90deg, #fee2e2 0%, #fff 100%); border-color: #fecaca; border-left-color: #ef4444; }
        .rfa-edit-banner-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .rfa-edit-banner-tag { font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 20px; background: #f59e0b; color: #fff; }
        .rfa-edit-banner.resubmit .rfa-edit-banner-tag { background: #ef4444; }
        .rfa-edit-banner-id { font-size: 13px; font-weight: 800; color: #1e293b; font-family: 'SF Mono', Menlo, monospace; }
        .rfa-edit-banner-hint { font-size: 12px; color: #b91c1c; font-weight: 600; }
        .rfa-status-chip { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; }

        /* Modal */
        .rfa-modal-bg { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .rfa-modal { background: #fff; border-radius: 16px; padding: 32px; max-width: 420px; width: 90%; position: relative; text-align: center; }
        .rfa-modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #94a3b8; cursor: pointer; }
        .rfa-modal-icon { width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 50%; background: #d1fae5; color: #059669; display: flex; align-items: center; justify-content: center; }
        .rfa-modal h3 { font-size: 18px; font-weight: 800; margin: 0 0 8px 0; }
        .rfa-modal p { font-size: 13px; color: #64748b; margin: 0 0 20px 0; }
        /* Confirm modal */
        .rfa-modal.rfa-confirm { max-width: 480px; text-align: left; }
        .rfa-modal.rfa-confirm .rfa-modal-icon { margin-left: auto; margin-right: auto; }
        .rfa-modal.rfa-confirm h3, .rfa-modal.rfa-confirm > p { text-align: center; }
        .rfa-confirm-body { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
        .rfa-confirm-row { display: flex; gap: 12px; font-size: 13px; }
        .rfa-confirm-key { flex: 0 0 76px; color: #64748b; font-weight: 700; }
        .rfa-confirm-val { flex: 1; color: #0f172a; font-weight: 600; display: flex; flex-direction: column; gap: 2px; }
        .rfa-confirm-item { display: block; }
        .rfa-confirm-total .rfa-confirm-val { color: #0369a1; font-weight: 800; font-size: 15px; }
        .rfa-confirm-total { border-top: 1px dashed #cbd5e1; padding-top: 10px; }
        .rfa-confirm-actions { display: flex; gap: 12px; }
        .rfa-confirm-actions .rfa-btn { flex: 1; justify-content: center; }
      `}</style>
    </div>
  );
}

// ---- 履歴カード ----
const STEP_STATE_COLOR: Record<StepState, string> = {
  完了: "#10b981",
  対応中: "#f59e0b",
  未対応: "#cbd5e1",
  差戻し: "#ef4444",
};

function HistoryCard({
  app,
  expanded,
  onToggle,
  onEdit,
  onResubmit,
  onDelete,
}: {
  app: RefundApplication;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onResubmit: () => void;
  onDelete: () => void;
}) {
  const overallColor = STATUS_COLOR[app.status];
  const isReturned = app.status === "差戻し";
  const isDraft = app.status === "下書き";
  const isPending = app.status === "承認待ち";
  const isApproved = app.status === "承認済み";
  const returnComment = app.steps.find((s) => s.state === "差戻し")?.comment;

  return (
    <div className={`rfa-h-card ${expanded ? "open" : ""}`}>
      <button className="rfa-h-card-summary" onClick={onToggle}>
        <div className="rfa-h-summary-left">
          <span className="rfa-h-id mono">
            {app.id}
            {app.id.startsWith("DEMO-") && <span className="rfa-h-demo-badge">DEMO</span>}
          </span>
          <div className="rfa-h-meta">
            <span>{app.targetMonthFrom === app.targetMonthTo ? app.targetMonthFrom : `${app.targetMonthFrom}〜${app.targetMonthTo}`}</span>
            <span>•</span>
            <span>{app.memberName}</span>
            <span className="rfa-history-sub">{app.memberId}</span>
            <span>•</span>
            <span className="rfa-h-amount">¥{app.totalAmount.toLocaleString()}</span>
          </div>
        </div>
        <div className="rfa-h-summary-right">
          {/* mini progress */}
          <div className="rfa-h-mini-flow">
            {app.steps.map((s, idx) => (
              <React.Fragment key={idx}>
                <div
                  className="rfa-h-mini-dot"
                  style={{ background: STEP_STATE_COLOR[s.state], borderColor: STEP_STATE_COLOR[s.state] }}
                  title={`${s.approver.role}: ${s.state}`}
                >
                  {s.state === "完了" && <Check size={10} />}
                  {s.state === "差戻し" && <X size={10} />}
                </div>
                {idx < app.steps.length - 1 && (
                  <div
                    className="rfa-h-mini-bar"
                    style={{ background: app.steps[idx + 1].state === "未対応" ? "#e2e8f0" : STEP_STATE_COLOR[s.state] }}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
          <span className="rfa-status-chip" style={{ background: `${overallColor}15`, color: overallColor }}>
            {app.status}
          </span>
          <span className="rfa-h-date">{app.createdAt}</span>
          <span className={`rfa-h-chevron ${expanded ? "open" : ""}`}>▾</span>
        </div>
      </button>

      {expanded && (
        <>
          {isReturned && returnComment && (
            <div className="rfa-h-return-banner">
              <AlertCircle size={16} />
              <div>
                <div className="rfa-h-return-h">差戻しコメント</div>
                <div className="rfa-h-return-p">{returnComment}</div>
              </div>
            </div>
          )}
          <div className="rfa-h-detail">
            <div className="rfa-h-detail-left">
              <div className="rfa-h-detail-section">
                <div className="rfa-h-detail-label">対象期間</div>
                <div className="rfa-h-detail-value">
                  {app.targetMonthFrom === app.targetMonthTo
                    ? app.targetMonthFrom
                    : `${app.targetMonthFrom} 〜 ${app.targetMonthTo}`}
                </div>
              </div>
              <div className="rfa-h-detail-section">
                <div className="rfa-h-detail-label">申請理由</div>
                <div className="rfa-h-detail-value">{app.reason}</div>
              </div>
              <div className="rfa-h-detail-section">
                <div className="rfa-h-detail-label">返金項目</div>
                <ul className="rfa-h-items">
                  {app.items.map((it) => (
                    <li key={it.id}>
                      <span>{it.label}</span>
                      <span>¥{it.amount.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {app.account && (
                <div className="rfa-h-detail-section">
                  <div className="rfa-h-detail-label">返金先口座</div>
                  <div className="rfa-h-detail-value">
                    {app.account.bankName} {app.account.branchName} / {app.account.accountType} {app.account.accountNumber}（{app.account.holderName}）
                  </div>
                </div>
              )}
            </div>
            <div className="rfa-h-detail-right">
              <div className="rfa-h-detail-label">承認状況</div>
              <ol className="rfa-h-timeline">
                {app.steps.map((s, idx) => (
                  <li key={idx} className={`rfa-h-tl-item state-${s.state}`}>
                    <div className="rfa-h-tl-marker" style={{ background: STEP_STATE_COLOR[s.state] }}>
                      {s.state === "完了" && <Check size={12} />}
                      {s.state === "差戻し" && <X size={12} />}
                      {s.state === "対応中" && <span className="rfa-h-tl-pulse" />}
                    </div>
                    <div className="rfa-h-tl-body">
                      <div className="rfa-h-tl-head">
                        <span className="rfa-h-tl-role">{s.approver.role}</span>
                        <span className="rfa-h-tl-state" style={{ color: STEP_STATE_COLOR[s.state] }}>{s.state}</span>
                      </div>
                      <div className="rfa-h-tl-name">{s.approver.name}<span> / {s.approver.dept}</span></div>
                      {s.actedAt && <div className="rfa-h-tl-time">{s.actedAt}</div>}
                      {s.comment && <div className="rfa-h-tl-comment">「{s.comment}」</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* アクション */}
          <div className="rfa-h-actions">
            {!isApproved && (
              <button className="rfa-h-act danger" onClick={onDelete}>
                <X size={14} /> 削除
              </button>
            )}
            {isReturned && (
              <button className="rfa-h-act primary" onClick={onResubmit}>
                <RefreshCw size={14} /> 再申請する
              </button>
            )}
            {(isDraft || isPending) && (
              <button className="rfa-h-act outline" onClick={onEdit}>
                <Edit3 size={14} /> 編集
              </button>
            )}
            {isApproved && (
              <span className="rfa-h-act readonly">
                <Check size={14} /> 承認済みのため編集できません
              </span>
            )}
          </div>
        </>
      )}

      <style jsx>{`
        .rfa-h-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; transition: 0.15s; }
        .rfa-h-card.open { border-color: #bae6fd; box-shadow: 0 8px 16px -8px rgba(14, 165, 233, 0.15); }
        .rfa-h-card-summary { width: 100%; background: transparent; border: none; padding: 14px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 16px; text-align: left; }
        .rfa-h-card-summary:hover { background: #f8fafc; }
        .rfa-h-summary-left { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .rfa-h-id { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 800; color: #475569; display: inline-flex; align-items: center; gap: 6px; }
        .rfa-h-demo-badge { font-family: 'Inter', -apple-system, sans-serif; font-size: 9px; font-weight: 800; letter-spacing: 0.05em; padding: 2px 6px; border-radius: 4px; background: linear-gradient(135deg, #fef3c7, #fde68a); color: #92400e; }
        .rfa-h-meta { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #0f172a; flex-wrap: wrap; }
        .rfa-h-meta > span:nth-child(2n) { color: #cbd5e1; font-weight: 400; }
        .rfa-h-amount { color: #0369a1; }
        .rfa-h-summary-right { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
        .rfa-h-date { font-size: 11px; color: #94a3b8; font-weight: 600; font-family: 'SF Mono', Menlo, monospace; }
        .rfa-h-chevron { font-size: 12px; color: #94a3b8; transition: 0.2s; }
        .rfa-h-chevron.open { transform: rotate(180deg); color: #0ea5e9; }

        .rfa-h-mini-flow { display: flex; align-items: center; gap: 0; }
        .rfa-h-mini-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }
        .rfa-h-mini-bar { width: 20px; height: 2px; background: #e2e8f0; }

        .rfa-h-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 20px; border-top: 1px solid #f1f5f9; background: #fafbfc; }
        .rfa-h-detail-left, .rfa-h-detail-right { display: flex; flex-direction: column; gap: 14px; }
        .rfa-h-detail-section { display: flex; flex-direction: column; gap: 4px; }
        .rfa-h-detail-label { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .rfa-h-detail-value { font-size: 13px; color: #0f172a; line-height: 1.6; }
        .rfa-h-items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
        .rfa-h-items li { display: flex; justify-content: space-between; font-size: 13px; color: #475569; font-weight: 600; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
        .rfa-h-items li:last-child { border-bottom: none; }

        .rfa-h-timeline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .rfa-h-tl-item { display: grid; grid-template-columns: 28px 1fr; gap: 10px; position: relative; }
        .rfa-h-tl-item:not(:last-child)::before { content: ""; position: absolute; left: 13px; top: 28px; bottom: -14px; width: 2px; background: #e2e8f0; }
        .rfa-h-tl-marker { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; position: relative; z-index: 1; }
        .rfa-h-tl-pulse { width: 8px; height: 8px; border-radius: 50%; background: #fff; animation: rfa-pulse 1.4s ease-out infinite; }
        @keyframes rfa-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.7); } 70% { box-shadow: 0 0 0 6px rgba(255,255,255,0); } 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); } }
        .rfa-h-tl-body { display: flex; flex-direction: column; gap: 2px; }
        .rfa-h-tl-head { display: flex; justify-content: space-between; align-items: center; }
        .rfa-h-tl-role { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .rfa-h-tl-state { font-size: 11px; font-weight: 800; }
        .rfa-h-tl-name { font-size: 13px; font-weight: 700; color: #0f172a; }
        .rfa-h-tl-name span { color: #94a3b8; font-weight: 600; font-size: 11px; }
        .rfa-h-tl-time { font-size: 11px; color: #94a3b8; font-family: 'SF Mono', Menlo, monospace; }
        .rfa-h-tl-comment { font-size: 12px; color: #475569; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px; margin-top: 4px; font-style: italic; }
        @media (max-width: 768px) {
          .rfa-h-detail { grid-template-columns: 1fr; }
          .rfa-h-mini-flow { display: none; }
        }

        /* Return banner */
        .rfa-h-return-banner { display: flex; gap: 12px; align-items: flex-start; padding: 14px 20px; background: #fef2f2; border-top: 1px solid #fecaca; color: #b91c1c; }
        .rfa-h-return-banner svg { flex-shrink: 0; margin-top: 2px; }
        .rfa-h-return-h { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
        .rfa-h-return-p { font-size: 13px; font-weight: 600; line-height: 1.6; color: #7f1d1d; }

        /* Actions */
        .rfa-h-actions { padding: 14px 20px; border-top: 1px solid #f1f5f9; background: #fff; display: flex; justify-content: flex-end; gap: 10px; }
        .rfa-h-act { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 10px; font-size: 12px; font-weight: 800; cursor: pointer; transition: 0.15s; border: none; }
        .rfa-h-act.primary { background: #ef4444; color: #fff; }
        .rfa-h-act.primary:hover { background: #dc2626; }
        .rfa-h-act.outline { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
        .rfa-h-act.outline:hover { background: #f8fafc; border-color: #0ea5e9; color: #0ea5e9; }
        .rfa-h-act.danger { background: #fff; color: #b91c1c; border: 1px solid #fecaca; }
        .rfa-h-act.danger:hover { background: #fef2f2; border-color: #ef4444; }
        .rfa-h-act.readonly { background: #f1f5f9; color: #94a3b8; cursor: default; padding: 8px 16px; border-radius: 10px; font-size: 12px; font-weight: 700; }
      `}</style>
    </div>
  );
}
