"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft, Download, RefreshCw, AlertTriangle, Wallet, CheckCircle2, Users, TrendingUp,
  Phone, Mail, Copy, Clock, MessageSquare, Send, RotateCcw,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, PieChart, Pie,
} from "recharts";
import { UNPAID_AREAS } from "@/lib/unpaidAreaMap";
import { casioOf } from "@/lib/entryShopMap";
import GuideTour from "@/components/GuideTour";

// ---- 型 ----
interface Club { clubCode: string; clubName: string; companyGroup?: string; businessType?: string }
interface MonthRow { month: string; billedCount: number; billedAmount: number; unpaidCount: number; unpaidAmount: number; collectedCount: number; collectedAmount: number; recoveredAmount?: number; stillUnpaidAmount?: number;
  billedCountX?: number; billedAmountX?: number; collectedCountX?: number; collectedAmountX?: number; unpaidCountX?: number; unpaidAmountX?: number }
interface MonthDetailMember { memberNo: string; name: string; phone: string; email: string; unpaidAmount: number; recoveredAmount: number }
interface FollowupBucket { kubun: number; label: string; count: number; billedAmount: number; paidAmount: number; amount: number }
interface Followup {
  paid: FollowupBucket; unpaid: FollowupBucket; writeoff: FollowupBucket;
  cancelled: FollowupBucket; noObligation: FollowupBucket; notBilled: FollowupBucket; pending: FollowupBucket;
}
interface Summary {
  billedCount: number; billedAmount: number;
  unpaidCount: number; unpaidAmount: number;
  collectedCount: number; collectedAmount: number; collectionRate: number;
  // 強制退会(貸倒予定)を除く
  billedCountX: number; billedAmountX: number;
  unpaidCountX: number; unpaidAmountX: number;
  collectedCountX: number; collectedAmountX: number; collectionRateX: number;
  byMonth: MonthRow[];
  followup?: Followup; // ②未納(初回振替失敗)のその後
}
interface FormBreakdown { formName: string; planCode: number | null; isBase: boolean; feeAmount: number; outstanding: number }
interface Member {
  memberNo: string; memberName: string | null; kana: string | null;
  email: string | null; phone: string | null; plan: string | null;
  status: string; outstanding: number; unpaidCount: number; unpaidMonths: number;
  monthlyBreakdown: { month: string; amount: number }[];
  formBreakdown?: FormBreakdown[];
  annualFeeTotal: number; hasSecurityFee: boolean;
  consignCategory?: string | null; // ⑥ 委託先区分 (JACCS / クレカ / 現金 …)
  consignments?: string[];         // ⑥ 委託先名 (JACCS収金代行 / ｿﾌﾄﾊﾞﾝｸ …)
  paymentStatus?: string;          // ③ 現在の支払状況 (未納/一部入金/入金済) — 全体モード
  stillUnpaid?: boolean;           // ③ 現在も未納が残るか
  stillUnpaidAmount?: number;      // ③ 現在も未納の金額
}
// ⑥ 委託先の表示文字列: 「区分（名称）」。区分のみ/名称のみにも対応。
const consignLabel = (m: { consignCategory?: string | null; consignments?: string[] }): string => {
  const cat = (m.consignCategory || "").trim();
  const names = (m.consignments || []).filter(Boolean);
  if (cat && names.length) return `${cat}（${names.join("・")}）`;
  return cat || names.join("・") || "";
};
interface Schedule {
  totalAmount: number; totalCount: number;
  byFiscalYear: { fiscalYear: number; label: string; amount: number; count: number }[];
  byMonth: { month: string; amount: number; count: number }[];
}
interface AppShop { casioShopId: string; shopName: string; count: number; amount: number; brand: string }
interface AppSummary { totalCount: number; totalAmount: number; byShop: AppShop[] }

type Tab = "action" | "analysis" | "schedule" | "app";
type StatusKey = "1" | "2" | "3plus" | "wo";

const yen = (n: number) => "¥" + (n || 0).toLocaleString();
// カード用コンパクト表示 (億/万まで)。枠からのはみ出し防止。
const yenC = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e8) return "¥" + (v / 1e8).toFixed(2).replace(/\.?0+$/, "") + "億";
  if (Math.abs(v) >= 1e4) return "¥" + (v / 1e4).toFixed(1).replace(/\.0$/, "") + "万";
  return "¥" + v.toLocaleString();
};
// 年度(4月始まり)。ym(YYYYMM) の年度と、年度→期間(YYYYMM)。
const currentFiscalYear = () => {
  const d = new Date();
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
};
const fyRange = (fy: number) => ({ fromYm: `${fy}04`, toYm: `${fy + 1}03` });

// ステータス(Nか月目/貸倒予定) → 分類 + 表示メタ。SMS文面/優先度の出し分け用。
const statusCat = (status: string): StatusKey => {
  if (status === "貸倒予定") return "wo";
  const n = parseInt(status, 10);
  return n === 1 ? "1" : n === 2 ? "2" : "3plus";
};
const STATUS_UI: Record<StatusKey, { dot: string; short: string; rank: number; cls: string }> = {
  "3plus": { dot: "#dc2626", short: "3ヶ月以上", rank: 3, cls: "sn" },
  "2": { dot: "#f97316", short: "2ヶ月目", rank: 2, cls: "s2" },
  "1": { dot: "#eab308", short: "1ヶ月目", rank: 1, cls: "s1" },
  "wo": { dot: "#64748b", short: "貸倒予定", rank: 0, cls: "wo" },
};

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---- 督促（デモ）----
// ※ バックエンド未接続のデモ。会員番号から決定論的に過去の督促履歴を生成し、
//   画面内で「督促を記録」した分(dunLog)を上乗せして表示する。リロードで消える。
type DunItem = { date: string; channel: string; result: string; note?: string; demo?: boolean };
const DUN_CHANNELS = ["SMS", "電話", "メール", "店頭"];
const DUN_RESULTS = ["送信", "不在", "つながらず", "支払約束", "入金確認"];
function demoDunning(memberNo: string): DunItem[] {
  let seed = 0; for (const c of memberNo || "0") seed += c.charCodeAt(0);
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const n = Math.floor(rand() * 4); // 0〜3 件の過去督促
  const today = new Date();
  const items: DunItem[] = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = Math.floor(rand() * 45) + 3 + i * 7;
    const d = new Date(today); d.setDate(d.getDate() - daysAgo);
    const channel = DUN_CHANNELS[Math.floor(rand() * DUN_CHANNELS.length)];
    const result = DUN_RESULTS[Math.floor(rand() * (DUN_RESULTS.length - 1))];
    items.push({ date: d.toISOString().slice(0, 10), channel, result, note: rand() > 0.82 ? "折り返し依頼あり" : undefined, demo: true });
  }
  return items;
}
function dunStatusOf(history: DunItem[]): { label: string; color: string } {
  if (history.some((h) => h.result === "支払約束" || h.result === "入金確認")) return { label: "支払約束", color: "#059669" };
  if (history.length >= 2) return { label: "交渉中", color: "#d97706" };
  if (history.length === 1) return { label: "連絡済", color: "#2563eb" };
  return { label: "未督促", color: "#94a3b8" };
}

