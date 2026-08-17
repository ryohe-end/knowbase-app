// app/store-settings/push/new/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import ConditionGroupForm, { type CondGroup, newCondGroup } from "@/components/ConditionGroupForm";
import { type ContractTypeOption } from "@/components/ContractTypePicker";
import StorePicker from "@/components/StorePicker";
import GuideTour from "@/components/GuideTour";
import ContentBlocksEditor, { type ContentBlock, newTextBlock, blocksToHtml, blocksToText } from "@/components/ContentBlocksEditor";

// 契約種別は店舗選択時に member-search(Oracle/会員区分) から動的取得する。
// 初期グループ生成用の空マスタ (店舗未選択時)。
const CONTRACT_TYPES: string[] = [];

type StoreItem = { clubCode: string; clubName: string; brand: string; brandGroup?: string; ownership?: string; area?: string };
type ExtractedMember = {
  memberNo: string;
  name: string;
  kana: string;
  age: number | null;
  gender: "male" | "female" | null;
  contractType: string;
  withdrawnAt: string | null;
  appUserId: number | null;
  deliverable: boolean;
};

// ブランド → 表示テーマ (プレビュー出し分け)
function brandTheme(brand: string): { label: string; color: string; appName: string } {
  const b = (brand || "").toUpperCase();
  if (b.startsWith("JOYFIT")) return { label: "JOYFIT", color: "#1F2C5C", appName: "JOYFITアプリ" };
  return { label: "FIT365", color: "#E26E9D", appName: "FIT365アプリ" };
}

