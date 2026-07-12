// app/store-settings/push/new/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import ConditionGroupForm, { type CondGroup, newCondGroup } from "@/components/ConditionGroupForm";
import { type ContractTypeOption } from "@/components/ContractTypePicker";

// 契約種別は店舗選択時に member-search(Oracle/会員区分) から動的取得する。
// 初期グループ生成用の空マスタ (店舗未選択時)。
const CONTRACT_TYPES: string[] = [];

type StoreItem = { clubCode: string; clubName: string; brand: string };
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

  // 店舗コンテキスト (ログインユーザーの担当クラブ)
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [clubCode, setClubCode] = useState("");
  const [storeLoading, setStoreLoading] = useState(true);
  const selectedStore = useMemo(() => stores.find((s) => s.clubCode === clubCode) ?? null, [stores, clubCode]);
  const brand = selectedStore?.brand ?? "FIT365";
  const theme = useMemo(() => brandTheme(brand), [brand]);

  // フォーム
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState(""); // お知らせ欄に表示する画像 (S3 公開URL)
  const [imgUploading, setImgUploading] = useState(false);
  const [imgError, setImgError] = useState("");
  // AI(Claude on Bedrock) による タイトル・本文 文章生成
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  // 条件グループ (グループ内は AND、グループ間は groupOp)
  const [groups, setGroups] = useState<CondGroup[]>([newCondGroup(CONTRACT_TYPES)]);
  const [groupOp, setGroupOp] = useState<"OR" | "AND">("OR");
  // 店舗に属する契約種別(会員区分)。店舗選択で動的取得。
  const [ctOptions, setCtOptions] = useState<ContractTypeOption[]>([]);
  const [ctLoading, setCtLoading] = useState(false);
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
        }));
        setStores(list);
        if (list.length === 1) setClubCode(list[0].clubCode); // 単一担当なら自動選択
      } catch {
        /* noop */
      } finally {
        setStoreLoading(false);
      }
    })();
  }, []);

  // 店舗選択 → その店舗に属する契約種別(会員区分)を取得。既定は全種別を選択状態にする。
  useEffect(() => {
    if (!clubCode) {
      setCtOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setCtLoading(true);
      try {
        const res = await fetch(`/api/store-settings/members/contract-types?clubCode=${encodeURIComponent(clubCode)}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const opts: ContractTypeOption[] = (data.contractTypes || []).map((c: any) => ({
          name: String(c.name),
          activeCount: Number(c.activeCount || 0),
          totalCount: Number(c.totalCount || 0),
        }));
        setCtOptions(opts);
        // 既定: 店舗の全契約種別を対象にする
        const allNames = opts.map((o) => o.name);
        setGroups((prev) => prev.map((g) => ({ ...g, contractTypes: allNames })));
      } catch {
        if (!cancelled) setCtOptions([]);
      } finally {
        if (!cancelled) setCtLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubCode]);

  // お知らせ画像: S3 へアップロードして公開URLを imageUrl にセット
  const handleImageUpload = async (file: File | null) => {
    if (!file) return;
    setImgError("");
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      setImgError("PNG / JPEG / WebP / GIF のみアップロードできます。");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImgError("ファイルサイズは 10MB 以内にしてください。");
      return;
    }
    setImgUploading(true);
    try {
      const initRes = await fetch("/api/store-settings/media/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      const init = await initRes.json();
      if (!initRes.ok || !init.ok) throw new Error(init?.error || "アップロード準備に失敗しました");
      const putRes = await fetch(init.presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("S3 へのアップロードに失敗しました");
      setImageUrl(init.publicUrl);
    } catch (e: any) {
      setImgError(e?.message || "アップロードに失敗しました");
    } finally {
      setImgUploading(false);
    }
  };

  const handleExtract = async () => {
    if (!clubCode) {
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
          clubCode,
          groupOp,
          groups,
          limit: 1000,
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

  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return extractedMembers.slice(start, start + itemsPerPage);
  }, [extractedMembers, currentPage]);

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
    if (!clubCode) return alert("担当店舗を選択してください。");
    if (!title || !body) return alert("タイトルと本文は必須です。");
    if (targetAppUserIds.length === 0) return alert("配信可能な対象を選択してください。");
    if (!isImmediate && (!scheduledDate || !scheduledTime)) {
      return alert("予約配信の場合は送信日時を指定してください。");
    }
    setConfirmOpen(true);
  };

  // AIで文章作成: タイトル・本文を生成して各入力欄へ反映する
  const generateAiText = async () => {
    if (!aiPrompt.trim() && !body.trim() && !title.trim()) {
      setAiError("作りたい内容の指示、またはタイトル/本文を入力してください。");
      return;
    }
    setAiGenerating(true);
    setAiError("");
    try {
      const res = await fetch("/api/store-settings/push/generate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, subject: title, body, brand }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAiError(data?.error || "AI生成に失敗しました");
        return;
      }
      if (data.title) setTitle(data.title);
      if (data.body) setBody(data.body);
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
      const res = await fetch("/api/store-settings/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clubCode,
          brand,
          title,
          body,
          imageUrl: imageUrl || undefined,
          targetType: "CONDITION",
          appUserIds: targetAppUserIds,
          isImmediate,
          scheduledAt,
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
              disabled={!clubCode || !title || !body || sending}
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
            <div className="push-step-group">
              <div className="push-step-header">
                <div className="push-step-badge">1</div>
                <h3>配信店舗</h3>
              </div>
              <div className="push-field">
                <label>担当店舗 <span className="req">*</span></label>
                {storeLoading ? (
                  <div className="push-hint">読み込み中...</div>
                ) : stores.length === 0 ? (
                  <div className="push-hint">担当店舗が割り当てられていません。管理者にお問い合わせください。</div>
                ) : stores.length === 1 ? (
                  <div className="push-input" style={{ background: "#f8fafc" }}>
                    {selectedStore?.clubName}（{brandTheme(brand).label} / {clubCode}）
                  </div>
                ) : (
                  <select className="push-input" value={clubCode} onChange={(e) => setClubCode(e.target.value)}>
                    <option value="">店舗を選択</option>
                    {stores.map((s) => (
                      <option key={s.clubCode} value={s.clubCode}>
                        {s.clubName}（{brandTheme(s.brand).label} / {s.clubCode}）
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="push-divider" />

            <div className="push-step-group">
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
                <textarea
                  className="push-textarea" rows={4} value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="通知の内容..."
                />
              </div>
              <div className="push-field">
                <label>お知らせ画像（任意）</label>
                {imageUrl ? (
                  <div className="push-img-uploaded">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="お知らせ画像" className="push-img-thumb" />
                    <div className="push-img-actions">
                      <span className="push-img-ok">✓ アップロード済み</span>
                      <button type="button" className="push-img-remove" onClick={() => { setImageUrl(""); setImgError(""); }}>削除</button>
                    </div>
                  </div>
                ) : (
                  <label className={`push-img-drop${imgUploading ? " uploading" : ""}`}>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      style={{ display: "none" }}
                      disabled={imgUploading}
                      onChange={(e) => { handleImageUpload(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }}
                    />
                    {imgUploading ? (
                      <span>アップロード中…</span>
                    ) : (
                      <>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <path d="M17 8l-5-5-5 5" />
                          <path d="M12 3v12" />
                        </svg>
                        <span>クリックして画像を選択</span>
                        <small>PNG / JPEG / WebP / GIF・10MBまで</small>
                      </>
                    )}
                  </label>
                )}
                {imgError && <div className="push-hint" style={{ color: "#dc2626" }}>{imgError}</div>}
              </div>
              <div className="push-hint">
                ※ 画像・装飾はアプリの「お知らせ欄」に表示されます。
              </div>
              <div className="push-field" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginTop: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>✨ AIで文章作成</label>
                <textarea
                  className="push-textarea" rows={2} value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="例: 新マシン導入のお知らせを、ワクワクする感じで"
                />
                <button
                  type="button" className="push-extract-btn" style={{ marginTop: 8 }}
                  onClick={generateAiText} disabled={aiGenerating}
                >
                  {aiGenerating ? "生成中..." : "AIでタイトル・本文を作成"}
                </button>
                {aiError && <div className="push-hint" style={{ color: "#dc2626" }}>{aiError}</div>}
                <div className="push-hint" style={{ marginTop: 6 }}>指示をもとにタイトルと本文を生成し、上の入力欄へ反映します。生成後もそのまま編集できます。</div>
              </div>
            </div>

            <div className="push-divider" />

            <div className="push-step-group">
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

            <div className="push-step-group">
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
            </div>
          </aside>

          {/* COLUMN 2: リスト */}
          <section className="push-col-list">
            <div className="push-panel-header-sticky">
              宛先リスト精査 (配信可能 {targetAppUserIds.length} 名
              {extractMeta ? ` / 抽出 ${extractMeta.totalCount} 名` : ""})
            </div>
            <div className="push-list-container">
              {extractedMembers.length > 0 ? (
                <table className="push-list-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={
                            selectedMemberIds.size > 0 &&
                            selectedMemberIds.size === extractedMembers.filter((m) => m.deliverable).length
                          }
                          onChange={() => {
                            const deliverable = extractedMembers.filter((m) => m.deliverable);
                            if (selectedMemberIds.size === deliverable.length) setSelectedMemberIds(new Set());
                            else setSelectedMemberIds(new Set(deliverable.map((m) => m.memberNo)));
                          }}
                        />
                      </th>
                      <th>会員情報</th>
                      <th>区分/属性</th>
                      <th style={{ width: 40 }}>配信</th>
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
                              disabled={!m.deliverable}
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
                          <td>
                            {m.deliverable ? (
                              <span className="status-badge stable" title="配信可能">可</span>
                            ) : (
                              <span className="unpaid-dot" title="通知トークン未登録/未許諾">×</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="push-empty-state">STEP 3 で条件を指定して<br />「名簿を作成」してください</div>
              )}
            </div>
            {extractedMembers.length > itemsPerPage && (
              <div className="push-list-pager">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>&lt;</button>
                <span>{currentPage} / {Math.ceil(extractedMembers.length / itemsPerPage)}</span>
                <button disabled={currentPage >= Math.ceil(extractedMembers.length / itemsPerPage)} onClick={() => setCurrentPage((p) => p + 1)}>&gt;</button>
              </div>
            )}
          </section>

          {/* COLUMN 3: プレビュー (2種: ロック画面PUSH / アプリ内お知らせ) */}
          <section className="push-col-preview">
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
                        <div className="push-bubble-body">{body || "ここに通知の本文が表示されます。"}</div>
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
                      {imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl} alt="" className="push-app-notice-img" />
                      )}
                      <div className="push-app-notice-body">{body || "ここにお知らせ本文が表示されます。"}</div>
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
                <span className="push-confirm-val">{selectedStore?.clubName}（{theme.label}）</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">タイトル</span>
                <span className="push-confirm-val">{title}</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">本文</span>
                <span className="push-confirm-val multiline">{body}</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">配信対象</span>
                <span className="push-confirm-val emphasis">{targetAppUserIds.length} 名</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">送信時刻</span>
                <span className={`push-confirm-val ${isImmediate ? "emphasis warn" : "emphasis"}`}>{scheduledLabel}</span>
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
