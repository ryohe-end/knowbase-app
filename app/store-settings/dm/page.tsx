// app/store-settings/dm/page.tsx
"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import ConditionGroupForm, { type CondGroup, newCondGroup } from "@/components/ConditionGroupForm";
import type { DmNotification } from "@/types/dmNotification";

// 契約種別マスタ (実マスタ提供までの暫定。member-search 側 e.契約形態名 と突合予定)
const CONTRACT_TYPES = ["レギュラー", "ナイト", "デイ", "ホリデー", "学生", "家族", "法人", "1day/OTP"];

type StoreItem = { clubCode: string; clubName: string; brand: string };
// DM 宛先の統一モデル (抽出 or CSV)
type DmRecipient = {
  key: string; // 選択キー (memberNo or csv:email)
  memberNo: string;
  name: string;
  email: string | null;
  contractType: string;
  status: string; // 在籍中/退会済
  source: "extract" | "csv";
  deliverable: boolean; // メール保有=配信可能
};

const formatDate = (iso: string) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
};

export default function DmSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notifications, setNotifications] = useState<DmNotification[]>([]);
  
  // 店舗コンテキスト (ログインユーザーの担当クラブ)
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [clubCode, setClubCode] = useState("");
  const selectedStore = useMemo(() => stores.find((s) => s.clubCode === clubCode) ?? null, [stores, clubCode]);
  const storeBrand = (selectedStore?.brand || "JOYFIT").toUpperCase().startsWith("JOYFIT") ? "JOYFIT" : "FIT365";
  const storeName = selectedStore?.clubName ?? "";
  const [extractError, setExtractError] = useState("");

  // モーダル・表示モード
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"create" | "detail">("create");
  const [selectedHistory, setSelectedHistory] = useState<DmNotification | null>(null);

  // フォームState
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  // AI(Claude on Bedrock) による HTML 生成
  const [htmlBody, setHtmlBody] = useState(""); // 生成済み完成HTML(空=通常のテキストメール)
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  
  // 抽出条件
  // 条件グループ (グループ内は AND、グループ間は groupOp)
  const [groups, setGroups] = useState<CondGroup[]>([newCondGroup(CONTRACT_TYPES)]);
  const [groupOp, setGroupOp] = useState<"OR" | "AND">("OR");
  const updateGroup = (i: number, patch: Partial<CondGroup>) =>
    setGroups((prev) => prev.map((g, gi) => (gi === i ? { ...g, ...patch } : g)));
  const addGroup = () => setGroups((prev) => [...prev, newCondGroup(CONTRACT_TYPES)]);
  const removeGroup = (i: number) => setGroups((prev) => (prev.length <= 1 ? prev : prev.filter((_, gi) => gi !== i)));

  // リストState
  const [extractedMembers, setExtractedMembers] = useState<DmRecipient[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;
  const csvInputRef = useRef<HTMLInputElement>(null);

  // スケジュールState
  const [isImmediate, setIsImmediate] = useState(true);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const resDm = await fetch("/api/store-settings/dm", { cache: "no-store" });
      if (resDm.ok) {
        const data = await resDm.json();
        setNotifications(data.notifications || []);
      }
      // 担当店舗 (stores API はユーザーの clubCodes でフィルタ済み)
      const resStores = await fetch("/api/store-settings/stores", { cache: "no-store" });
      if (resStores.ok) {
        const data = await resStores.json();
        const list: StoreItem[] = (data.stores || []).map((s: any) => ({
          clubCode: String(s.clubCode),
          clubName: s.clubName,
          brand: s.brand,
        }));
        setStores(list);
        if (list.length === 1) setClubCode(list[0].clubCode);
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  // --- アクション ---

  const openCreateModal = () => {
    setViewMode("create");
    setSelectedHistory(null);
    resetForm();
    setIsModalOpen(true);
  };

  const openDetailModal = (n: DmNotification) => {
    setViewMode("detail");
    setSelectedHistory(n);
    setSubject(n.subject);
    setBody(n.body);
    setImageUrl(n.imageUrl || "");
    setIsModalOpen(true);
  };

  const handleExtract = async () => {
    if (!clubCode) { setExtractError("担当店舗を選択してください。"); return; }
    setIsExtracting(true);
    setExtractError("");
    try {
      const res = await fetch("/api/store-settings/members/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryType: "dm",
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
        return;
      }
      const recs: DmRecipient[] = (data.members || []).map((m: any) => ({
        key: `m:${m.memberNo}`,
        memberNo: m.memberNo,
        name: m.name,
        email: m.email ?? null,
        contractType: m.contractType ?? "",
        status: m.withdrawnAt ? "退会済" : "在籍中",
        source: "extract" as const,
        deliverable: !!m.deliverable,
      }));
      // CSV 由来は残し、抽出分を統合 (メール重複排除)
      mergeRecipients(recs);
      setCurrentPage(1);
    } catch {
      setExtractError("抽出リクエストに失敗しました。");
    } finally {
      setIsExtracting(false);
    }
  };

  // 宛先の統合 (メールで重複排除)。既存を保ちつつ追加。
  const mergeRecipients = (incoming: DmRecipient[]) => {
    setExtractedMembers((prev) => {
      const byEmail = new Map<string, DmRecipient>();
      const push = (r: DmRecipient) => {
        const e = (r.email || "").toLowerCase();
        const k = e || r.key;
        if (!byEmail.has(k)) byEmail.set(k, r);
      };
      prev.forEach(push);
      incoming.forEach(push);
      const merged = Array.from(byEmail.values());
      setSelectedMemberIds(new Set(merged.filter((m) => m.deliverable).map((m) => m.key)));
      return merged;
    });
  };

  // CSV アップロード (会員番号,メールアドレス,氏名)
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "").replace(/^﻿/, "");
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const rows = lines.slice(lines[0]?.includes("メール") || lines[0]?.includes("email") ? 1 : 0);
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const recs: DmRecipient[] = [];
      for (const line of rows) {
        const cols = line.split(",").map((c) => c.trim());
        const [memberNo = "", email = "", name = ""] = cols;
        if (!emailRe.test(email)) continue;
        recs.push({
          key: `c:${email.toLowerCase()}`,
          memberNo: memberNo || "-",
          name: name || "(CSV)",
          email,
          contractType: "",
          status: "CSV",
          source: "csv",
          deliverable: true,
        });
      }
      if (recs.length === 0) setExtractError("CSVから有効なメール宛先が読み取れませんでした。");
      else { setExtractError(""); mergeRecipients(recs); setCurrentPage(1); }
      if (csvInputRef.current) csvInputRef.current.value = "";
    };
    reader.readAsText(file, "utf-8");
  };

  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return extractedMembers.slice(start, start + itemsPerPage);
  }, [extractedMembers, currentPage]);

  const toggleSelectMember = (id: string) => {
    const next = new Set(selectedMemberIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedMemberIds(next);
  };


  // 送信対象 (選択済み & 配信可能 & メール保有)
  const targetRecipients = useMemo(
    () =>
      extractedMembers
        .filter((m) => selectedMemberIds.has(m.key) && m.deliverable && m.email)
        .map((m) => ({ email: m.email as string, name: m.name })),
    [extractedMembers, selectedMemberIds]
  );

  const generateHtml = async () => {
    if (!aiPrompt.trim() && !body.trim()) {
      setAiError("作りたいメールの指示、または下書き本文を入力してください。");
      return;
    }
    setAiGenerating(true);
    setAiError("");
    try {
      const res = await fetch("/api/store-settings/dm/generate-html", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, subject, body, imageUrl: imageUrl || undefined, brand: storeBrand }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAiError(data?.error || "AI生成に失敗しました");
        return;
      }
      setHtmlBody(data.html);
    } catch {
      setAiError("AI生成リクエストに失敗しました。");
    } finally {
      setAiGenerating(false);
    }
  };

  const submit = async (isDraft: boolean) => {
    if (!clubCode) return alert("担当店舗を選択してください。");
    if (!subject || !body) return alert("件名と本文は必須です。");
    if (targetRecipients.length === 0) return alert("配信可能な宛先(メール)がありません。");
    setSending(true);
    try {
      const scheduledAt =
        !isImmediate && scheduledDate && scheduledTime ? `${scheduledDate} ${scheduledTime}` : undefined;
      const res = await fetch("/api/store-settings/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clubCode,
          brand: storeBrand,
          subject,
          body,
          imageUrl: imageUrl || undefined,
          bodyHtml: htmlBody || undefined,
          recipients: targetRecipients,
          isImmediate,
          scheduledAt,
          isDraft,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "配信失敗");
      alert(isDraft ? "下書きを保存しました（送信されていません）。" : data.scheduled ? "予約配信を登録しました。" : `${data.sentCount}件に送信しました。`);
      setIsModalOpen(false);
      setSending(false);
      resetForm();
      fetchData();
    } catch (e: any) {
      alert(e?.message || "送信エラー");
      setSending(false);
    }
  };

  const downloadCsvTemplate = () => {
    window.open("/api/store-settings/dm/csv-template", "_blank");
  };

  const resetForm = () => {
    setSubject(""); setBody(""); setImageUrl("");
    setHtmlBody(""); setAiPrompt(""); setAiError("");
    setGroups([newCondGroup(CONTRACT_TYPES)]); setGroupOp("OR");
    setExtractedMembers([]); setSelectedMemberIds(new Set());
    setIsImmediate(true); setScheduledDate(""); setScheduledTime("");
    setExtractError("");
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  return (
    <div className="dm-root">
      <AdminLoadingOverlay visible={loading || sending} />
      
      {/* ヘッダー (戻るボタン修正済み) */}
      <header className="dm-header">
        <div className="dm-header-inner">
          <div className="dm-header-left">
            <Link href="/store-settings" className="dm-back-btn" title="戻る">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </Link>
            <h1 className="dm-header-title">DM配信管理</h1>
          </div>
          <button className="dm-primary-btn" onClick={openCreateModal}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>新規配信作成</span>
          </button>
        </div>
      </header>

      <main className="dm-main-content">
        <section className="dm-history-section">
          <div className="dm-table-container">
            <table className="dm-history-table">
              <thead>
                <tr>
                  <th>送信日時</th>
                  <th>メール件名</th>
                  <th>ステータス</th>
                  <th>対象件数</th>
                  <th>到達</th>
                  <th>開封率</th>
                </tr>
              </thead>
              <tbody>
                {notifications.length === 0 ? (
                  <tr><td colSpan={6} className="empty-row">配信履歴はありません</td></tr>
                ) : (
                  notifications.map((n) => (
                    <tr key={n.id} onClick={() => openDetailModal(n)} className="clickable-row">
                      <td className="date-cell">{formatDate(n.scheduledAt)}</td>
                      <td className="subj-cell">{n.subject}</td>
                      <td><span className={`status-pill ${n.status.toLowerCase()}`}>{n.status === 'SENT' ? '完了' : '予約中'}</span></td>
                      <td>{n.stats?.targetCount || 0}</td>
                      <td>{n.stats?.deliveredCount || 0}</td>
                      <td>{n.stats ? `${Math.round((n.stats.openCount / n.stats.deliveredCount)*100)}%` : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* モーダル */}
      {isModalOpen && (
        <div className="dm-modal-overlay">
          <div className="dm-modal-window">
            
            {/* 3カラムレイアウト */}
            <div className="dm-modal-body-tri">
              
              {/* --- COLUMN 1: 設定 (作成時:編集可 / 詳細時:読取専用) --- */}
              <aside className="dm-col-config">
                <div className="dm-panel-scroll">
                  
                  {/* STEP 1: コンテンツ */}
                  <div className="dm-step-group">
                    <div className="dm-step-header">
                      <div className="dm-step-badge">1</div>
                      <h3>配信コンテンツ</h3>
                    </div>
                    {viewMode === 'create' && (
                      <div className="dm-field">
                        <label>配信店舗 <span className="req">*</span></label>
                        {stores.length === 0 ? (
                          <div className="dm-input" style={{ background: "#f8fafc", color: "#94a3b8" }}>担当店舗がありません</div>
                        ) : stores.length === 1 ? (
                          <div className="dm-input" style={{ background: "#f8fafc" }}>{storeName}（{storeBrand} / {clubCode}）</div>
                        ) : (
                          <select className="dm-input" value={clubCode} onChange={(e) => setClubCode(e.target.value)}>
                            <option value="">店舗を選択</option>
                            {stores.map((s) => (
                              <option key={s.clubCode} value={s.clubCode}>{s.clubName}（{s.clubCode}）</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                    <div className="dm-field">
                      <label>件名 <span className="req">*</span></label>
                      <input 
                        type="text" className="dm-input" value={subject} 
                        onChange={e=>setSubject(e.target.value)} 
                        disabled={viewMode === 'detail'} 
                        placeholder="メールの件名" 
                      />
                    </div>
                    <div className="dm-field">
                      <label>本文 <span className="req">*</span></label>
                      <textarea 
                        className="dm-textarea" rows={6} value={body} 
                        onChange={e=>setBody(e.target.value)} 
                        disabled={viewMode === 'detail'}
                        placeholder="本文を入力..." 
                      />
                    </div>
                    {viewMode === 'create' && (
                      <div className="dm-field">
                        <label>ヘッダー画像URL（任意）</label>
                        <input
                          type="url" className="dm-input" value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          placeholder="https://example.com/banner.png"
                        />
                      </div>
                    )}
                    {viewMode === 'create' && (
                      <div className="dm-field" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>✨ AIでおしゃれなHTMLメールを作成</label>
                        <textarea
                          className="dm-textarea" rows={2} value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          placeholder="例: 春の入会キャンペーンの案内。明るくポップに、CTAボタン付きで"
                        />
                        <button
                          type="button" className="dm-extract-btn" style={{ marginTop: 8 }}
                          onClick={generateHtml} disabled={aiGenerating}
                        >
                          {aiGenerating ? "生成中..." : htmlBody ? "AIで作り直す" : "AIでHTMLを生成"}
                        </button>
                        {htmlBody && (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 11, color: "#0f766e" }}>
                            <span>✓ AI生成HTMLを使用中（プレビュー反映）</span>
                            <button type="button" onClick={() => setHtmlBody("")} style={{ background: "none", border: "none", color: "#dc2626", fontWeight: 700, cursor: "pointer", fontSize: 11 }}>解除</button>
                          </div>
                        )}
                        {aiError && <div style={{ color: "#dc2626", fontSize: 11, marginTop: 6 }}>{aiError}</div>}
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>件名・本文・画像URL・ブランドを踏まえて生成します。生成後は下書き保存で安全に確認できます。</div>
                      </div>
                    )}
                  </div>

                  <div className="dm-divider" />

                  {/* STEP 2: ターゲット (作成時のみ表示) */}
                  {viewMode === 'create' ? (
                    <div className="dm-step-group">
                      <div className="dm-step-header"><div className="dm-step-badge">2</div><h3>抽出条件</h3></div>
                      
                      <div className="dm-filter-box">
                        {groups.length > 1 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, marginBottom: 10 }}>
                            <span style={{ color: "#64748b", fontWeight: 700 }}>グループ間:</span>
                            <label style={{ display: "flex", alignItems: "center", gap: 4 }}><input type="radio" checked={groupOp === "OR"} onChange={() => setGroupOp("OR")} /> OR（いずれか）</label>
                            <label style={{ display: "flex", alignItems: "center", gap: 4 }}><input type="radio" checked={groupOp === "AND"} onChange={() => setGroupOp("AND")} /> AND（すべて）</label>
                          </div>
                        )}
                        {groups.map((g, gi) => (
                          <div key={gi}>
                            {gi > 0 && <div style={{ textAlign: "center", margin: "8px 0", fontSize: 11, fontWeight: 800, color: "#0f172a" }}>— {groupOp} —</div>}
                            <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, background: "#fff", marginBottom: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>条件グループ {gi + 1}</span>
                                {groups.length > 1 && <button type="button" onClick={() => removeGroup(gi)} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>削除</button>}
                              </div>
                              <ConditionGroupForm group={g} onChange={(patch) => updateGroup(gi, patch)} contractTypes={CONTRACT_TYPES} cls="dm" />
                            </div>
                          </div>
                        ))}
                        <button type="button" onClick={addGroup} style={{ width: "100%", border: "1px dashed #cbd5e1", background: "#f8fafc", color: "#0f172a", padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>＋ 条件グループを追加（{groupOp}）</button>

                        <button className="dm-extract-btn" onClick={handleExtract} disabled={isExtracting || !clubCode}>{isExtracting ? "検索中..." : "条件で名簿を作成"}</button>

                        <div className="dm-divider" />
                        <div className="dm-label-row">
                          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>CSVで宛先を追加</label>
                          <button type="button" className="dm-bulk-toggle" onClick={downloadCsvTemplate} style={{ background: "none", border: "none", color: "#0f172a", textDecoration: "underline", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                            フォーマットDL
                          </button>
                        </div>
                        <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvUpload} style={{ fontSize: 11, marginTop: 4 }} />
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>列: 会員番号, メールアドレス, 氏名（メール必須）</div>

                        {extractError && <div style={{ color: "#dc2626", fontSize: 11, marginTop: 8 }}>{extractError}</div>}
                      </div>
                    </div>
                  ) : (
                    /* 詳細モード時 */
                    <div className="dm-step-group">
                      <div className="dm-step-header"><h3>配信情報</h3></div>
                      <div className="dm-info-row">
                        <span className="label">送信日時</span>
                        <span className="val">{formatDate(selectedHistory?.scheduledAt || "")}</span>
                      </div>
                      <div className="dm-info-row">
                        <span className="label">ステータス</span>
                        <span className={`status-pill ${selectedHistory?.status.toLowerCase()}`}>{selectedHistory?.status}</span>
                      </div>
                    </div>
                  )}

                  {viewMode === 'create' && (
                    <>
                      <div className="dm-divider" />
                      <div className="dm-step-group">
                        <div className="dm-step-header"><div className="dm-step-badge">3</div><h3>スケジュール</h3></div>
                        <div className="dm-radio-box">
                          <label className={isImmediate ? 'active' : ''}><input type="radio" checked={isImmediate} onChange={()=>setIsImmediate(true)} /> 即時送信</label>
                          <label className={!isImmediate ? 'active' : ''}><input type="radio" checked={!isImmediate} onChange={()=>setIsImmediate(false)} /> 予約配信</label>
                        </div>
                        {!isImmediate && (
                          <div className="dm-row-2 mt-2">
                            <input type="date" value={scheduledDate} onChange={e=>setScheduledDate(e.target.value)} />
                            <input type="time" value={scheduledTime} onChange={e=>setScheduledTime(e.target.value)} />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </aside>

              {/* --- COLUMN 2: 中央 (作成時:リスト / 詳細時:レポート) --- */}
              <section className="dm-col-list">
                {viewMode === 'create' ? (
                  <>
                    <div className="dm-panel-header-sticky">宛先リスト精査 (配信可能 {targetRecipients.length} / 全 {extractedMembers.length} 件)</div>
                    <div className="dm-list-container">
                      {extractedMembers.length > 0 ? (
                        <table className="dm-list-table">
                          <thead>
                            <tr>
                              <th style={{ width: 32 }}><input type="checkbox"
                                checked={selectedMemberIds.size > 0 && selectedMemberIds.size === extractedMembers.filter(m=>m.deliverable).length}
                                onChange={() => {
                                  const del = extractedMembers.filter(m=>m.deliverable);
                                  if(selectedMemberIds.size === del.length) setSelectedMemberIds(new Set());
                                  else setSelectedMemberIds(new Set(del.map(m=>m.key)));
                                }} /></th>
                              <th>会員/宛先</th>
                              <th>区分</th>
                              <th style={{ width: 40 }}>配信</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedMembers.map(m => (
                              <tr key={m.key} className={selectedMemberIds.has(m.key) ? "" : "excluded"}>
                                <td><input type="checkbox" disabled={!m.deliverable} checked={selectedMemberIds.has(m.key)} onChange={()=>toggleSelectMember(m.key)} /></td>
                                <td>
                                  <div className="dm-u-info">
                                    <strong>{m.name}</strong>
                                    <small>{m.memberNo !== "-" ? `会員番号:${m.memberNo} | ` : ""}{m.email || "メールなし"}</small>
                                  </div>
                                </td>
                                <td>
                                  <div className="dm-u-meta">
                                    <span className={`status-badge ${m.status === '退会済' ? 'leaver' : 'stable'}`}>{m.status}</span>
                                    {m.contractType && <span className="dm-contract-chip">{m.contractType}</span>}
                                    {m.source === "csv" && <span className="dm-contract-chip">CSV</span>}
                                  </div>
                                </td>
                                <td>{m.deliverable ? <span className="status-badge stable">可</span> : <span className="unpaid-dot" title="メールなし">×</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="dm-empty-state">STEP 2 で条件抽出、または CSV で<br/>宛先を追加してください</div>
                      )}
                    </div>
                    {extractedMembers.length > itemsPerPage && (
                      <div className="dm-list-pager">
                        <button disabled={currentPage===1} onClick={()=>setCurrentPage(p=>p-1)}>&lt;</button>
                        <span>{currentPage} / {Math.ceil(extractedMembers.length/itemsPerPage)}</span>
                        <button disabled={currentPage >= Math.ceil(extractedMembers.length/itemsPerPage)} onClick={()=>setCurrentPage(p=>p+1)}>&gt;</button>
                      </div>
                    )}
                  </>
                ) : (
                  /* 詳細モード: レポート */
                  <>
                    <div className="dm-panel-header-sticky">配信結果レポート</div>
                    <div className="dm-report-container">
                      <div className="dm-report-card">
                        <div className="dm-report-grid">
                          <div className="kpi-item">
                            <label>配信対象</label>
                            <div className="kpi-val">{selectedHistory?.stats?.targetCount || 0}</div>
                          </div>
                          <div className="kpi-item">
                            <label>到達数</label>
                            <div className="kpi-val text-blue">{selectedHistory?.stats?.deliveredCount || 0}</div>
                          </div>
                          <div className="kpi-item">
                            <label>開封数</label>
                            <div className="kpi-val text-green">{selectedHistory?.stats?.openCount || 0}</div>
                          </div>
                          <div className="kpi-item">
                            <label>開封率</label>
                            <div className="kpi-val">
                              {selectedHistory?.stats && selectedHistory.stats.deliveredCount > 0
                                ? Math.round((selectedHistory.stats.openCount / selectedHistory.stats.deliveredCount)*100)
                                : 0}<small>%</small>
                            </div>
                          </div>
                        </div>
                        <div className="error-bar">
                          <span className="err-label">配信エラー (Bounce)</span>
                          <span className="err-val">{selectedHistory?.stats?.errorCount || 0}件</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </section>

              {/* --- COLUMN 3: プレビュー (右) --- */}
              <section className="dm-col-preview">
                <div className="dm-panel-header-sticky">受信プレビュー</div>
                <div className="dm-preview-frame">
                  <div className="email-card">
                    <div className="mock-head">
                      <div className="mock-subj">{subject || "(件名なし)"}</div>
                      <div className="mock-from">From: {storeBrand} サポート</div>
                    </div>
                    <div className="mock-body-scroll">
                      {htmlBody ? (
                        // AI生成HTMLをそのままプレビュー
                        <div className="mock-text-area" dangerouslySetInnerHTML={{ __html: htmlBody }} />
                      ) : (
                        <>
                          {imageUrl && <img src={imageUrl} className="mock-banner" alt="" />}
                          <div className="mock-text-area">
                            {body ? body.split('\n').map((l, i) => <p key={i}>{l}</p>) : <p className="placeholder">本文プレビュー</p>}
                          </div>
                        </>
                      )}
                      <div className="mock-footer">
                        本メールは{storeBrand}より自動送信されています。<br/>
                        © {storeBrand} {storeName}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

            </div>
            <footer className="dm-modal-footer">
              <button className="dm-modal-cancel" onClick={()=>setIsModalOpen(false)}>
                {viewMode === 'create' ? 'キャンセル' : '閉じる'}
              </button>
              {viewMode === 'create' && (
                <>
                  <button className="dm-modal-cancel" onClick={() => submit(true)} disabled={!clubCode || !subject || !body || sending} title="送信せず下書き保存">
                    下書き保存
                  </button>
                  <button className="dm-modal-submit" onClick={() => submit(false)} disabled={targetRecipients.length === 0 || !subject || sending}>
                    {isImmediate ? "配信する" : "予約配信する"} ({targetRecipients.length}件)
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      )}

      <style jsx global>{`
        /* BASE */
        .dm-root { background: #f8fafc; min-height: 100vh; font-family: 'Inter', sans-serif; color: #1e293b; }
        
        /* HEADER */
        .dm-header { background: #fff; border-bottom: 1px solid #e2e8f0; height: 64px; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .dm-header-inner { width: 100%; max-width: 1400px; margin: 0 auto; width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; }
        .dm-header-left { display: flex; align-items: center; gap: 8px; }
        .dm-header-title { font-size: 1.15rem; font-weight: 800; color: #0f172a; }
        
        .dm-back-btn { 
          display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; 
          border-radius: 50%; color: #64748b; background: #f1f5f9; transition: 0.2s; 
        }
        .dm-back-btn:hover { background: #e2e8f0; color: #0f172a; }
        
        .dm-primary-btn { 
          background: #0f172a; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; 
          font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13px; 
          transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
        }
        .dm-primary-btn:hover { background: #1e293b; transform: translateY(-1px); }

        /* LIST VIEW */
        .dm-main-content { max-width: 1400px; margin: 32px auto; padding: 0 24px; }
        .dm-history-container { background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .dm-history-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .dm-history-table th { background: #f8fafc; padding: 14px 16px; text-align: left; font-weight: 700; color: #64748b; border-bottom: 1px solid #e2e8f0; }
        .dm-history-table td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .clickable-row { cursor: pointer; transition: background 0.1s; }
        .clickable-row:hover { background: #f8fafc; }
        .subj-cell { font-weight: 700; color: #334155; }
        .status-pill { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .status-pill.sent { background: #dcfce7; color: #166534; }
        .status-pill.scheduled { background: #dbeafe; color: #1e40af; }
        .empty-row { padding: 60px; text-align: center; color: #94a3b8; }

        /* MODAL (3カラム) */
        .dm-modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); z-index: 2000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px); }
        .dm-modal-window { background: #fff; width: 98vw; height: 92vh; max-height: 900px; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.4); }
        .dm-modal-body-tri { flex: 1; display: grid; grid-template-columns: 360px 1fr 400px; min-height: 0; background: #f1f5f9; }

        /* COLUMN 1: CONFIG */
        .dm-col-config { background: #fff; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; height: 100%; overflow: hidden; }
        .dm-panel-scroll { flex: 1; overflow-y: auto; padding: 24px; }
        
        .dm-step-group { margin-bottom: 24px; }
        .dm-step-header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        .dm-step-badge { background: #0f172a; color: #fff; font-size: 10px; font-weight: 800; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
        .dm-step-header h3 { font-size: 13px; font-weight: 800; color: #0f172a; margin: 0; }
        
        .dm-field { margin-bottom: 16px; }
        .dm-field label { display: block; font-size: 11px; font-weight: 700; margin-bottom: 4px; color: #64748b; }
        .dm-input, .dm-textarea { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px; font-size: 13px; outline: none; transition: border-color 0.2s; }
        .dm-input:focus, .dm-textarea:focus { border-color: #3b82f6; }
        .dm-input:disabled, .dm-textarea:disabled { background: #f1f5f9; color: #64748b; }
        
        .dm-row-2 { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
        .dm-row-2 input { width: 100%; border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 6px; font-size: 12px; }
        .dm-check-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .dm-check-row label, .dm-unpaid-check { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer; color: #334155; }
        .dm-check-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 12px; }
        .dm-check-grid label { font-size: 12px; font-weight: 600; color: #334155; display: flex; align-items: center; gap: 4px; cursor: pointer; }
        .dm-label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .dm-bulk-toggle { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #94a3b8; }
        .dm-bulk-toggle button { background: none; border: none; padding: 0; font-size: 11px; font-weight: 700; color: #0f172a; cursor: pointer; text-decoration: underline; }
        .dm-bulk-toggle button:hover { color: #2563eb; }
        .dm-contract-chip { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; font-weight: 700; }
        .dm-unpaid-check { color: #ef4444; margin-top: 8px; }
        
        .dm-extract-btn { width: 100%; background: #0f172a; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: 700; font-size: 12px; margin-top: 16px; cursor: pointer; transition: 0.2s; }
        .dm-extract-btn:hover:not(:disabled) { background: #334155; }
        .dm-extract-btn:disabled { opacity: 0.7; cursor: wait; }
        .dm-divider { height: 1px; background: #f1f5f9; margin: 24px 0; }
        
        .dm-radio-box { display: flex; background: #f1f5f9; padding: 3px; border-radius: 6px; }
        .dm-radio-box label { flex: 1; text-align: center; padding: 8px; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 5px; color: #64748b; }
        .dm-radio-box label.active { background: #fff; color: #3b82f6; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .dm-radio-box input { display: none; }
        
        .dm-info-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; border-bottom: 1px dashed #f1f5f9; padding-bottom: 4px; }
        .dm-info-row .label { color: #64748b; font-size: 12px; }

        /* COLUMN 2: LIST / REPORT */
        .dm-col-list { border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; height: 100%; background: #f8fafc; min-height: 0; }
        .dm-panel-header-sticky { padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 800; color: #64748b; }
        .dm-list-container { flex: 1; overflow-y: auto; }
        .dm-list-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .dm-list-table th { background: #f8fafc; padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 10; color: #94a3b8; }
        .dm-list-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; background: #fff; vertical-align: middle; }
        .dm-list-table tr.excluded { opacity: 0.4; background: #f9fafb; }
        
        .dm-u-info strong { display: block; color: #1e293b; font-size: 12px; margin-bottom: 2px; }
        .dm-u-info small { color: #94a3b8; font-size: 10px; display: block; }
        .dm-u-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #475569; }
        .status-badge { padding: 2px 6px; border-radius: 4px; font-size: 9px; color: #fff; }
        .status-badge.stable { background: #3b82f6; }
        .status-badge.leaver { background: #94a3b8; }
        .date-info { display: block; font-size: 10px; color: #94a3b8; margin-top: 2px; }
        .unpaid-dot { background: #fee2e2; color: #ef4444; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 10px; }
        
        .dm-list-pager { padding: 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: center; gap: 12px; font-size: 11px; font-weight: 700; background: #fff; }
        .dm-list-pager button { padding: 4px 10px; border: 1px solid #e2e8f0; background: #fff; border-radius: 4px; cursor: pointer; }
        .dm-empty-state { padding: 80px 20px; text-align: center; color: #94a3b8; font-size: 12px; }

        /* Report View */
        .dm-report-container { padding: 24px; overflow-y: auto; flex: 1; }
        .dm-report-card { background: #fff; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; }
        .dm-report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        .kpi-item label { font-size: 10px; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px; }
        .kpi-val { font-size: 20px; font-weight: 800; color: #1e293b; }
        .kpi-val small { font-size: 12px; margin-left: 2px; }
        .text-blue { color: #3b82f6; } .text-green { color: #10b981; } .text-red { color: #ef4444; }
        .error-bar { background: #fef2f2; padding: 12px; border-radius: 8px; border: 1px solid #fee2e2; display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 700; }
        .err-val { color: #ef4444; }

        /* COLUMN 3: PREVIEW */
        .dm-col-preview { display: flex; flex-direction: column; height: 100%; background: #cbd5e1; }
        .dm-preview-frame { flex: 1; padding: 32px; overflow-y: auto; display: flex; justify-content: center; align-items: flex-start; }
        .email-card { width: 100%; max-width: 360px; background: #fff; border-radius: 12px; box-shadow: 0 10px 20px rgba(0,0,0,0.1); display: flex; flex-direction: column; height: fit-content; min-height: 400px; overflow: hidden; }
        .mock-head { padding: 16px 20px; border-bottom: 1px solid #f1f5f9; background: #fff; }
        .mock-subj { font-size: 14px; font-weight: 800; line-height: 1.4; color: #1e293b; }
        .mock-from { font-size: 10px; color: #94a3b8; margin-top: 4px; }
        .mock-body-scroll { padding: 0; flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
        .mock-banner { width: 100%; height: auto; object-fit: cover; }
        .mock-text-area { padding: 24px; font-size: 13px; line-height: 1.6; color: #334155; flex: 1; }
        .mock-footer { padding: 20px; border-top: 1px dashed #e2e8f0; background: #fafafa; font-size: 10px; color: #94a3b8; text-align: center; line-height: 1.5; }

        /* FOOTER */
        .dm-modal-footer { padding: 16px 24px; border-top: 1px solid #e2e8f0; background: #fff; display: flex; justify-content: flex-end; gap: 12px; }
        .dm-modal-submit { background: #3b82f6; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3); }
        .dm-modal-submit:hover:not(:disabled) { background: #2563eb; }
        .dm-modal-submit:disabled { background: #cbd5e1; cursor: not-allowed; box-shadow: none; }
        .dm-modal-cancel { background: #fff; border: 1px solid #cbd5e1; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 13px; color: #64748b; cursor: pointer; }

        .placeholder { color: #cbd5e1; font-style: italic; }
        .req { color: #ef4444; }
        .mt-2 { margin-top: 8px; }
      `}</style>
    </div>
  );
}