export default function NewPushPage() {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 店舗コンテキスト (ログインユーザーの担当クラブ・複数選択可)
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [selectedClubs, setSelectedClubs] = useState<string[]>([]);
  const [storeLoading, setStoreLoading] = useState(true);
  const clubCode = selectedClubs[0] || ""; // プレビュー/AI 用の代表クラブ
  const selectedStore = useMemo(() => stores.find((s) => s.clubCode === clubCode) ?? null, [stores, clubCode]);
  const brand = selectedStore?.brand ?? "FIT365";
  const theme = useMemo(() => brandTheme(brand), [brand]);

  // フォーム
  const [title, setTitle] = useState("");
  // 本文はブロック(テキスト/画像)で構成。画像は任意の位置に挿入・配置指定できる。
  const [blocks, setBlocks] = useState<ContentBlock[]>([newTextBlock("")]);
  const bodyText = useMemo(() => blocksToText(blocks), [blocks]);       // PUSHバナー/プレビュー/ガード用
  const contentHtml = useMemo(() => blocksToHtml(blocks), [blocks]);    // お知らせ欄用HTML
  // AI(Claude on Bedrock) による タイトル・本文・お知らせHTML 生成
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [htmlBody, setHtmlBody] = useState(""); // AI生成のお知らせHTML(空=ブロック本文HTMLを使用)
  // お知らせ欄に実際に使うHTML: AI生成があればそれを優先、無ければブロック本文
  const noticeHtml = htmlBody || contentHtml;
  // 条件グループ (グループ内は AND、グループ間は groupOp)
  const [groups, setGroups] = useState<CondGroup[]>([newCondGroup(CONTRACT_TYPES)]);
  const [groupOp, setGroupOp] = useState<"OR" | "AND">("OR");
  // 店舗に属する契約種別(会員区分)。店舗選択で動的取得。
  const [ctOptions, setCtOptions] = useState<ContractTypeOption[]>([]);
  const [ctLoading, setCtLoading] = useState(false);
  // 会員区分に紐づく契約形態。店舗選択で動的取得。
  const [cfOptions, setCfOptions] = useState<ContractTypeOption[]>([]);
  const [cfLoading, setCfLoading] = useState(false);
  const updateGroup = (i: number, patch: Partial<CondGroup>) =>
    setGroups((prev) => prev.map((g, gi) => (gi === i ? { ...g, ...patch } : g)));
  const addGroup = () => setGroups((prev) => [...prev, newCondGroup(ctOptions.map((o) => o.name))]);
  const removeGroup = (i: number) => setGroups((prev) => (prev.length <= 1 ? prev : prev.filter((_, gi) => gi !== i)));
  const [extractedMembers, setExtractedMembers] = useState<ExtractedMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [extractMeta, setExtractMeta] = useState<{ totalCount: number; deliverableCount: number } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  // スケジュール
  const [isImmediate, setIsImmediate] = useState(true);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [linkUrl, setLinkUrl] = useState("");     // 「詳しくはこちら」ボタンのURL(任意)
  const [endDate, setEndDate] = useState("");       // 掲載終了日(任意。空=既定90日)
  const [endTime, setEndTime] = useState("");       // 掲載終了時刻(任意。空=23:59)
  // テスト送信
  const [testMembers, setTestMembers] = useState("");
  const [testingPush, setTestingPush] = useState(false);
  const sendTestPush = async () => {
    if (!clubCode) { alert("配信店舗を選択してください。"); return; }
    if (!title || !bodyText) { alert("タイトル・本文を入力してください。"); return; }
    setTestingPush(true);
    try {
      const res = await fetch("/api/store-settings/push/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberNos: testMembers, title, body: bodyText, contentHtml: noticeHtml || undefined, linkUrl: linkUrl.trim() || undefined, brand, clubCode }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "テスト送信に失敗しました");
      alert(`テスト送信しました（${d.sent}名）。${(d.notFound || []).length ? `\n見つからない会員番号: ${d.notFound.join(", ")}` : ""}\n数分後にアプリのお知らせ/PUSHに届きます。`);
    } catch (e: any) { alert(e?.message || "テスト送信に失敗しました"); }
    finally { setTestingPush(false); }
  };

  // 履歴からの「編集して再送信」: sessionStorage の内容を初期値に反映
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("push_reuse");
      if (raw) {
        const d = JSON.parse(raw);
        if (d.title) setTitle(String(d.title));
        if (d.body) setBlocks([newTextBlock(String(d.body))]);
        if (d.html) setHtmlBody(String(d.html)); // 元のお知らせデザインHTMLを引き継ぐ
        sessionStorage.removeItem("push_reuse");
      }
    } catch { /* noop */ }
  }, []);

  // 担当クラブを取得 (stores API はユーザーの clubCodes でフィルタ済み)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/store-settings/stores", { cache: "no-store" });
        const data = await res.json();
        const list: StoreItem[] = (data.stores || []).map((s: any) => ({
          clubCode: String(s.clubCode),
          clubName: s.clubName,
          brand: s.brand,
          brandGroup: s.brandGroup,
          ownership: s.ownership,
          area: s.area,
        }));
        setStores(list);
        if (list.length === 1) setSelectedClubs([list[0].clubCode]); // 単一担当なら自動選択
      } catch {
        /* noop */
      } finally {
        setStoreLoading(false);
      }
    })();
  }, []);

  // 店舗選択 → 契約種別(会員区分) と 契約形態 を選択店舗すべてでマージ取得。既定は全種別を選択。
  const clubsKey = selectedClubs.join(",");
  useEffect(() => {
    if (selectedClubs.length === 0) { setCtOptions([]); setCfOptions([]); return; }
    let cancelled = false;
    (async () => {
      setCtLoading(true); setCfLoading(true);
      const mergeByName = (arr: ContractTypeOption[]) => {
        const m = new Map<string, ContractTypeOption>();
        for (const o of arr) {
          const e = m.get(o.name);
          if (e) { e.activeCount = (e.activeCount || 0) + (o.activeCount || 0); e.totalCount = (e.totalCount || 0) + (o.totalCount || 0); }
          else m.set(o.name, { ...o });
        }
        return [...m.values()].sort((a, b) => (b.activeCount || 0) - (a.activeCount || 0));
      };
      try {
        const results = await Promise.all(selectedClubs.map(async (code) => {
          const [ctRes, cfRes] = await Promise.all([
            fetch(`/api/store-settings/members/contract-types?clubCode=${encodeURIComponent(code)}`, { cache: "no-store" }),
            fetch(`/api/store-settings/members/contract-forms?clubCode=${encodeURIComponent(code)}`, { cache: "no-store" }),
          ]);
          return { ct: await ctRes.json(), cf: await cfRes.json() };
        }));
        if (cancelled) return;
        const ctAll = results.flatMap((r) => (r.ct.contractTypes || []).map((c: any) => ({ name: String(c.name), activeCount: Number(c.activeCount || 0), totalCount: Number(c.totalCount || 0) })));
        const cfAll = results.flatMap((r) => (r.cf.contractForms || []).map((c: any) => ({ name: String(c.name), group: String(c.planName || ""), activeCount: Number(c.activeCount || 0), totalCount: Number(c.totalCount || 0) })));
        const ctOpts = mergeByName(ctAll);
        const cfOpts = mergeByName(cfAll);
        setCtOptions(ctOpts);
        setCfOptions(cfOpts);
        const allNames = ctOpts.map((o) => o.name);
        setGroups((prev) => prev.map((g) => ({ ...g, contractTypes: allNames })));
      } catch {
        if (!cancelled) { setCtOptions([]); setCfOptions([]); }
      } finally {
        if (!cancelled) { setCtLoading(false); setCfLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [clubsKey]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleExtract = async () => {
    if (selectedClubs.length === 0) {
      setExtractError("担当店舗を選択してください。");
      return;
    }
    setIsExtracting(true);
    setExtractError("");
    try {
      const res = await fetch("/api/store-settings/members/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryType: "push",
          clubCodes: selectedClubs,
          groupOp,
          groups,
          limit: 5000,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setExtractError(
          data?.error === "extract_endpoint_pending"
            ? "会員抽出API(member-search)が未提供のため抽出できません。"
            : `抽出に失敗しました (${data?.error || res.status})`
        );
        setExtractedMembers([]);
        setSelectedMemberIds(new Set());
        setExtractMeta(null);
        return;
      }
      const members: ExtractedMember[] = data.members || [];
      setExtractedMembers(members);
      // 配信可能な会員だけ初期選択
      setSelectedMemberIds(new Set(members.filter((m) => m.deliverable).map((m) => m.memberNo)));
      setExtractMeta({ totalCount: data.totalCount ?? members.length, deliverableCount: data.deliverableCount ?? 0 });
      setCurrentPage(1);
    } catch (e: any) {
      setExtractError("抽出リクエストに失敗しました。");
    } finally {
      setIsExtracting(false);
    }
  };

  // 宛先リストは配信可能(有効)な人だけ表示する
  const deliverableMembers = useMemo(() => extractedMembers.filter((m) => m.deliverable), [extractedMembers]);
  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return deliverableMembers.slice(start, start + itemsPerPage);
  }, [deliverableMembers, currentPage]);

  const toggleSelectMember = (memberNo: string) => {
    const next = new Set(selectedMemberIds);
    if (next.has(memberNo)) next.delete(memberNo);
    else next.add(memberNo);
    setSelectedMemberIds(next);
  };

  // 選択済み かつ 配信可能(appUserId あり) の宛先
  const targetAppUserIds = useMemo(
    () =>
      extractedMembers
        .filter((m) => selectedMemberIds.has(m.memberNo) && m.deliverable && m.appUserId != null)
        .map((m) => m.appUserId as number),
    [extractedMembers, selectedMemberIds]
  );

  const scheduledLabel = useMemo(() => {
    if (isImmediate) return "今すぐ送信";
    if (!scheduledDate || !scheduledTime) return "未設定";
    const d = new Date(`${scheduledDate}T${scheduledTime}:00`);
    return d.toLocaleString("ja-JP", {
      year: "numeric", month: "long", day: "numeric",
      weekday: "short", hour: "2-digit", minute: "2-digit",
    });
  }, [isImmediate, scheduledDate, scheduledTime]);

  const requestConfirm = () => {
    if (selectedClubs.length === 0) return alert("担当店舗を選択してください。");
    if (!title || !bodyText) return alert("タイトルと本文は必須です。");
    if (targetAppUserIds.length === 0) return alert("配信可能な対象を選択してください。");
    if (!isImmediate && (!scheduledDate || !scheduledTime)) {
      return alert("予約配信の場合は送信日時を指定してください。");
    }
    setConfirmOpen(true);
  };

  // AIで文章作成: タイトル・本文を生成して各入力欄へ反映する
  const generateAiText = async () => {
    if (!aiPrompt.trim() && !bodyText.trim() && !title.trim()) {
      setAiError("作りたい内容の指示、またはタイトル/本文を入力してください。");
      return;
    }
    setAiGenerating(true);
    setAiError("");
    try {
      const res = await fetch("/api/store-settings/push/generate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, subject: title, body: bodyText, brand }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAiError(data?.error || "AI生成に失敗しました");
        return;
      }
      if (data.title) setTitle(data.title);
      if (data.body) setBlocks([newTextBlock(data.body)]);
      if (data.html) setHtmlBody(data.html); // お知らせ欄のデザインHTML
    } catch {
      setAiError("AI生成リクエストに失敗しました。");
    } finally {
      setAiGenerating(false);
    }
  };

  const submit = async (isDraft: boolean) => {
    setSending(true);
    try {
      const scheduledAt =
        !isImmediate && scheduledDate && scheduledTime ? `${scheduledDate} ${scheduledTime}` : undefined;
      // 掲載終了(JST 'YYYY-MM-DD HH:mm')。日付のみ指定時は 23:59 まで。空なら未指定(APIが既定90日)。
      const endAt = endDate ? `${endDate} ${endTime || "23:59"}` : undefined;
      const res = await fetch("/api/store-settings/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clubCode,
          clubCodes: selectedClubs,
          brand,
          title,
          body: bodyText,
          contentHtml: noticeHtml || undefined, // AI生成HTML優先、無ければブロック本文HTML(画像位置指定)
          linkUrl: linkUrl.trim() || undefined, // 「詳しくはこちら」ボタンのURL
          targetType: "CONDITION",
          appUserIds: targetAppUserIds,
          isImmediate,
          scheduledAt,
          endAt,
          isDraft,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "配信失敗");
      router.push("/store-settings/push");
    } catch (e: any) {
      alert(e?.message || "送信エラー");
      setSending(false);
    }
  };

  return (
    <div className="push-root">
      <GuideTour
        storageKey="tour_push_new_v1"
        steps={[
          { title: "PUSH通知・お知らせの作成", body: "配信を作る手順をご案内します。①店舗選択 → ②内容入力 → ③ターゲット抽出 → ④スケジュール の順です。" },
          { selector: '[data-tour="store"]', title: "① 配信店舗", body: "配信先の店舗を選びます。複数店舗の担当者は複数選択でき、管理者はブランド・直営/FC・エリアで絞り込めます。" },
          { selector: '[data-tour="content"]', title: "② 通知コンテンツ", body: "タイトル・本文・お知らせ画像を入力します。「AIで文章作成」で指示から文面を自動生成できます。" },
          { selector: '[data-tour="target"]', title: "③ ターゲット抽出", body: "性別・在籍状況・契約種別・契約形態・オプション・未納などで配信対象を絞り、「条件で名簿を作成」で対象者を確定します。" },
          { selector: '[data-tour="preview"]', title: "プレビュー", body: "ロック画面のPUSH通知と、アプリ内お知らせの2種類をリアルタイムで確認できます。" },
          { selector: '[data-tour="schedule"]', title: "④ スケジュール", body: "即時送信または予約配信を選び、右上の「内容を確認する」から送信します。下書き保存も可能です。" },
        ]}
      />
      <AdminLoadingOverlay visible={sending} />

      <header className="push-header">
        <div className="push-header-inner">
          <div className="push-header-left">
            <Link href="/store-settings/push" className="push-back-btn" title="戻る">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
            <h1 className="push-header-title">新規配信作成</h1>
          </div>
          <div className="push-header-left" style={{ gap: 12 }}>
            <button
              className="push-modal-cancel"
              onClick={() => submit(true)}
              disabled={!clubCode || !title || !bodyText || sending}
              title="送信せずに下書き保存 (アプリには表示されません)"
            >
              下書き保存
            </button>
            <button
              className="push-primary-btn"
              onClick={requestConfirm}
              disabled={targetAppUserIds.length === 0 || !title}
            >
              内容を確認する ({targetAppUserIds.length}件)
            </button>
          </div>
        </div>
      </header>

      <main className="push-new-main">
        <div className="push-new-grid">
          {/* COLUMN 1: 設定 */}
          <aside className="push-col-config">
            <div className="push-step-group" data-tour="store">
              <div className="push-step-header">
                <div className="push-step-badge">1</div>
                <h3>配信店舗</h3>
              </div>
              <div className="push-field">
                <label>担当店舗（複数選択可） <span className="req">*</span></label>
                {storeLoading ? (
                  <div className="push-hint">読み込み中...</div>
                ) : stores.length === 0 ? (
                  <div className="push-hint">担当店舗が割り当てられていません。管理者にお問い合わせください。</div>
                ) : stores.length === 1 ? (
                  <div className="push-input" style={{ background: "#f8fafc" }}>
                    {stores[0].clubName}（{brandTheme(stores[0].brand).label} / {stores[0].clubCode}）
                  </div>
                ) : (
                  <StorePicker stores={stores} selected={selectedClubs} onChange={setSelectedClubs} />
                )}
                {selectedClubs.length > 1 && (
                  <div className="push-hint">選択中 {selectedClubs.length} 店舗に配信します（プレビュー/AIは代表店舗 {clubCode} 基準）。</div>
                )}
              </div>
            </div>

            <div className="push-divider" />

            <div className="push-step-group" data-tour="content">
              <div className="push-step-header">
                <div className="push-step-badge">2</div>
                <h3>通知コンテンツ</h3>
              </div>
              <div className="push-field">
                <label>タイトル <span className="req">*</span></label>
                <input
                  type="text" className="push-input" value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="通知のタイトル"
                />
              </div>
              <div className="push-field">
                <label>本文 <span className="req">*</span></label>
                <ContentBlocksEditor value={blocks} onChange={setBlocks} disabled={sending} />
              </div>
              <div className="push-hint">
                ※ 画像はアプリの「お知らせ欄」に、挿入した位置・配置で表示されます（PUSH通知バナーは本文テキストのみ）。
              </div>
              <div className="push-field" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginTop: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>✨ AIで文章・お知らせHTMLを作成</label>
                <textarea
                  className="push-textarea" rows={2} value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="例: 新マシン導入のお知らせを、ワクワクする感じで"
                />
                <button
                  type="button" className="push-extract-btn" style={{ marginTop: 8 }}
                  onClick={generateAiText} disabled={aiGenerating}
                >
                  {aiGenerating ? "生成中..." : htmlBody ? "AIで作り直す" : "AIでタイトル・本文・お知らせHTMLを作成"}
                </button>
                {aiError && <div className="push-hint" style={{ color: "#dc2626" }}>{aiError}</div>}
                {htmlBody && (
                  <div className="push-hint" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, color: "#059669", fontWeight: 700 }}>
                    <span>✓ AI生成のお知らせHTMLを使用中（プレビュー反映）</span>
                    <button type="button" onClick={() => setHtmlBody("")} style={{ background: "none", border: "none", color: "#dc2626", fontWeight: 700, cursor: "pointer", fontSize: 11 }}>解除</button>
                  </div>
                )}
                <div className="push-hint" style={{ marginTop: 6 }}>指示をもとにタイトル・本文・お知らせ欄のデザインHTMLを生成し、入力欄とお知らせプレビューに反映します。「解除」でブロック本文に戻せます。生成後もそのまま編集できます。</div>
              </div>
            </div>

            <div className="push-divider" />

            <div className="push-step-group" data-tour="target">
              <div className="push-step-header"><div className="push-step-badge">3</div><h3>ターゲット抽出</h3></div>
              <div className="push-filter-box">
                {groups.length > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, marginBottom: 10 }}>
                    <span style={{ color: "#64748b", fontWeight: 700 }}>グループ間の結合:</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="radio" checked={groupOp === "OR"} onChange={() => setGroupOp("OR")} /> OR（いずれか）
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="radio" checked={groupOp === "AND"} onChange={() => setGroupOp("AND")} /> AND（すべて）
                    </label>
                  </div>
                )}
                {groups.map((g, gi) => (
                  <div key={gi}>
                    {gi > 0 && (
                      <div style={{ textAlign: "center", margin: "8px 0", fontSize: 11, fontWeight: 800, color: "#0f172a" }}>
                        — {groupOp} —
                      </div>
                    )}
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, background: "#fff", marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>条件グループ {gi + 1}</span>
                        {groups.length > 1 && (
                          <button type="button" onClick={() => removeGroup(gi)} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            削除
                          </button>
                        )}
                      </div>
                      <ConditionGroupForm
                        group={g}
                        onChange={(patch) => updateGroup(gi, patch)}
                        contractTypes={CONTRACT_TYPES}
                        contractTypeOptions={clubCode ? ctOptions : undefined}
                        contractTypesLoading={ctLoading}
                        contractFormOptions={clubCode ? cfOptions.filter((o) => o.group !== "オプション契約") : undefined}
                        contractFormsLoading={cfLoading}
                        contractOptionOptions={clubCode ? cfOptions.filter((o) => o.group === "オプション契約") : undefined}
                        cls="push"
                      />
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addGroup} style={{ width: "100%", border: "1px dashed #cbd5e1", background: "#f8fafc", color: "#0f172a", padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
                  ＋ 条件グループを追加（{groupOp}）
                </button>
                <button className="push-extract-btn" onClick={handleExtract} disabled={isExtracting || !clubCode}>
                  {isExtracting ? "検索中..." : "条件で名簿を作成"}
                </button>
                {extractError && <div className="push-hint" style={{ color: "#dc2626" }}>{extractError}</div>}
              </div>
            </div>

            <div className="push-divider" />

            <div className="push-step-group" data-tour="schedule">
              <div className="push-step-header"><div className="push-step-badge">4</div><h3>スケジュール</h3></div>
              <div className="push-radio-box">
                <label className={isImmediate ? "active" : ""}>
                  <input type="radio" checked={isImmediate} onChange={() => setIsImmediate(true)} /> 即時送信
                </label>
                <label className={!isImmediate ? "active" : ""}>
                  <input type="radio" checked={!isImmediate} onChange={() => setIsImmediate(false)} /> 予約配信
                </label>
              </div>
              {!isImmediate && (
                <div className="push-row-2 mt-2">
                  <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
                  <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
                </div>
              )}
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8" }}>
                ※ 配信可能時間は 8:00〜21:00 です。NGワードを含む内容は送信できません。
              </p>

              {/* 掲載終了(お知らせの表示期間の終わり)。空なら既定90日。 */}
              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>掲載終了日時（任意）</label>
                <div className="push-row-2">
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "#94a3b8" }}>
                  指定日時にアプリのお知らせ掲載を終了します。時刻を空にすると 23:59 まで。<b>未指定は約90日</b>で自動終了します。
                </p>
              </div>
            </div>

            {/* 「詳しくはこちら」ボタンのリンク先URL */}
            <div className="push-step-group">
              <div className="push-step-header"><div className="push-step-badge" style={{ background: "#8b5cf6" }}>→</div><h3>「詳しくはこちら」リンク（任意）</h3></div>
              <input
                type="url"
                className="push-input"
                placeholder="https://example.com/campaign （LPのURL）"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                style={{ width: "100%" }}
              />
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#94a3b8" }}>
                入力すると、アプリのお知らせに「詳しくはこちら」ボタンが表示され、このURL（LP等）へ遷移します。空欄ならボタンは表示されません。
              </p>
            </div>

            <div className="push-step-group">
              <div className="push-step-header"><div className="push-step-badge" style={{ background: "#0ea5e9" }}>✓</div><h3>テスト送信</h3></div>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "#64748b" }}>本番前に、指定会員番号のアプリへ今の内容を即時送信して確認できます（複数可・カンマ/改行区切り）。</p>
              <textarea className="push-textarea" rows={2} placeholder="1234567890, ..." value={testMembers} onChange={(e) => setTestMembers(e.target.value)} />
              <button type="button" className="push-primary-btn" style={{ marginTop: 6, width: "100%", justifyContent: "center", background: "#0ea5e9" }}
                disabled={testingPush || !title || !bodyText || !testMembers.trim()} onClick={sendTestPush}>
                {testingPush ? "テスト送信中..." : "テスト送信"}
              </button>
            </div>
          </aside>

          {/* COLUMN 2: リスト */}
          <section className="push-col-list">
            <div className="push-panel-header-sticky">
              宛先リスト（配信可能 {deliverableMembers.length} 名／うち選択 {targetAppUserIds.length} 名）
              {extractMeta ? <span style={{ fontWeight: 500, color: "#94a3b8" }}> ※抽出 {extractMeta.totalCount} 名中、通知許諾のある人のみ表示</span> : ""}
            </div>
            <div className="push-list-container">
              {deliverableMembers.length > 0 ? (
                <table className="push-list-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.size > 0 && selectedMemberIds.size === deliverableMembers.length}
                          onChange={() => {
                            if (selectedMemberIds.size === deliverableMembers.length) setSelectedMemberIds(new Set());
                            else setSelectedMemberIds(new Set(deliverableMembers.map((m) => m.memberNo)));
                          }}
                        />
                      </th>
                      <th>会員情報</th>
                      <th>区分/属性</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedMembers.map((m) => {
                      const status = m.withdrawnAt ? "退会済" : "在籍中";
                      return (
                        <tr key={m.memberNo} className={selectedMemberIds.has(m.memberNo) ? "" : "excluded"}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedMemberIds.has(m.memberNo)}
                              onChange={() => toggleSelectMember(m.memberNo)}
                            />
                          </td>
                          <td>
                            <div className="push-u-info">
                              <strong>{m.name}</strong>
                              <small>会員番号:{m.memberNo}{m.kana ? ` | ${m.kana}` : ""}</small>
                            </div>
                          </td>
                          <td>
                            <div className="push-u-meta">
                              <span className={`status-badge ${status === "退会済" ? "leaver" : "stable"}`}>{status}</span>
                              {m.contractType && <span className="contract-chip">{m.contractType}</span>}
                              {m.age != null && <span className="visit-count">{m.age}歳</span>}
                              {m.gender && <span className="visit-count">{m.gender === "male" ? "男" : "女"}</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : extractedMembers.length > 0 ? (
                <div className="push-empty-state">抽出されましたが、通知許諾のある配信可能な会員がいません。</div>
              ) : (
                <div className="push-empty-state">STEP 3 で条件を指定して<br />「名簿を作成」してください</div>
              )}
            </div>
            {deliverableMembers.length > itemsPerPage && (
              <div className="push-list-pager">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>&lt;</button>
                <span>{currentPage} / {Math.ceil(deliverableMembers.length / itemsPerPage)}</span>
                <button disabled={currentPage >= Math.ceil(deliverableMembers.length / itemsPerPage)} onClick={() => setCurrentPage((p) => p + 1)}>&gt;</button>
              </div>
            )}
          </section>

          {/* COLUMN 3: プレビュー (2種: ロック画面PUSH / アプリ内お知らせ) */}
          <section className="push-col-preview" data-tour="preview">
            <div className="push-panel-header-sticky">プレビュー（{theme.label}）</div>
            <div className="push-preview-frame push-preview-dual">
              {/* ① ロック画面に出る PUSH 通知バナー */}
              <div className="push-preview-item">
                <div className="push-preview-caption">
                  <span className="push-preview-badge lock">ロック画面</span>
                  PUSH通知バナー
                </div>
                <div className="push-phone-mockup lock">
                  <div className="push-notch"></div>
                  <div className="push-screen lock-screen">
                    <div className="push-lock-time">
                      <div className="push-lock-clock">10:41</div>
                      <div className="push-lock-date">7月13日 日曜日</div>
                    </div>
                    <div className="push-notification-bubble">
                      <div className="push-bubble-header">
                        <div className="push-app-info">
                          <div className="push-app-icon" style={{ background: theme.color }}></div>
                          <span className="push-app-name">{theme.appName}</span>
                        </div>
                        <span className="push-now">たった今</span>
                      </div>
                      <div className="push-bubble-content">
                        <div className="push-bubble-title">{title || "タイトル"}</div>
                        <div className="push-bubble-body">{bodyText || "ここに通知の本文が表示されます。"}</div>
                      </div>
                    </div>
                    <div className="push-lock-hint">※ ロック画面・通知センターにはテキストのみ表示されます</div>
                  </div>
                </div>
              </div>

              {/* ② アプリを開くと「お知らせ」欄に出る詳細 */}
              <div className="push-preview-item">
                <div className="push-preview-caption">
                  <span className="push-preview-badge app" style={{ background: theme.color }}>アプリ内</span>
                  お知らせ画面
                </div>
                <div className="push-phone-mockup app">
                  <div className="push-notch"></div>
                  <div className="push-screen app-screen">
                    <div className="push-app-bar" style={{ background: theme.color }}>
                      <span className="push-app-bar-back">‹</span>
                      <span className="push-app-bar-title">お知らせ</span>
                      <span />
                    </div>
                    <div className="push-app-notice">
                      <div className="push-app-notice-title">{title || "タイトル"}</div>
                      <div className="push-app-notice-date">2026/07/13 10:41</div>
                      {noticeHtml ? (
                        <div className="push-app-notice-body" dangerouslySetInnerHTML={{ __html: noticeHtml }} />
                      ) : (
                        <div className="push-app-notice-body">ここにお知らせ本文が表示されます。</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* 配信前最終確認モーダル */}
      {confirmOpen && (
        <div className="push-confirm-overlay" onClick={() => !sending && setConfirmOpen(false)}>
          <div className="push-confirm-window" onClick={(e) => e.stopPropagation()}>
            <header className="push-confirm-header">
              <h3>配信内容の最終確認</h3>
              <p>送信したら取り消せません。内容と送信時刻を確認してください。</p>
            </header>
            <div className="push-confirm-body">
              <div className="push-confirm-row">
                <span className="push-confirm-label">配信店舗</span>
                <span className="push-confirm-val">{selectedClubs.length === 1 ? `${selectedStore?.clubName}（${theme.label}）` : `${selectedClubs.length} 店舗（${selectedClubs.join(", ")}）`}</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">タイトル</span>
                <span className="push-confirm-val">{title}</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">本文</span>
                <span className="push-confirm-val multiline">{bodyText}</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">配信対象</span>
                <span className="push-confirm-val emphasis">{targetAppUserIds.length} 名</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">送信時刻</span>
                <span className={`push-confirm-val ${isImmediate ? "emphasis warn" : "emphasis"}`}>{scheduledLabel}</span>
              </div>
              <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, lineHeight: 1.6, background: isImmediate ? "#fffbeb" : "#eff6ff", border: `1px solid ${isImmediate ? "#fde68a" : "#bfdbfe"}`, color: isImmediate ? "#92400e" : "#1e40af" }}>
                {isImmediate
                  ? "⚠️ 即時配信は送信後に取り消せません。内容をご確認ください。"
                  : "予約配信は、送信前なら履歴の「予約」から編集・削除できます。"}
              </div>
            </div>
            <footer className="push-confirm-footer">
              <button className="push-modal-cancel" onClick={() => setConfirmOpen(false)} disabled={sending}>戻って修正する</button>
              <button className="push-modal-submit" onClick={() => submit(false)} disabled={sending}>
                {sending ? "送信中..." : isImmediate ? "今すぐ送信する" : "予約配信を確定する"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