function UnpaidManager() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [mode, setMode] = useState<"club" | "area" | "brand">("club");
  const [clubCode, setClubCode] = useState("");
  const [area, setArea] = useState("");        // エリア(課別人員表 セクション4)
  const [territory, setTerritory] = useState(""); // テリトリー(セクション5)
  const [brand, setBrand] = useState("");
  const [fiscalYear, setFiscalYear] = useState<number>(currentFiscalYear()); // 年度(4月始まり)
  const [summary, setSummary] = useState<Summary | null>(null);
  const [clubCount, setClubCount] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [bucket, setBucket] = useState<"current" | "writeoff">("current");
  const [cohortMode, setCohortMode] = useState(false); // ③ 現在未納(false) / 確定時点の全体(true)
  const [statusFilter, setStatusFilter] = useState<"all" | StatusKey>("all");
  const [tab, setTab] = useState<Tab>("action");
  const [showAll, setShowAll] = useState(false); // 分析: 全体 / 強制退会除外(既定)
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [appSummary, setAppSummary] = useState<AppSummary | null>(null);
  const [loadingApp, setLoadingApp] = useState(false);
  const [loadingSum, setLoadingSum] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingSched, setLoadingSched] = useState(false);
  const [err, setErr] = useState("");
  const [listErr, setListErr] = useState("");
  const [detailMember, setDetailMember] = useState<Member | null>(null);
  const [dunLog, setDunLog] = useState<Record<string, DunItem[]>>({}); // 会員番号→督促記録(デモ)
  const [dunChannel, setDunChannel] = useState("電話");
  const [dunResult, setDunResult] = useState("送信");
  const [toast, setToast] = useState("");
  const [monthDetail, setMonthDetail] = useState<{ ym: string; unpaid: MonthDetailMember[]; recovered: MonthDetailMember[] } | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  // 推移グラフの比較 (なし / ブランド別 / 店舗別)
  const [compareMode, setCompareMode] = useState<"none" | "brand" | "store">("none");
  const [compareSeries, setCompareSeries] = useState<{ key: string; label: string; byMonth: Record<string, number> }[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const searchParams = useSearchParams();

  // 基本設定で選択したクラブを引き継ぐ (URL ?clubCode=)。再選択不要にする。
  useEffect(() => {
    const c = searchParams.get("clubCode");
    if (c) { setMode("club"); setClubCode(c); }
  }, [searchParams]);

  // クラブ辞書
  useEffect(() => {
    fetch("/api/clubs", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setClubs(d.clubs || []); })
      .catch(() => {});
  }, []);

  const brands = useMemo(() => [...new Set(clubs.map((c) => c.businessType).filter(Boolean))].sort() as string[], [clubs]);

  // 選択エリア/テリトリーから対象クラブコードを解決 (スコープはサーバ側で交差)
  const selectedAreaDef = useMemo(() => UNPAID_AREAS.find((a) => a.area === area) ?? null, [area]);
  const territoriesOfArea = selectedAreaDef?.territories ?? [];
  const areaClubCodes = useMemo(() => {
    if (!selectedAreaDef) return [];
    if (territory) return selectedAreaDef.territories.find((t) => t.territory === territory)?.clubCodes ?? [];
    return selectedAreaDef.clubCodes;
  }, [selectedAreaDef, territory]);

  const filterQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (mode === "club" && clubCode) p.set("clubCode", clubCode);
    if (mode === "area" && areaClubCodes.length > 0) p.set("clubCodes", areaClubCodes.join(","));
    if (mode === "brand" && brand) p.set("brand", brand);
    const { fromYm, toYm } = fyRange(fiscalYear);
    p.set("fromYm", fromYm); p.set("toYm", toYm); // 年度(4月始まり)で期間指定
    return p;
  }, [mode, clubCode, areaClubCodes, brand, fiscalYear]);

  const hasSelection = (mode === "club" && !!clubCode) || (mode === "area" && areaClubCodes.length > 0) || (mode === "brand" && !!brand);

  // 月次ドリルダウン (未納者/回収者)
  const openMonthDetail = async (month: string) => {
    const ym = month.replace("-", "");
    setMonthDetail({ ym: month, unpaid: [], recovered: [] });
    setMonthLoading(true);
    try {
      const q = filterQuery(); q.set("ym", ym);
      const res = await fetch(`/api/store-settings/unpaid/month-detail?${q}`, { cache: "no-store" });
      const d = await res.json();
      if (d.ok) setMonthDetail({ ym: month, unpaid: d.unpaid || [], recovered: d.recovered || [] });
    } catch { /* noop */ } finally { setMonthLoading(false); }
  };

  // ダッシュボード数値
  const loadSummary = useCallback(async () => {
    if (!hasSelection) { setSummary(null); return; }
    setLoadingSum(true); setErr("");
    try {
      const res = await fetch(`/api/store-settings/unpaid/summary?${filterQuery()}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "取得失敗");
      setSummary(d.summary || null);
      setClubCount(d.clubCount || 0);
    } catch (e: any) { setErr(e?.message || "エラー"); setSummary(null); }
    finally { setLoadingSum(false); }
  }, [filterQuery, hasSelection]);

  // 対象クラブコード群 (店舗/エリア/ブランド)
  const listClubCodes = useMemo(() => {
    if (mode === "club") return clubCode ? [clubCode] : [];
    if (mode === "area") return areaClubCodes;
    if (mode === "brand" && brand) return clubs.filter((c) => c.businessType === brand).map((c) => c.clubCode);
    return [];
  }, [mode, clubCode, areaClubCodes, brand, clubs]);

  // 未納者リスト (現未納=current / 貸倒予定=writeoff)
  const loadList = useCallback(async () => {
    if (listClubCodes.length === 0) { setMembers([]); setListErr(""); return; }
    setLoadingList(true); setListErr("");
    try {
      const cohortQ = bucket === "current" && cohortMode ? "&cohort=1" : "";
      const res = await fetch(`/api/store-settings/unpaid/list?clubCodes=${listClubCodes.join(",")}&bucket=${bucket}${cohortQ}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "取得失敗");
      setMembers(d.members || []);
    } catch (e: any) { setListErr(e?.message || "エラー"); setMembers([]); }
    finally { setLoadingList(false); }
  }, [listClubCodes, bucket, cohortMode]);

  // 貸倒償却予定
  const loadSchedule = useCallback(async () => {
    if (!hasSelection) { setSchedule(null); return; }
    setLoadingSched(true);
    try {
      const res = await fetch(`/api/store-settings/unpaid/writeoff-schedule?${filterQuery()}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "取得失敗");
      setSchedule(d.schedule || null);
    } catch (e: any) { setErr(e?.message || "エラー"); setSchedule(null); }
    finally { setLoadingSched(false); }
  }, [filterQuery, hasSelection]);

  // APP入金(未納金のアプリ回収)。別画面の実績を本画面に統合。
  // サマリーはユーザースコープ全体を返すので、選択中クラブの casio_shop_id で絞り込む。
  const loadAppSummary = useCallback(async () => {
    if (listClubCodes.length === 0) { setAppSummary(null); return; }
    setLoadingApp(true);
    try {
      const from = `${fiscalYear}-04-01`, to = `${fiscalYear + 1}-03-31`;
      const res = await fetch(`/api/store-settings/unpaid-app-payments?view=summary&from=${from}&to=${to}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "取得失敗");
      const want = new Set(listClubCodes.map((c) => casioOf(c)));
      const byShop: AppShop[] = (d.byShop || []).filter((s: any) => want.has(String(s.casioShopId)));
      setAppSummary({
        totalCount: byShop.reduce((a, s) => a + s.count, 0),
        totalAmount: byShop.reduce((a, s) => a + s.amount, 0),
        byShop,
      });
    } catch (e: any) { setErr(e?.message || "エラー"); setAppSummary(null); }
    finally { setLoadingApp(false); }
  }, [listClubCodes, fiscalYear]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // 推移比較: ブランド別 or 店舗別に未納金額の推移を取得
  const brandOf = useCallback((code: string) => {
    const c = clubs.find((x) => x.clubCode === code);
    return (c?.businessType || "").toUpperCase() === "FIT365" ? "FIT365" : "JOYFIT";
  }, [clubs]);
  const listKey = listClubCodes.join(",");
  useEffect(() => {
    if (tab !== "analysis" || compareMode === "none" || listClubCodes.length === 0) { setCompareSeries([]); return; }
    let cancelled = false;
    (async () => {
      setCompareLoading(true);
      let groups: { key: string; label: string; codes: string[] }[] = [];
      if (compareMode === "brand") {
        const m = new Map<string, string[]>();
        listClubCodes.forEach((c) => { const b = brandOf(c); m.set(b, [...(m.get(b) || []), c]); });
        groups = [...m.entries()].map(([b, cs]) => ({ key: b, label: b, codes: cs }));
      } else {
        groups = listClubCodes.slice(0, 20).map((c) => ({ key: c, label: clubs.find((x) => x.clubCode === c)?.clubName || c, codes: [c] }));
      }
      const { fromYm, toYm } = fyRange(fiscalYear);
      try {
        const series = await Promise.all(groups.map(async (g) => {
          const p = new URLSearchParams({ clubCodes: g.codes.join(","), fromYm, toYm });
          const res = await fetch(`/api/store-settings/unpaid/summary?${p}`, { cache: "no-store" });
          const d = await res.json();
          const bm: Record<string, number> = {};
          (d.summary?.byMonth || []).forEach((mm: any) => { bm[mm.month] = mm.unpaidAmount; });
          return { key: g.key, label: g.label, byMonth: bm };
        }));
        if (!cancelled) setCompareSeries(series);
      } catch { if (!cancelled) setCompareSeries([]); }
      finally { if (!cancelled) setCompareLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tab, compareMode, listKey, fiscalYear, brandOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // 対応=現未納 / 貸倒=貸倒予定。タブ切替で bucket を確定 → loadList が追従。
  useEffect(() => {
    if (tab === "action" && bucket !== "current") setBucket("current");
    if (tab === "schedule") { if (bucket !== "writeoff") setBucket("writeoff"); loadSchedule(); }
    if (tab === "app") loadAppSummary();
  }, [tab, loadSchedule, loadAppSummary]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "action" || tab === "schedule") loadList(); }, [tab, loadList]);

  // CSV出力 (店舗 / エリア / ブランド)。列順: 会員番号, 名前, 未納金額, 電話番号, メールアドレス …
  const downloadCsv = async () => {
    let codes: string[] = [];
    let tag = "";
    if (mode === "club" && clubCode) { codes = [clubCode]; tag = clubCode; }
    else if (mode === "area" && areaClubCodes.length > 0) { codes = areaClubCodes; tag = (territory || area).replace(/\s/g, ""); }
    else if (mode === "brand" && brand) { codes = clubs.filter((c) => c.businessType === brand).map((c) => c.clubCode); tag = brand; }
    if (codes.length === 0) { alert("店舗・エリア・ブランドのいずれかを選択してください"); return; }
    const cohortQ = bucket === "current" && cohortMode ? "&cohort=1" : "";
    const res = await fetch(`/api/store-settings/unpaid/list?clubCodes=${codes.join(",")}&bucket=${bucket}${cohortQ}&reason=csv`, { cache: "no-store" });
    const d = await res.json();
    let rows: Member[] = d.members || [];
    if (bucket === "current" && statusFilter !== "all") rows = rows.filter((m) => statusCat(m.status) === statusFilter);
    const isCohort = bucket === "current" && cohortMode;
    // 画面表示に合わせた列（ステータス→会員→委託先→金額→月数→内訳→ｾｷｭﾘﾃｨ→連絡先）。
    // 全体(確定時点)モードでは「現在状況」「現在未納額」を追加(誰が入金済みかを保持)。
    const header = ["ステータス", "会員番号", "氏名", "会員区分", "委託先", "未納金額",
      ...(isCohort ? ["現在状況", "現在未納額"] : []),
      "未納月数", "最古未納月", "内訳(契約形態別・会費)", "セキュリティ費(年管理費)", "電話番号", "メールアドレス"];
    const lines = rows.map((m) => [
      m.status, m.memberNo, m.memberName ?? "", m.plan ?? "", consignLabel(m),
      m.outstanding,
      ...(isCohort ? [m.paymentStatus ?? "", m.stillUnpaidAmount ?? 0] : []),
      m.unpaidMonths,
      (m.monthlyBreakdown && m.monthlyBreakdown.length ? m.monthlyBreakdown[m.monthlyBreakdown.length - 1].month : ""),
      (m.formBreakdown ?? []).map((f) => `${f.isBase ? "会費" : "OP"}:${f.formName} ${f.feeAmount}`).join(" / "),
      m.annualFeeTotal, m.phone ?? "", m.email ?? "",
    ].map(csvEscape).join(","));
    const csv = "﻿" + [header.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = bucket === "writeoff" ? "貸倒予定" : (isCohort ? "未納者_確定時点全体" : "未納者");
    a.href = url; a.download = `${label}_${tag}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(""), 2200); };
  const copyContact = async (m: Member) => {
    const parts = [m.memberName, m.memberNo, m.phone, m.email].filter(Boolean).join("  ");
    try { await navigator.clipboard.writeText(parts); showToast("連絡先をコピーしました"); }
    catch { showToast("コピーできませんでした"); }
  };
  // 督促履歴(デモ生成 + 画面内で記録した分)。新しい順。
  const dunHistoryOf = useCallback((memberNo: string): DunItem[] => {
    const merged = [...(dunLog[memberNo] || []), ...demoDunning(memberNo)];
    return merged.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [dunLog]);
  const recordDunning = (memberNo: string) => {
    const today = new Date().toISOString().slice(0, 10);
    setDunLog((prev) => ({ ...prev, [memberNo]: [{ date: today, channel: dunChannel, result: dunResult }, ...(prev[memberNo] || [])] }));
    showToast(`督促を記録しました（デモ）: ${dunChannel}／${dunResult}`);
  };

  const clubName = clubs.find((c) => c.clubCode === clubCode)?.clubName;
  const scopeLabel = mode === "club" ? (clubName || clubCode) : mode === "area" ? (territory || area) : brand;

  // 現未納リストのステータス別集計 (bucket=current 時のみ意味を持つ)
  const byStatus = useMemo(() => {
    const acc: Record<StatusKey, { c: number; a: number }> = { "1": { c: 0, a: 0 }, "2": { c: 0, a: 0 }, "3plus": { c: 0, a: 0 }, "wo": { c: 0, a: 0 } };
    for (const m of members) { const k = statusCat(m.status); acc[k].c++; acc[k].a += m.outstanding; }
    return acc;
  }, [members]);
  const currentTotal = useMemo(() => members.reduce((s, m) => s + (m.outstanding || 0), 0), [members]);

  const filteredMembers = useMemo(
    () => (statusFilter === "all" ? members : members.filter((m) => statusCat(m.status) === statusFilter)),
    [members, statusFilter]
  );
  // 対応リストは優先度(経過月)→金額 降順
  const orderedMembers = useMemo(
    () => [...filteredMembers].sort((a, b) => STATUS_UI[statusCat(b.status)].rank - STATUS_UI[statusCat(a.status)].rank || b.outstanding - a.outstanding),
    [filteredMembers]
  );

  const oldestMonthOf = (m: Member) => (m.monthlyBreakdown && m.monthlyBreakdown.length ? m.monthlyBreakdown[m.monthlyBreakdown.length - 1].month : null);

  return (
    <div className="up-root">
      <GuideTour
        storageKey="tour_unpaid_v2"
        steps={[
          { title: "未納金管理", body: "現場は「対応」タブで未納者を追い、本部は「分析」タブで全体像を見ます。使い方をご案内します。" },
          { selector: '[data-tour="filter"]', title: "対象と年度の選択", body: "店舗・エリア・ブランドで対象を選び、年度（4月〜翌3月）を切り替えます。基本設定で選んだ店舗は自動で引き継がれます。" },
          { selector: '[data-tour="tabs"]', title: "対応 / 分析 / 貸倒償却予定 / APP入金", body: "「対応」＝いま連絡すべき未納者。「分析」＝請求・回収・未納の集計と推移。CSVは対応タブから出力できます。" },
          { selector: '[data-tour="kpi"]', title: "現未納のサマリー", body: "現在も未回収の総額・件数と回収率を表示。経過月ごとの内訳もここで把握できます。" },
          { selector: '[data-tour="cases"]', title: "対応リスト", body: "経過月で優先度を色分け。行の「連絡先」で電話/メールをコピー、「詳細」で月別内訳を確認できます。" },
        ]}
      />
      <header className="up-header">
        <div className="up-header-inner">
          <Link href="/store-settings" className="up-back"><ArrowLeft size={20} /></Link>
          <div>
            <h1 className="up-title">未納金管理</h1>
            <p className="up-sub">現在も未回収の未納を追う「対応」／請求・回収の集計を見る「分析」</p>
          </div>
          <button className="up-reload" onClick={() => { loadSummary(); if (tab === "action" || tab === "schedule") loadList(); if (tab === "schedule") loadSchedule(); if (tab === "app") loadAppSummary(); }}>
            <RefreshCw size={14} /> 更新
          </button>
        </div>
      </header>

      <div className="up-body">
        {/* フィルタ */}
        <div className="up-filter" data-tour="filter">
          <div className="up-modes">
            {(["club", "area", "brand"] as const).map((mo) => (
              <button key={mo} className={`up-mode ${mode === mo ? "active" : ""}`} onClick={() => setMode(mo)}>
                {mo === "club" ? "店舗" : mo === "area" ? "エリア" : "ブランド"}
              </button>
            ))}
          </div>
          {mode === "club" && (
            <select className="up-select" value={clubCode} onChange={(e) => setClubCode(e.target.value)}>
              <option value="">店舗を選択…</option>
              {clubCode && !clubs.some((c) => c.clubCode === clubCode) && <option value={clubCode}>{clubCode}</option>}
              {clubs.map((c) => <option key={c.clubCode} value={c.clubCode}>{c.clubCode} {c.clubName}</option>)}
            </select>
          )}
          {mode === "area" && (
            <>
              <select className="up-select" value={area} onChange={(e) => { setArea(e.target.value); setTerritory(""); }}>
                <option value="">エリアを選択…</option>
                {UNPAID_AREAS.map((a) => <option key={a.area} value={a.area}>{a.area}（{a.clubCodes.length}店）</option>)}
              </select>
              <select className="up-select" value={territory} onChange={(e) => setTerritory(e.target.value)} disabled={!selectedAreaDef}>
                <option value="">テリトリー：すべて</option>
                {territoriesOfArea.map((t) => <option key={t.territory} value={t.territory}>{t.territory}（{t.clubCodes.length}店）</option>)}
              </select>
            </>
          )}
          {mode === "brand" && (
            <select className="up-select" value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">ブランドを選択…</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <select className="up-select up-select-sm" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} title="年度(4月〜翌3月)">
            {Array.from({ length: currentFiscalYear() - 2025 + 1 }, (_, i) => currentFiscalYear() - i).map((fy) => (
              <option key={fy} value={fy}>{fy}年度（{fy}/4〜{fy + 1}/3）</option>
            ))}
          </select>
          {clubCount > 1 && <span className="up-badge">{clubCount}店舗 合算</span>}
        </div>

        {err && <div className="up-err"><AlertTriangle size={14} /> {err}</div>}
        {!hasSelection && <div className="up-empty">店舗・エリア・ブランドのいずれかを選択してください。</div>}

        {hasSelection && (
          <>
            {/* タブ */}
            <div className="up-tabs" data-tour="tabs">
              <button className={`up-tab ${tab === "action" ? "active" : ""}`} onClick={() => setTab("action")}>対応</button>
              <button className={`up-tab ${tab === "analysis" ? "active" : ""}`} onClick={() => setTab("analysis")}>分析</button>
              <button className={`up-tab ${tab === "schedule" ? "active" : ""}`} onClick={() => setTab("schedule")}>貸倒償却予定</button>
              <button className={`up-tab ${tab === "app" ? "active" : ""}`} onClick={() => setTab("app")}>APP入金</button>
            </div>

            {/* ============ 対応 ============ */}
            {tab === "action" && (
              <div className="up-action">
                {/* KPI: 一覧が読めた時は一覧(下のリスト)に一致。取得失敗/読込中は②その後の権威値にフォールバック */}
                {(() => {
                  const fu = summary?.followup?.unpaid;
                  const listReady = !loadingList && !listErr;
                  // 全体モードでは「現未納」KPIは、まだ未納が残る分のみ(入金済は除外)
                  const stillAmt = members.reduce((s, m) => s + (m.stillUnpaidAmount || 0), 0);
                  const stillCnt = members.filter((m) => m.stillUnpaid).length;
                  const curAmt = listReady ? (cohortMode ? stillAmt : currentTotal) : (fu ? fu.amount : currentTotal);
                  const curCnt = listReady ? (cohortMode ? stillCnt : members.length) : (fu ? fu.count : members.length);
                  return (
                <div className="up-kpi" data-tour="kpi">
                  <div className="up-kpi-tile red">
                    <span className="l"><AlertTriangle size={13} /> 現未納 合計</span>
                    <span className="v">{yen(curAmt)}</span>
                    <span className="s">{curCnt.toLocaleString()}名 が現在も未回収</span>
                  </div>
                  <div className="up-kpi-tile">
                    <span className="l"><CheckCircle2 size={13} /> 回収率（強制退会除く）</span>
                    <span className="v">{summary ? `${summary.collectionRateX}%` : "—"}</span>
                    <span className="s">{summary ? `回収 ${yenC(summary.collectedAmountX)} / 請求 ${yenC(summary.billedAmountX)}` : "集計中…"}</span>
                  </div>
                  <div className="up-kpi-tile amber">
                    <span className="l"><Clock size={13} /> 3ヶ月以上 滞留</span>
                    <span className="v">{listErr ? "—" : yen(byStatus["3plus"].a)}</span>
                    <span className="s">{listErr ? "一覧の取得後に表示" : `${byStatus["3plus"].c.toLocaleString()}名 ／ 早期対応が必要`}</span>
                  </div>
                  <div className="up-kpi-tile">
                    <span className="l"><Users size={13} /> 今月の新規未納</span>
                    <span className="v">{listErr ? "—" : yen(byStatus["1"].a)}</span>
                    <span className="s">{listErr ? "一覧の取得後に表示" : `${byStatus["1"].c.toLocaleString()}名（1ヶ月目）`}</span>
                  </div>
                </div>
                  );
                })()}

                {/* ③ 表示モード: 現在未納 / 全体(確定時点) */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "2px 0 10px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>表示:</span>
                  {([["cur", "現在未納", false], ["all", "全体（確定時点）", true]] as const).map(([k, lbl, on]) => (
                    <button key={k} onClick={() => setCohortMode(on)}
                      style={{ border: "1px solid " + (cohortMode === on ? "#4f46e5" : "#cbd5e1"), background: cohortMode === on ? "#4f46e5" : "#fff", color: cohortMode === on ? "#fff" : "#475569", borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      {lbl}
                    </button>
                  ))}
                  {cohortMode && (
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      初回振替に失敗した<b>全員</b>（アプリ入金済も残す＝人数が減らない）。各行に現在状況を表示 ／
                      現在も未納 <b>{members.filter((m) => m.stillUnpaid).length.toLocaleString()}</b>名・{yen(members.reduce((s, m) => s + (m.stillUnpaidAmount || 0), 0))}
                    </span>
                  )}
                </div>

                {/* ステータス絞り込み + CSV */}
                <div className="up-action-bar">
                  <div className="up-statusfilter">
                    {([["all", "すべて", members.length], ["3plus", "3ヶ月以上", byStatus["3plus"].c], ["2", "2ヶ月目", byStatus["2"].c], ["1", "1ヶ月目", byStatus["1"].c]] as const).map(([k, lbl, cnt]) => (
                      <button key={k} className={`up-sf ${statusFilter === k ? "active" : ""}`} onClick={() => setStatusFilter(k as any)}>
                        {k !== "all" && <span className="up-sf-dot" style={{ background: STATUS_UI[k as StatusKey].dot }} />}
                        {lbl} <b>{cnt}</b>
                      </button>
                    ))}
                  </div>
                  <button className="up-csv-btn" onClick={downloadCsv} disabled={members.length === 0}>
                    <Download size={15} /> CSV出力{statusFilter !== "all" ? `（${statusFilter === "3plus" ? "3ヶ月以上" : statusFilter + "ヶ月目"}）` : ""}
                  </button>
                </div>

                {/* 対応リスト */}
                <div className="up-cases" data-tour="cases">
                  {loadingList ? (
                    <div className="up-empty">読み込み中…</div>
                  ) : listErr ? (
                    <div className="up-empty up-empty-err">
                      <AlertTriangle size={18} />
                      <div>未納者一覧を取得できませんでした<br /><span style={{ fontWeight: 600, color: "#94a3b8", fontSize: 12 }}>{listErr}</span></div>
                      <button className="up-tri-btn" onClick={loadList}><RotateCcw size={13} /> 再試行</button>
                    </div>
                  ) : orderedMembers.length === 0 ? (
                    <div className="up-empty up-empty-good"><CheckCircle2 size={18} /> 対応が必要な未納者はいません</div>
                  ) : orderedMembers.map((m) => {
                    const k = statusCat(m.status);
                    const ui = STATUS_UI[k];
                    const oldest = oldestMonthOf(m);
                    const dun = dunHistoryOf(m.memberNo);
                    const ds = dunStatusOf(dun);
                    return (
                      <div className="up-case" key={m.memberNo} style={{ borderLeftColor: ui.dot }}>
                        <div className="up-case-main">
                          <span className="up-case-badge" style={{ background: `${ui.dot}14`, color: ui.dot }}>
                            <span className="up-case-dot" style={{ background: ui.dot }} />{m.status}
                          </span>
                          {cohortMode && m.paymentStatus && (
                            <span className="up-case-plan" title="現在の入金状況"
                              style={m.paymentStatus === "入金済"
                                ? { background: "#ecfdf5", borderColor: "#a7f3d0", color: "#059669" }
                                : m.paymentStatus === "一部入金"
                                ? { background: "#fffbeb", borderColor: "#fde68a", color: "#b45309" }
                                : { background: "#fef2f2", borderColor: "#fecaca", color: "#dc2626" }}>
                              {m.paymentStatus}{m.paymentStatus === "一部入金" ? `（残${yen(m.stillUnpaidAmount || 0)}）` : ""}
                            </span>
                          )}
                          <code className="up-case-no">{m.memberNo}</code>
                          <span className="up-case-name">{m.memberName || "（氏名未登録）"}</span>
                          {m.plan && <span className="up-case-plan">{m.plan}</span>}
                          {m.consignCategory && (
                            <span className="up-case-plan" style={{ background: "#f0f9ff", borderColor: "#bae6fd", color: "#0369a1" }} title={consignLabel(m)}>
                              {m.consignCategory}
                            </span>
                          )}
                          <span className="up-dun-badge" style={{ color: ds.color, borderColor: `${ds.color}55`, background: `${ds.color}12` }} title="督促ステータス（デモ）">
                            <MessageSquare size={11} /> {ds.label}{dun.length > 0 ? ` ・${dun.length}回` : ""}
                          </span>
                          <span className="up-case-amt">{yen(m.outstanding)}</span>
                          <div className="up-case-actions">
                            <button className="up-tri-btn" onClick={() => setDetailMember(m)}>詳細・督促</button>
                            <button className="up-tri-btn primary" onClick={() => copyContact(m)}><Copy size={13} /> 連絡先</button>
                          </div>
                        </div>
                        <div className="up-case-sub">
                          {(m.formBreakdown || []).slice(0, 4).map((f, i) => (
                            <span className="up-bd-chip" key={i} style={f.isBase ? { background: "#eef2ff", borderColor: "#c7d2fe", color: "#3730a3", fontWeight: 700 } : undefined}>
                              {f.isBase ? "会費 " : "OP "}{f.formName} <b>{yen(f.feeAmount)}</b>
                            </span>
                          ))}
                          <span className="up-case-months">{m.unpaidMonths}ヶ月分{oldest ? ` ・ 最古 ${oldest}` : ""}{m.hasSecurityFee ? ` ・ ｾｷｭﾘﾃｨ費 ${yen(m.annualFeeTotal)}` : ""}</span>
                        </div>
                        <div className="up-case-contact">
                          {m.phone ? <a href={`tel:${m.phone}`}><Phone size={12} /> {m.phone}</a> : null}
                          {m.email ? <a href={`mailto:${m.email}`}><Mail size={12} /> {m.email}</a> : null}
                          {!m.phone && !m.email && <span className="up-muted">連絡先未登録</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ============ 分析 ============ */}
            {tab === "analysis" && (
              <div className="up-dash">
                {loadingSum ? <div className="up-empty">読み込み中…</div> : summary ? (() => {
                  const s = summary;
                  const billedCnt = showAll ? s.billedCount : s.billedCountX;
                  const billedAmt = showAll ? s.billedAmount : s.billedAmountX;
                  const collectedCnt = showAll ? s.collectedCount : s.collectedCountX;
                  const collectedAmt = showAll ? s.collectedAmount : s.collectedAmountX;
                  const unpaidCnt = showAll ? s.unpaidCount : s.unpaidCountX;
                  const unpaidAmt = showAll ? s.unpaidAmount : s.unpaidAmountX;
                  const rate = showAll ? s.collectionRate : s.collectionRateX;
                  return (
                  <>
                    <div className="up-section-h">
                      ① 初回振替の結果
                      <div className="up-scope-toggle">
                        <button className={!showAll ? "active" : ""} onClick={() => setShowAll(false)}>強制退会を除く</button>
                        <button className={showAll ? "active" : ""} onClick={() => setShowAll(true)}>全体</button>
                      </div>
                    </div>
                    <div className="up-cards">
                      <Card icon={<Users size={18} />} label="請求件数" value={billedCnt.toLocaleString()} tone="blue" sub="振替総数" />
                      <Card icon={<Wallet size={18} />} label="請求金額" value={yenC(billedAmt)} tone="blue" sub={yen(billedAmt)} />
                      <Card icon={<CheckCircle2 size={18} />} label="回収件数" value={collectedCnt.toLocaleString()} tone="green" />
                      <Card icon={<Wallet size={18} />} label="回収金額" value={yenC(collectedAmt)} tone="green" sub={`回収率 ${rate}%`} />
                      <Card icon={<Users size={18} />} label="未納件数" value={unpaidCnt.toLocaleString()} tone="red" />
                      <Card icon={<Wallet size={18} />} label="未納金額" value={yenC(unpaidAmt)} tone="red" sub={yen(unpaidAmt)} />
                    </div>
                    <p className="up-note">※「未納」＝初回振替が不成立だった総額（後日回収された分も含む）。現在も未回収の金額は「対応」タブを参照。</p>

                    {s.followup && (() => {
                      const fu = s.followup!;
                      const rows = [
                        { ...fu.paid, tone: "green" as const, note: "初回振替失敗後に回収できた" },
                        { ...fu.unpaid, tone: "red" as const, note: "現在も未回収（現行未納）" },
                        { ...fu.pending, tone: "blue" as const, note: "入金歴なし（処理待ち）" },
                        { ...fu.writeoff, tone: "amber" as const, note: "貸倒れ処理済" },
                        { ...fu.cancelled, tone: "gray" as const, note: "売上取消" },
                      ].filter((r) => r.count > 0 || r.amount !== 0);
                      const totalCnt = rows.reduce((acc, r) => acc + r.count, 0) || 1;
                      return (
                        <>
                          <div className="up-section-h" style={{ marginTop: 22 }}>② 未納になった人のその後</div>
                          <div className="up-panel">
                            <table className="up-table">
                              <thead><tr><th>入金区分</th><th>内容</th><th>件数（契約者SEQ）</th><th>金額</th><th>構成比</th></tr></thead>
                              <tbody>
                                {rows.map((r) => (
                                  <tr key={r.kubun}>
                                    <td><span className={`up-pill ${r.tone}`}>{r.label}</span></td>
                                    <td className="up-muted2">{r.note}</td>
                                    <td>{r.count.toLocaleString()}名</td>
                                    <td className={r.tone === "red" ? "up-red" : r.tone === "green" ? "up-green" : ""}>{yen(r.amount)}</td>
                                    <td>{Math.round((r.count / totalCnt) * 100)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      );
                    })()}

                    <div className="up-section-h" style={{ marginTop: 22 }}>推移・内訳</div>
                    <div className="up-charts">
                      <div className="up-panel">
                        <div className="up-panel-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                          <span><TrendingUp size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                            {compareMode === "none" ? `請求 / 回収 / 未納 推移と回収率（${fiscalYear}年度）` : compareMode === "store" ? `未納金額 店舗別ランキング（${fiscalYear}年度）` : `未納金額の推移 ブランド比較（${fiscalYear}年度）`}</span>
                          <span style={{ display: "inline-flex", gap: 4, fontSize: 11 }}>
                            {compareLoading && <span style={{ color: "#94a3b8", alignSelf: "center" }}>集計中…</span>}
                            <span style={{ color: "#94a3b8", fontWeight: 700, alignSelf: "center" }}>比較:</span>
                            {(["none", "brand", "store"] as const).map((cm) => (
                              <button key={cm} onClick={() => setCompareMode(cm)}
                                style={{ border: "1px solid " + (compareMode === cm ? "#4f46e5" : "#cbd5e1"), background: compareMode === cm ? "#4f46e5" : "#fff", color: compareMode === cm ? "#fff" : "#475569", borderRadius: 7, padding: "3px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                {cm === "none" ? "なし" : cm === "brand" ? "ブランド" : "店舗"}
                              </button>
                            ))}
                          </span>
                        </div>
                        <div style={{ padding: "14px 10px 6px" }}>
                          <ResponsiveContainer width="100%" height={compareMode === "store" ? Math.max(260, compareSeries.length * 30 + 40) : 260}>
                            {compareMode === "store" ? (
                              <BarChart layout="vertical" data={compareSeries
                                .map((sr) => ({ label: sr.label, 未納: Object.values(sr.byMonth).reduce((a, b) => a + b, 0) }))
                                .sort((a, b) => b.未納 - a.未納)}
                                margin={{ left: 8, right: 16 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                                <XAxis type="number" fontSize={10} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
                                <YAxis type="category" dataKey="label" width={120} fontSize={11} interval={0} />
                                <Tooltip formatter={(v: any) => `¥${Number(v).toLocaleString()}`} />
                                <Bar dataKey="未納" fill="#f87171" radius={[0, 4, 4, 0]} />
                              </BarChart>
                            ) : compareMode === "brand" ? (
                              <ComposedChart data={s.byMonth.map((m) => {
                                const row: any = { month: m.month.slice(2) };
                                compareSeries.forEach((sr) => { row[sr.label] = sr.byMonth[m.month] ?? 0; });
                                return row;
                              })}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="month" fontSize={11} />
                                <YAxis fontSize={10} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
                                <Tooltip formatter={(v: any) => `¥${Number(v).toLocaleString()}`} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                {compareSeries.map((sr, i) => (
                                  <Line key={sr.key} dataKey={sr.label} stroke={["#4f46e5", "#e26e9d", "#0097a7", "#d97706"][i % 4]} strokeWidth={2.5} dot={{ r: 2 }} />
                                ))}
                              </ComposedChart>
                            ) : (
                            <ComposedChart data={s.byMonth.map((m) => ({
                              month: m.month.slice(2),
                              請求: m.billedAmount, 回収: m.collectedAmount, 未納: m.unpaidAmount,
                              回収率: m.collectedAmount + m.unpaidAmount > 0 ? Math.round((m.collectedAmount / (m.collectedAmount + m.unpaidAmount)) * 100) : 0,
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis dataKey="month" fontSize={11} />
                              <YAxis yAxisId="l" fontSize={10} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
                              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} fontSize={10} tickFormatter={(v) => `${v}%`} />
                              <Tooltip formatter={(v: any, n: any) => (n === "回収率" ? `${v}%` : `¥${Number(v).toLocaleString()}`)} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                              <Bar yAxisId="l" dataKey="請求" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                              <Bar yAxisId="l" dataKey="回収" fill="#34d399" radius={[3, 3, 0, 0]} />
                              <Bar yAxisId="l" dataKey="未納" fill="#f87171" radius={[3, 3, 0, 0]} />
                              <Line yAxisId="r" dataKey="回収率" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2 }} />
                            </ComposedChart>
                            )}
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className="up-panel">
                        <div className="up-panel-h">請求金額の内訳（回収 / 未納）</div>
                        <div style={{ padding: 10 }}>
                          <ResponsiveContainer width="100%" height={230}>
                            <PieChart>
                              <Pie
                                data={[
                                  { name: "回収", value: collectedAmt },
                                  { name: "未納", value: unpaidAmt },
                                ]}
                                dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}
                              >
                                <Cell fill="#34d399" />
                                <Cell fill="#f87171" />
                              </Pie>
                              <Tooltip formatter={(v: any) => `¥${Number(v).toLocaleString()}`} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                    <div className="up-panel">
                      <div className="up-panel-h">月次内訳（{fiscalYear}年度）<span style={{ fontWeight: 600, color: "#94a3b8", fontSize: 11 }}> {showAll ? "全体" : "強制退会を除く"} ／ 行クリックで未納者・回収者を表示</span></div>
                      <table className="up-table">
                        <thead><tr><th>振替年月</th><th>請求（件/¥）</th><th>回収（件/¥）</th><th>未納（件/¥）</th><th>うち後日回収</th><th>現未納</th><th></th></tr></thead>
                        <tbody>
                          {[...s.byMonth].reverse().map((r) => (
                            <tr key={r.month} className="up-row-click" onClick={() => openMonthDetail(r.month)}>
                              <td>{r.month}</td>
                              <td className="up-blue">{(showAll ? r.billedCount : (r.billedCountX ?? 0)).toLocaleString()}件 / {yen(showAll ? r.billedAmount : (r.billedAmountX ?? 0))}</td>
                              <td className="up-green">{(showAll ? r.collectedCount : (r.collectedCountX ?? 0)).toLocaleString()}件 / {yen(showAll ? r.collectedAmount : (r.collectedAmountX ?? 0))}</td>
                              <td className="up-red">{(showAll ? r.unpaidCount : (r.unpaidCountX ?? 0)).toLocaleString()}件 / {yen(showAll ? r.unpaidAmount : (r.unpaidAmountX ?? 0))}</td>
                              <td className="up-green">{yen(r.recoveredAmount || 0)}</td>
                              <td className="up-red">{yen(r.stillUnpaidAmount || 0)}</td>
                              <td style={{ color: "#94a3b8" }}>›</td>
                            </tr>
                          ))}
                          {s.byMonth.length === 0 && <tr><td colSpan={7} className="up-muted">データがありません</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                  );
                })() : <div className="up-empty">データがありません</div>}
              </div>
            )}

            {/* ============ 貸倒償却予定 ============ */}
            {tab === "schedule" && (
              <div className="up-sched">
                {loadingSched ? <div className="up-empty">読み込み中…</div> : schedule ? (
                  <>
                    <div className="up-cards">
                      <Card icon={<AlertTriangle size={18} />} label="貸倒償却予定 総額" value={yen(schedule.totalAmount)} tone="amber" sub={`${schedule.totalCount.toLocaleString()}件`} />
                    </div>
                    <div className="up-panel" style={{ marginBottom: 16 }}>
                      <div className="up-panel-h">年度別 償却予定額（償却予定＝振替年月+12ヶ月・年度は4月始まり）</div>
                      <table className="up-table">
                        <thead><tr><th>年度</th><th>償却予定件数</th><th>償却予定金額</th></tr></thead>
                        <tbody>
                          {schedule.byFiscalYear.map((f) => (
                            <tr key={f.fiscalYear}><td>{f.label}</td><td>{f.count.toLocaleString()}</td><td className="up-amber">{yen(f.amount)}</td></tr>
                          ))}
                          {schedule.byFiscalYear.length === 0 && <tr><td colSpan={3} className="up-muted">データがありません</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div className="up-panel" style={{ marginBottom: 16 }}>
                      <div className="up-panel-h">月別 償却予定額</div>
                      <table className="up-table">
                        <thead><tr><th>償却予定月</th><th>件数</th><th>金額</th></tr></thead>
                        <tbody>
                          {[...schedule.byMonth].reverse().map((m) => (
                            <tr key={m.month}><td>{m.month}</td><td>{m.count.toLocaleString()}</td><td className="up-amber">{yen(m.amount)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* 貸倒予定(強制退会)の会員リスト */}
                    <div className="up-panel">
                      <div className="up-panel-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>貸倒予定 会員（強制退会） {bucket === "writeoff" ? `${members.length}名` : ""}</span>
                        <button className="up-tri-btn" onClick={downloadCsv} disabled={bucket !== "writeoff" || members.length === 0}><Download size={13} /> CSV</button>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="up-table">
                          <thead><tr><th>会員番号</th><th>氏名</th><th>会員区分</th><th>委託先</th><th>未納金額</th><th>未納月数</th><th>電話</th><th>メール</th></tr></thead>
                          <tbody>
                            {bucket === "writeoff" && members.map((m) => (
                              <tr key={m.memberNo}>
                                <td><code>{m.memberNo}</code></td>
                                <td>{m.memberName}</td>
                                <td>{m.plan}</td>
                                <td>{m.consignCategory || "—"}</td>
                                <td className="up-amber">{yen(m.outstanding)}</td>
                                <td>{m.unpaidMonths}ヶ月</td>
                                <td>{m.phone}</td>
                                <td className="up-mail">{m.email}</td>
                              </tr>
                            ))}
                            {bucket === "writeoff" && members.length === 0 && <tr><td colSpan={8} className="up-muted">該当者がいません</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : <div className="up-empty">データがありません</div>}
              </div>
            )}

            {/* ============ APP入金 ============ */}
            {tab === "app" && (
              <div className="up-app">
                <div className="up-section-h">APP入金（未納金のアプリ回収）<span style={{ fontWeight: 600, color: "#94a3b8", fontSize: 11 }}>入会DB実績 ／ {fiscalYear}年度 ／ 選択中の対象で絞込</span></div>
                {loadingApp ? <div className="up-empty">読み込み中…</div> : appSummary ? (
                  <>
                    <div className="up-cards">
                      <Card icon={<Wallet size={18} />} label="APP回収 金額" value={yenC(appSummary.totalAmount)} tone="green" sub={yen(appSummary.totalAmount)} />
                      <Card icon={<CheckCircle2 size={18} />} label="APP回収 件数" value={appSummary.totalCount.toLocaleString()} tone="green" sub="APPで未納金を支払った件数" />
                      <Card icon={<Users size={18} />} label="対象店舗数" value={appSummary.byShop.length.toLocaleString()} tone="blue" />
                    </div>
                    <div className="up-panel">
                      <div className="up-panel-h">店舗別 APP入金（{fiscalYear}年度）<span style={{ fontWeight: 600, color: "#94a3b8", fontSize: 11 }}> 金額降順</span></div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="up-table">
                          <thead><tr><th>ブランド</th><th>店舗</th><th>件数</th><th>金額</th></tr></thead>
                          <tbody>
                            {appSummary.byShop.map((s) => (
                              <tr key={`${s.brand}-${s.casioShopId}`}>
                                <td><span className={`up-pill ${s.brand === "JOYFIT" ? "blue" : "red"}`}>{s.brand}</span></td>
                                <td>{s.shopName} <code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 4, fontSize: 11, color: "#64748b" }}>{s.casioShopId}</code></td>
                                <td>{s.count.toLocaleString()}件</td>
                                <td className="up-green">{yen(s.amount)}</td>
                              </tr>
                            ))}
                            {appSummary.byShop.length === 0 && <tr><td colSpan={4} className="up-muted">該当データがありません</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <Link href="/store-settings/unpaid-app-payments" className="up-tri-btn" style={{ textDecoration: "none", display: "inline-block" }}>会員別の明細を開く →</Link>
                    </div>
                  </>
                ) : <div className="up-empty">データがありません</div>}
              </div>
            )}
          </>
        )}
      </div>

      {/* 会員詳細モーダル */}
      {detailMember && (
        <div className="up-modal-ov" onClick={() => setDetailMember(null)}>
          <div className="up-modal up-modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="up-modal-h">
              <span>{detailMember.memberName || "（氏名未登録）"} <code style={{ fontSize: 12, marginLeft: 6 }}>{detailMember.memberNo}</code></span>
              <button onClick={() => setDetailMember(null)}>✕</button>
            </div>
            <div className="up-detail-body">
              <div className="up-detail-top">
                <div>
                  <div className="up-detail-amt">{yen(detailMember.outstanding)}</div>
                  <div className="up-muted2">未納 {detailMember.unpaidMonths}ヶ月分 ／ {detailMember.status} ／ {detailMember.plan || "—"}{consignLabel(detailMember) ? ` ／ 委託先 ${consignLabel(detailMember)}` : ""}</div>
                </div>
                <button className="up-tri-btn primary" onClick={() => copyContact(detailMember)}><Copy size={13} /> 連絡先コピー</button>
              </div>
              <div className="up-detail-contact">
                {detailMember.phone ? <a href={`tel:${detailMember.phone}`}><Phone size={13} /> {detailMember.phone}</a> : <span className="up-muted">電話未登録</span>}
                {detailMember.email ? <a href={`mailto:${detailMember.email}`}><Mail size={13} /> {detailMember.email}</a> : <span className="up-muted">メール未登録</span>}
              </div>
              <div className="up-detail-sec">契約形態別 内訳</div>
              <div className="up-bd-wrap" style={{ maxHeight: "none" }}>
                {(detailMember.formBreakdown || []).map((f, i) => (
                  <span className="up-bd-chip" key={i} style={f.isBase ? { background: "#eef2ff", borderColor: "#c7d2fe", color: "#3730a3", fontWeight: 700 } : undefined}>
                    {f.isBase ? "会費 " : "OP "}{f.formName} <b>{yen(f.feeAmount)}</b>
                  </span>
                ))}
                {(detailMember.formBreakdown || []).length === 0 && <span className="up-muted">—</span>}
              </div>
              <div className="up-detail-sec">月別 未納内訳</div>
              <table className="up-table">
                <thead><tr><th>振替年月</th><th>未納金額</th></tr></thead>
                <tbody>
                  {(detailMember.monthlyBreakdown || []).map((x) => (
                    <tr key={x.month}><td>{x.month}</td><td className="up-red">{yen(x.amount)}</td></tr>
                  ))}
                  {(detailMember.monthlyBreakdown || []).length === 0 && <tr><td colSpan={2} className="up-muted">—</td></tr>}
                </tbody>
              </table>
              {detailMember.hasSecurityFee && <p className="up-note">セキュリティ費（年管理費）: {yen(detailMember.annualFeeTotal)}</p>}

              {/* 督促（デモ）*/}
              <div className="up-detail-sec" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MessageSquare size={13} /> 督促履歴
                {(() => { const ds = dunStatusOf(dunHistoryOf(detailMember.memberNo)); return <span className="up-dun-badge" style={{ color: ds.color, borderColor: `${ds.color}55`, background: `${ds.color}12` }}>{ds.label}</span>; })()}
                <span className="up-muted" style={{ fontSize: 11, marginLeft: "auto" }}>デモ（保存されません）</span>
              </div>
              <div className="up-dun-form">
                <select value={dunChannel} onChange={(e) => setDunChannel(e.target.value)}>
                  {DUN_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={dunResult} onChange={(e) => setDunResult(e.target.value)}>
                  {DUN_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button className="up-tri-btn primary" onClick={() => recordDunning(detailMember.memberNo)}><Send size={13} /> 督促を記録</button>
              </div>
              <div className="up-dun-timeline">
                {dunHistoryOf(detailMember.memberNo).map((h, i) => (
                  <div className="up-dun-row" key={i}>
                    <span className="up-dun-date">{h.date}</span>
                    <span className="up-dun-ch">{h.channel}</span>
                    <span className="up-dun-res">{h.result}</span>
                    {h.note && <span className="up-dun-note">{h.note}</span>}
                    {!h.demo && <span className="up-dun-new">今回記録</span>}
                  </div>
                ))}
                {dunHistoryOf(detailMember.memberNo).length === 0 && <div className="up-muted" style={{ padding: "8px 2px", fontSize: 12 }}>督促履歴はありません（未督促）</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 月次ドリルダウン: 未納者 / 後日回収者 */}
      {monthDetail && (
        <div className="up-modal-ov" onClick={() => setMonthDetail(null)}>
          <div className="up-modal" onClick={(e) => e.stopPropagation()}>
            <div className="up-modal-h">
              <span>{monthDetail.ym} の内訳</span>
              <button onClick={() => setMonthDetail(null)}>✕</button>
            </div>
            {monthLoading ? <div className="up-empty">読み込み中…</div> : (
              <div className="up-modal-body">
                <div className="up-modal-col">
                  <div className="up-modal-col-h red">現未納者（{monthDetail.unpaid.length}名）</div>
                  <div className="up-modal-list">
                    {monthDetail.unpaid.map((m) => (
                      <div className="up-mrow" key={m.memberNo}>
                        <div><code>{m.memberNo}</code> {m.name}</div>
                        <div className="up-red">{yen(m.unpaidAmount)}</div>
                        <div className="up-mrow-sub">{m.phone} {m.email}</div>
                      </div>
                    ))}
                    {monthDetail.unpaid.length === 0 && <div className="up-muted" style={{ padding: 12 }}>なし</div>}
                  </div>
                </div>
                <div className="up-modal-col">
                  <div className="up-modal-col-h green">後日回収できた人（{monthDetail.recovered.length}名）</div>
                  <div className="up-modal-list">
                    {monthDetail.recovered.map((m) => (
                      <div className="up-mrow" key={m.memberNo}>
                        <div><code>{m.memberNo}</code> {m.name}</div>
                        <div className="up-green">{yen(m.recoveredAmount)}</div>
                        <div className="up-mrow-sub">{m.phone} {m.email}</div>
                      </div>
                    ))}
                    {monthDetail.recovered.length === 0 && <div className="up-muted" style={{ padding: 12 }}>なし</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="up-toast">{toast}</div>}

      <style jsx global>{`
        .up-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .up-row-click { cursor: pointer; } .up-row-click:hover { background: #f8fafc; }
        .up-modal-ov { position: fixed; inset: 0; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
        .up-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 860px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; }
        .up-modal-sm { max-width: 560px; }
        .up-modal-h { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #e2e8f0; font-weight: 800; }
        .up-modal-h button { border: none; background: #f1f5f9; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; font-weight: 700; }
        .up-modal-body { display: grid; grid-template-columns: 1fr 1fr; gap: 0; overflow: hidden; }
        .up-modal-col { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid #e2e8f0; }
        .up-modal-col:last-child { border-right: none; }
        .up-modal-col-h { padding: 10px 16px; font-weight: 800; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
        .up-modal-col-h.red { color: #dc2626; } .up-modal-col-h.green { color: #059669; }
        .up-modal-list { overflow-y: auto; max-height: 62vh; }
        .up-mrow { padding: 8px 16px; border-bottom: 1px solid #f8fafc; font-size: 13px; display: grid; grid-template-columns: 1fr auto; gap: 4px; }
        .up-mrow code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
        .up-mrow-sub { grid-column: 1 / -1; font-size: 11px; color: #94a3b8; }
        .up-detail-body { padding: 16px 18px; overflow-y: auto; }
        .up-detail-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .up-detail-amt { font-size: 26px; font-weight: 800; color: #dc2626; }
        .up-detail-contact { display: flex; flex-wrap: wrap; gap: 14px; padding: 10px 12px; background: #f8fafc; border-radius: 10px; margin-bottom: 14px; font-size: 13px; }
        .up-detail-contact a { color: #2563eb; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
        .up-detail-sec { font-size: 12px; font-weight: 800; color: #64748b; margin: 12px 0 8px; }
        .up-header { background: #fff; border-bottom: 2px solid #0ea5e9; position: sticky; top: 0; z-index: 40; }
        .up-header-inner { max-width: 1240px; margin: 0 auto; height: 68px; padding: 0 24px; display: flex; align-items: center; gap: 16px; }
        .up-back { color: #94a3b8; display: flex; } .up-back:hover { color: #0ea5e9; }
        .up-title { font-size: 18px; font-weight: 800; margin: 0; }
        .up-sub { font-size: 12px; color: #64748b; margin: 0; }
        .up-reload { margin-left: auto; display: flex; align-items: center; gap: 6px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .up-body { max-width: 1240px; margin: 0 auto; padding: 20px 24px 60px; }
        .up-filter { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; flex-wrap: wrap; }
        .up-modes { display: flex; gap: 4px; background: #f1f5f9; padding: 3px; border-radius: 8px; }
        .up-mode { border: none; background: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
        .up-mode.active { background: #fff; color: #0ea5e9; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
        .up-select { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-weight: 600; min-width: 260px; background: #fff; }
        .up-select-sm { min-width: 180px; }
        .up-badge { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 20px; padding: 4px 12px; font-size: 11px; font-weight: 800; }
        .up-err { margin-top: 12px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .up-empty { margin-top: 16px; background: #fff; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; }
        .up-empty-good { color: #059669; border-color: #a7f3d0; background: #f0fdf4; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .up-empty-err { color: #b91c1c; border-color: #fecaca; background: #fef2f2; display: flex; align-items: center; justify-content: center; gap: 12px; border-style: solid; }
        .up-tabs { display: flex; gap: 4px; margin: 18px 0 14px; }
        .up-tab { background: #fff; border: 1px solid #e2e8f0; padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
        .up-tab.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
        .up-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 18px; }
        .up-charts { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 18px; }
        @media (max-width: 900px) { .up-charts { grid-template-columns: 1fr; } }
        .up-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; }
        .up-card-top { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 12px; font-weight: 700; }
        .up-card-val { font-size: 24px; font-weight: 800; margin-top: 8px; }
        .up-card-sub { font-size: 12px; color: #64748b; font-weight: 700; margin-top: 2px; }
        .up-card.red .up-card-top, .up-card.red .up-card-val { color: #dc2626; }
        .up-card.green .up-card-top, .up-card.green .up-card-val { color: #059669; }
        .up-card.amber .up-card-top, .up-card.amber .up-card-val { color: #d97706; }
        .up-card.blue .up-card-top, .up-card.blue .up-card-val { color: #2563eb; }
        .up-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
        .up-panel-h { padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 800; }
        .up-note { font-size: 11px; color: #94a3b8; font-weight: 600; margin: 8px 2px 0; }
        .up-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .up-table th { background: #f8fafc; text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #64748b; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
        .up-table td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; white-space: nowrap; }
        .up-red { color: #dc2626; font-weight: 700; } .up-green { color: #059669; font-weight: 700; } .up-amber { color: #d97706; font-weight: 700; } .up-blue { color: #2563eb; font-weight: 700; }
        .up-muted { color: #94a3b8; font-weight: 600; }
        .up-muted2 { color: #64748b; font-size: 12px; }
        .up-section-h { font-size: 14px; font-weight: 800; color: #0f172a; margin: 4px 0 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .up-section-h span { font-size: 11px; font-weight: 600; color: #94a3b8; }
        .up-scope-toggle { display: inline-flex; gap: 2px; background: #f1f5f9; padding: 3px; border-radius: 8px; margin-left: auto; }
        .up-scope-toggle button { border: none; background: none; padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 800; color: #64748b; cursor: pointer; }
        .up-scope-toggle button.active { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
        .up-pill { display: inline-block; font-size: 11px; font-weight: 800; border-radius: 999px; padding: 2px 10px; }
        .up-pill.green { background: #ecfdf5; color: #059669; } .up-pill.red { background: #fef2f2; color: #dc2626; }
        .up-pill.blue { background: #eff6ff; color: #2563eb; } .up-pill.amber { background: #fffbeb; color: #d97706; }
        .up-pill.gray { background: #f1f5f9; color: #64748b; }
        .up-mail { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
        .up-bd-wrap { display: flex; flex-wrap: wrap; gap: 4px; max-height: 84px; overflow-y: auto; }
        .up-bd-chip { display: inline-block; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 1px 6px; font-size: 11px; white-space: nowrap; }
        .up-bd-chip b { color: #dc2626; font-weight: 700; }
        /* KPI */
        .up-kpi { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .up-kpi-tile { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 3px; }
        .up-kpi-tile.red { border-color: #fecaca; background: linear-gradient(180deg,#fff,#fff7f7); }
        .up-kpi-tile.amber { border-color: #fde68a; background: linear-gradient(180deg,#fff,#fffdf5); }
        .up-kpi-tile .l { font-size: 11px; font-weight: 800; color: #64748b; display: flex; align-items: center; gap: 5px; }
        .up-kpi-tile .v { font-size: 24px; font-weight: 800; color: #0f172a; }
        .up-kpi-tile.red .v { color: #dc2626; } .up-kpi-tile.amber .v { color: #d97706; }
        .up-kpi-tile .s { font-size: 11px; font-weight: 600; color: #94a3b8; }
        /* action bar */
        .up-action-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
        .up-statusfilter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .up-sf { border: 1px solid #e2e8f0; background: #fff; border-radius: 20px; padding: 6px 14px; font-size: 12px; font-weight: 700; color: #475569; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .up-sf.active { background: #0f172a; color: #fff; border-color: #0f172a; }
        .up-sf b { margin-left: 2px; }
        .up-sf-dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
        .up-csv-btn { margin-left: auto; display: flex; align-items: center; gap: 7px; background: #0f172a; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
        .up-csv-btn:hover { background: #1e293b; } .up-csv-btn:disabled { opacity: .4; cursor: not-allowed; }
        /* 対応リスト(ケースカード) */
        .up-cases { display: flex; flex-direction: column; gap: 10px; }
        .up-case { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #cbd5e1; border-radius: 12px; padding: 12px 16px; }
        .up-case-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .up-case-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; border-radius: 999px; padding: 3px 10px; }
        .up-case-dot { width: 7px; height: 7px; border-radius: 999px; display: inline-block; }
        .up-case-no { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #475569; }
        .up-case-name { font-weight: 800; font-size: 14px; }
        .up-case-plan { font-size: 11px; color: #64748b; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 1px 7px; }
        .up-case-amt { font-size: 17px; font-weight: 800; color: #dc2626; margin-left: auto; }
        .up-case-actions { display: flex; gap: 6px; }
        .up-case-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 9px; }
        .up-case-months { font-size: 11px; color: #94a3b8; font-weight: 600; margin-left: 4px; }
        .up-case-contact { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 12px; }
        .up-case-contact a { color: #2563eb; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
        .up-tri-btn { border: 1px solid #cbd5e1; background: #fff; color: #475569; border-radius: 8px; padding: 7px 13px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
        .up-tri-btn.primary { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
        .up-tri-btn.primary:hover { background: #0284c7; }
        .up-tri-btn:disabled { opacity: .4; cursor: not-allowed; }
        .up-toast { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #fff; padding: 10px 20px; border-radius: 999px; font-size: 13px; font-weight: 700; z-index: 200; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
        /* 督促 */
        .up-dun-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; border: 1px solid; border-radius: 999px; padding: 2px 9px; }
        .up-dun-form { display: flex; gap: 8px; align-items: center; margin: 4px 0 10px; flex-wrap: wrap; }
        .up-dun-form select { padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-weight: 600; background: #fff; }
        .up-dun-timeline { display: flex; flex-direction: column; gap: 6px; }
        .up-dun-row { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 8px 10px; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 8px; }
        .up-dun-date { font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
        .up-dun-ch { font-weight: 700; color: #2563eb; background: #eff6ff; border-radius: 6px; padding: 1px 8px; }
        .up-dun-res { color: #334155; font-weight: 700; }
        .up-dun-note { color: #94a3b8; }
        .up-dun-new { margin-left: auto; font-size: 10px; font-weight: 800; color: #059669; background: #ecfdf5; border-radius: 999px; padding: 2px 8px; }
      `}</style>
    </div>
  );
}

function Card({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className={`up-card ${tone}`}>
      <div className="up-card-top">{icon} {label}</div>
      <div className="up-card-val">{value}</div>
      {sub && <div className="up-card-sub">{sub}</div>}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div style={{ padding: 40 }}>読み込み中…</div>}><UnpaidManager /></Suspense>;
}
