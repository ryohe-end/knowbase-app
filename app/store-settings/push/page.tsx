// app/store-settings/push/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import type { PushNotification } from "@/types/pushNotification";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// --- モックデータ生成 ---
const generateMockMembers = (count: number) => {
  return Array.from({ length: count }).map((_, i) => {
    // 10人に1人が退会者、20人に1人が未納者
    const isLeaver = i % 10 === 0;
    const isUnpaid = Math.random() > 0.95;
    return {
      id: `1000${i + 1}`,
      name: `利用者 ${i + 1}`,
      email: `user${i + 1}@example.com`,
      gender: i % 2 === 0 ? "male" : "female",
      joinDate: "2023-04-15",
      leaveDate: isLeaver ? "2025-12-31" : "",
      lastVisitDate: "2026-02-10",
      visitCount: Math.floor(Math.random() * 50),
      status: isLeaver ? "退会済" : "在籍中",
      hasUnpaid: isUnpaid
    };
  });
};

const formatDate = (iso: string) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
};

export default function PushSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notifications, setNotifications] = useState<PushNotification[]>([]);
  
  // モーダル・表示モード
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"create" | "detail">("create");
  const [selectedHistory, setSelectedHistory] = useState<PushNotification | null>(null);

  // フォームState
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // 配信前最終確認モーダルの開閉
  const [confirmOpen, setConfirmOpen] = useState(false);
  
  // 抽出条件
  const [condition, setCondition] = useState({
    joinDateFrom: "", joinDateTo: "",
    leaveDateFrom: "", leaveDateTo: "",
    visitCountFrom: "", visitCountTo: "",
    gender: ["male", "female"] as string[],
    membershipStatus: ["stable", "leaver"] as string[], // 安定/退会
    hasUnpaidOnly: false
  });

  // リストState
  const [extractedMembers, setExtractedMembers] = useState<any[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  // スケジュールState
  const [isImmediate, setIsImmediate] = useState(true);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/store-settings/push", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
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

  const openDetailModal = (n: PushNotification) => {
    setViewMode("detail");
    setSelectedHistory(n);
    setTitle(n.title);
    setBody(n.body);
    setIsModalOpen(true);
  };

  const handleExtract = () => {
    setIsExtracting(true);
    setTimeout(() => {
      const mockResult = generateMockMembers(250);
      setExtractedMembers(mockResult);
      setSelectedMemberIds(new Set(mockResult.map(m => m.id)));
      setIsExtracting(false);
      setCurrentPage(1);
    }, 600);
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

  // KPI 計算
  const kpis = useMemo(() => {
    const sent = notifications.filter((n) => n.status === "SENT" && n.stats);
    const totalSent = sent.length;
    const avgOpenRate = sent.length === 0 ? 0
      : sent.reduce((sum, n) => {
          const s = n.stats!;
          return sum + (s.sentCount > 0 ? s.openCount / s.sentCount : 0);
        }, 0) / sent.length * 100;
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const thisWeek = sent.filter((n) => new Date(n.scheduledAt).getTime() >= weekStart.getTime()).length;
    const errorRate = sent.length === 0 ? 0
      : sent.reduce((sum, n) => {
          const s = n.stats!;
          return sum + (s.targetCount > 0 ? s.errorCount / s.targetCount : 0);
        }, 0) / sent.length * 100;
    return {
      totalSent,
      avgOpenRate: Math.round(avgOpenRate * 10) / 10,
      thisWeek,
      errorRate: Math.round(errorRate * 10) / 10,
    };
  }, [notifications]);

  // 送信予定の人間可読化
  const scheduledLabel = useMemo(() => {
    if (isImmediate) return "今すぐ送信";
    if (!scheduledDate || !scheduledTime) return "未設定";
    const d = new Date(`${scheduledDate}T${scheduledTime}:00`);
    return d.toLocaleString("ja-JP", {
      year: "numeric", month: "long", day: "numeric",
      weekday: "short", hour: "2-digit", minute: "2-digit",
    });
  }, [isImmediate, scheduledDate, scheduledTime]);

  const toggleConditionArray = (key: 'gender' | 'membershipStatus', value: string) => {
    setCondition(prev => {
      const current = prev[key];
      if (current.includes(value)) return { ...prev, [key]: current.filter(v => v !== value) };
      return { ...prev, [key]: [...current, value] };
    });
  };

  // 「配信を確定する」を押したら、まず最終確認モーダルを表示
  const requestConfirm = () => {
    if (!title || !body) return alert("タイトルと本文は必須です。");
    if (selectedMemberIds.size === 0) return alert("配信対象を選択してください。");
    if (!isImmediate && (!scheduledDate || !scheduledTime)) {
      return alert("予約配信の場合は送信日時を指定してください。");
    }
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    setSending(true);
    try {
      const scheduledAt = isImmediate
        ? new Date().toISOString()
        : new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();
      const res = await fetch("/api/store-settings/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          targetType: "CONDITION",
          condition,
          isImmediate,
          scheduledAt,
          targetCount: selectedMemberIds.size,
        }),
      });
      if (!res.ok) throw new Error("配信失敗");
      setConfirmOpen(false);
      setIsModalOpen(false);
      fetchData();
      resetForm();
      alert(isImmediate ? "配信を完了しました。" : "配信予約を完了しました。");
    } catch (e: any) {
      alert(e?.message || "送信エラー");
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setTitle(""); setBody("");
    setCondition({
      joinDateFrom: "", joinDateTo: "",
      leaveDateFrom: "", leaveDateTo: "",
      visitCountFrom: "", visitCountTo: "",
      gender: ["male", "female"],
      membershipStatus: ["stable", "leaver"],
      hasUnpaidOnly: false
    });
    setExtractedMembers([]); setSelectedMemberIds(new Set());
    setIsImmediate(true); setScheduledDate(""); setScheduledTime("");
  };

  return (
    <div className="push-root">
      <AdminLoadingOverlay visible={loading || sending} />
      
      {/* ヘッダー */}
      <header className="push-header">
        <div className="push-header-inner">
          <div className="push-header-left">
            <Link href="/store-settings" className="push-back-btn" title="戻る">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </Link>
            <h1 className="push-header-title">PUSH通知管理</h1>
          </div>
          <button className="push-primary-btn" onClick={openCreateModal}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>新規配信作成</span>
          </button>
        </div>
      </header>

      <main className="push-main-content">
        {/* KPI dashboard */}
        <section className="push-kpi-section">
          <div className="push-kpi-tile">
            <div className="push-kpi-label">総送信数</div>
            <div className="push-kpi-value">{kpis.totalSent}</div>
            <div className="push-kpi-sub">SENT 累計</div>
          </div>
          <div className="push-kpi-tile">
            <div className="push-kpi-label">平均開封率</div>
            <div className="push-kpi-value">
              {kpis.avgOpenRate}<small>%</small>
            </div>
            <div className="push-kpi-sub">配信成功者あたり</div>
          </div>
          <div className="push-kpi-tile">
            <div className="push-kpi-label">今週送信数</div>
            <div className="push-kpi-value">{kpis.thisWeek}</div>
            <div className="push-kpi-sub">今週開始以降</div>
          </div>
          <div className="push-kpi-tile">
            <div className="push-kpi-label">エラー率</div>
            <div className="push-kpi-value">
              {kpis.errorRate}<small>%</small>
            </div>
            <div className="push-kpi-sub">対象比 (端末未登録等)</div>
          </div>
        </section>

        <section className="push-history-section">
          <div className="push-table-container">
            <table className="push-history-table">
              <thead>
                <tr>
                  <th>送信日時</th>
                  <th>タイトル</th>
                  <th>ステータス</th>
                  <th>対象件数</th>
                  <th>成功数</th>
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
                      <td className="subj-cell">{n.title}</td>
                      <td><span className={`status-pill ${n.status.toLowerCase()}`}>{n.status === 'SENT' ? '完了' : '予約中'}</span></td>
                      <td>{n.stats?.targetCount || 0}</td>
                      <td>{n.stats?.sentCount || 0}</td>
                      <td>{n.stats ? `${Math.round((n.stats.openCount / n.stats.sentCount)*100)}%` : '-'}</td>
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
        <div className="push-modal-overlay">
          <div className="push-modal-window">
            
            {/* 3カラムレイアウト */}
            <div className="push-modal-body-tri">
              
              {/* --- COLUMN 1: 設定 (左) --- */}
              <aside className="push-col-config">
                <div className="push-panel-scroll">
                  
                  {/* STEP 1: コンテンツ */}
                  <div className="push-step-group">
                    <div className="push-step-header">
                      <div className="push-step-badge">1</div>
                      <h3>通知コンテンツ</h3>
                    </div>
                    <div className="push-field">
                      <label>タイトル <span className="req">*</span></label>
                      <input 
                        type="text" className="push-input" value={title} 
                        onChange={e=>setTitle(e.target.value)} 
                        disabled={viewMode === 'detail'} 
                        placeholder="通知のタイトル" 
                      />
                    </div>
                    <div className="push-field">
                      <label>本文 <span className="req">*</span></label>
                      <textarea 
                        className="push-textarea" rows={4} value={body} 
                        onChange={e=>setBody(e.target.value)} 
                        disabled={viewMode === 'detail'}
                        placeholder="通知の内容..." 
                      />
                    </div>
                    <div className="push-hint">
                      ※ PUSH 通知の仕様上、画像添付には別途配信基盤の設定が必要なため、本画面ではテキストのみ取り扱います。
                    </div>
                  </div>

                  <div className="push-divider" />

                  {/* STEP 2: ターゲット (作成時のみ表示) */}
                  {viewMode === 'create' ? (
                    <div className="push-step-group">
                      <div className="push-step-header"><div className="push-step-badge">2</div><h3>ターゲット抽出</h3></div>
                      
                      <div className="push-filter-box">
                        <div className="push-field">
                          <label>入会日範囲</label>
                          <div className="push-row-2"><input type="date" value={condition.joinDateFrom} onChange={e=>setCondition({...condition, joinDateFrom:e.target.value})} /><span>~</span><input type="date" value={condition.joinDateTo} onChange={e=>setCondition({...condition, joinDateTo:e.target.value})} /></div>
                        </div>
                        <div className="push-field">
                          <label>退会日範囲</label>
                          <div className="push-row-2"><input type="date" value={condition.leaveDateFrom} onChange={e=>setCondition({...condition, leaveDateFrom:e.target.value})} /><span>~</span><input type="date" value={condition.leaveDateTo} onChange={e=>setCondition({...condition, leaveDateTo:e.target.value})} /></div>
                        </div>
                        <div className="push-field">
                          <label>来館回数</label>
                          <div className="push-row-2"><input type="number" value={condition.visitCountFrom} onChange={e=>setCondition({...condition, visitCountFrom:e.target.value})} placeholder="Min" /><input type="number" value={condition.visitCountTo} onChange={e=>setCondition({...condition, visitCountTo:e.target.value})} placeholder="Max" /></div>
                        </div>
                        
                        <div className="push-field">
                          <label>性別</label>
                          <div className="push-check-row">
                            <label><input type="checkbox" checked={condition.gender.includes("male")} onChange={() => toggleConditionArray('gender', 'male')} /> 男性</label>
                            <label><input type="checkbox" checked={condition.gender.includes("female")} onChange={() => toggleConditionArray('gender', 'female')} /> 女性</label>
                          </div>
                        </div>

                        {/* ✅ 会員区分 (安定/退会) */}
                        <div className="push-field">
                          <label>会員区分</label>
                          <div className="push-check-row">
                            <label><input type="checkbox" checked={condition.membershipStatus.includes("stable")} onChange={() => toggleConditionArray('membershipStatus', 'stable')} /> 在籍中</label>
                            <label><input type="checkbox" checked={condition.membershipStatus.includes("leaver")} onChange={() => toggleConditionArray('membershipStatus', 'leaver')} /> 退会済</label>
                          </div>
                        </div>

                        <div className="push-field">
                          <label className="push-unpaid-check"><input type="checkbox" checked={condition.hasUnpaidOnly} onChange={e=>setCondition({...condition, hasUnpaidOnly:e.target.checked})} /> 未納者のみを抽出</label>
                        </div>
                        
                        <button className="push-extract-btn" onClick={handleExtract} disabled={isExtracting}>{isExtracting ? "検索中..." : "条件で名簿を作成"}</button>
                      </div>
                    </div>
                  ) : (
                    /* 詳細モード時 */
                    <div className="push-step-group">
                      <div className="push-step-header"><h3>配信情報</h3></div>
                      <div className="push-info-row">
                        <span className="label">送信日時</span>
                        <span className="val">{formatDate(selectedHistory?.scheduledAt || "")}</span>
                      </div>
                      <div className="push-info-row">
                        <span className="label">ステータス</span>
                        <span className={`status-pill ${selectedHistory?.status.toLowerCase()}`}>{selectedHistory?.status}</span>
                      </div>
                    </div>
                  )}

                  {viewMode === 'create' && (
                    <>
                      <div className="push-divider" />
                      <div className="push-step-group">
                        <div className="push-step-header"><div className="push-step-badge">3</div><h3>スケジュール</h3></div>
                        <div className="push-radio-box">
                          <label className={isImmediate ? 'active' : ''}><input type="radio" checked={isImmediate} onChange={()=>setIsImmediate(true)} /> 即時送信</label>
                          <label className={!isImmediate ? 'active' : ''}><input type="radio" checked={!isImmediate} onChange={()=>setIsImmediate(false)} /> 予約配信</label>
                        </div>
                        {!isImmediate && (
                          <div className="push-row-2 mt-2">
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
              <section className="push-col-list">
                {viewMode === 'create' ? (
                  <>
                    <div className="push-panel-header-sticky">宛先リスト精査 ({selectedMemberIds.size}名)</div>
                    <div className="push-list-container">
                      {extractedMembers.length > 0 ? (
                        <table className="push-list-table">
                          <thead>
                            <tr>
                              <th width="32"><input type="checkbox" checked={selectedMemberIds.size === extractedMembers.length} onChange={() => {
                                if(selectedMemberIds.size === extractedMembers.length) setSelectedMemberIds(new Set());
                                else setSelectedMemberIds(new Set(extractedMembers.map(m=>m.id)));
                              }} /></th>
                              <th>会員情報</th>
                              <th>区分/来館</th>
                              <th width="30">未</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedMembers.map(m => (
                              <tr key={m.id} className={selectedMemberIds.has(m.id) ? "" : "excluded"}>
                                <td><input type="checkbox" checked={selectedMemberIds.has(m.id)} onChange={()=>toggleSelectMember(m.id)} /></td>
                                <td>
                                  <div className="push-u-info">
                                    <strong>{m.name}</strong>
                                    <small>ID:{m.id} | {m.email}</small>
                                  </div>
                                </td>
                                <td>
                                  <div className="push-u-meta">
                                    <span className={`status-badge ${m.status === '退会済' ? 'leaver' : 'stable'}`}>{m.status}</span>
                                    <span className="visit-count">{m.visitCount}回</span>
                                  </div>
                                  <small className="date-info">入会: {m.joinDate}</small>
                                </td>
                                <td>{m.hasUnpaid && <span className="unpaid-dot" title="未納あり">!</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="push-empty-state">STEP 2 で条件を指定して<br/>「名簿を作成」してください</div>
                      )}
                    </div>
                    {extractedMembers.length > itemsPerPage && (
                      <div className="push-list-pager">
                        <button disabled={currentPage===1} onClick={()=>setCurrentPage(p=>p-1)}>&lt;</button>
                        <span>{currentPage} / {Math.ceil(extractedMembers.length/itemsPerPage)}</span>
                        <button disabled={currentPage >= Math.ceil(extractedMembers.length/itemsPerPage)} onClick={()=>setCurrentPage(p=>p+1)}>&gt;</button>
                      </div>
                    )}
                  </>
                ) : (
                  /* 詳細モード: レポート表示 */
                  <>
                    <div className="push-panel-header-sticky">配信結果レポート</div>
                    <div className="push-report-container">
                      <div className="push-report-card">
                        <div className="push-report-grid">
                          <div className="kpi-item">
                            <label>配信対象</label>
                            <div className="kpi-val">{selectedHistory?.stats?.targetCount || 0}</div>
                          </div>
                          <div className="kpi-item">
                            <label>成功数</label>
                            <div className="kpi-val text-blue">{selectedHistory?.stats?.sentCount || 0}</div>
                          </div>
                          <div className="kpi-item">
                            <label>開封数</label>
                            <div className="kpi-val text-green">{selectedHistory?.stats?.openCount || 0}</div>
                          </div>
                          <div className="kpi-item">
                            <label>開封率</label>
                            <div className="kpi-val">
                              {selectedHistory?.stats && selectedHistory.stats.sentCount > 0
                                ? Math.round((selectedHistory.stats.openCount / selectedHistory.stats.sentCount)*100)
                                : 0}<small>%</small>
                            </div>
                          </div>
                        </div>
                        <div className="error-bar">
                          <span className="err-label">配信エラー</span>
                          <span className="err-val">{selectedHistory?.stats?.errorCount || 0}件</span>
                        </div>
                      </div>

                      {/* 時系列開封チャート */}
                      {selectedHistory?.openTimeline && selectedHistory.openTimeline.length > 0 && (
                        <div className="push-chart-card">
                          <div className="push-chart-title">送信後の時間別開封数</div>
                          <div className="push-chart-wrap">
                            <ResponsiveContainer width="100%" height={200}>
                              <AreaChart data={selectedHistory.openTimeline}>
                                <defs>
                                  <linearGradient id="openGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.5} />
                                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <XAxis dataKey="hourOffset" tickFormatter={(h) => `+${h}h`} fontSize={11} />
                                <YAxis fontSize={11} />
                                <Tooltip
                                  formatter={(v: any) => [`${v} 件`, "開封"]}
                                  labelFormatter={(h) => `送信から ${h} 時間後`}
                                />
                                <Area type="monotone" dataKey="opens" stroke="#0ea5e9" fill="url(#openGradient)" strokeWidth={2} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>

              {/* --- COLUMN 3: プレビュー (右) スマホ型 --- */}
              <section className="push-col-preview">
                <div className="push-panel-header-sticky">スマホ通知プレビュー</div>
                <div className="push-preview-frame">
                  {/* Phone Shell */}
                  <div className="push-phone-mockup">
                    <div className="push-notch"></div>
                    <div className="push-screen">
                      <div className="push-time">10:41</div>
                      
                      {/* Notification Bubble */}
                      <div className="push-notification-bubble">
                        <div className="push-bubble-header">
                          <div className="push-app-info">
                            <div className="push-app-icon"></div>
                            <span className="push-app-name">FIT365アプリ</span>
                          </div>
                          <span className="push-now">たった今</span>
                        </div>
                        <div className="push-bubble-content">
                          <div className="push-bubble-title">{title || "タイトル"}</div>
                          <div className="push-bubble-body">{body || "ここに通知の本文が表示されます。"}</div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </section>

            </div>
            <footer className="push-modal-footer">
              <button className="push-modal-cancel" onClick={()=>setIsModalOpen(false)}>
                {viewMode === 'create' ? 'キャンセル' : '閉じる'}
              </button>
              {viewMode === 'create' && (
                <button className="push-modal-submit" onClick={requestConfirm} disabled={selectedMemberIds.size === 0 || !title}>
                  内容を確認する ({selectedMemberIds.size}件)
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {/* 配信前最終確認モーダル */}
      {confirmOpen && (
        <div className="push-confirm-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="push-confirm-window" onClick={(e) => e.stopPropagation()}>
            <header className="push-confirm-header">
              <h3>配信内容の最終確認</h3>
              <p>送信したら取り消せません。内容と送信時刻を確認してください。</p>
            </header>
            <div className="push-confirm-body">
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
                <span className="push-confirm-val emphasis">{selectedMemberIds.size} 名</span>
              </div>
              <div className="push-confirm-row">
                <span className="push-confirm-label">送信時刻</span>
                <span className={`push-confirm-val ${isImmediate ? "emphasis warn" : "emphasis"}`}>
                  {scheduledLabel}
                </span>
              </div>
            </div>
            <footer className="push-confirm-footer">
              <button className="push-modal-cancel" onClick={() => setConfirmOpen(false)} disabled={sending}>
                戻って修正する
              </button>
              <button className="push-modal-submit" onClick={handleSubmit} disabled={sending}>
                {sending ? "送信中..." : isImmediate ? "今すぐ送信する" : "予約配信を確定する"}
              </button>
            </footer>
          </div>
        </div>
      )}

      <style jsx global>{`
        /* BASE */
        .push-root { background: #f8fafc; min-height: 100vh; font-family: 'Inter', sans-serif; color: #1e293b; }

        /* KPI dashboard */
        .push-kpi-section { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
        .push-kpi-tile { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .push-kpi-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .push-kpi-value { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1.2; margin: 4px 0; }
        .push-kpi-value small { font-size: 16px; color: #64748b; margin-left: 2px; }
        .push-kpi-sub { font-size: 11px; color: #94a3b8; }
        @media (max-width: 900px) { .push-kpi-section { grid-template-columns: repeat(2, 1fr); } }

        /* Hint chip in form */
        .push-hint { font-size: 11px; color: #64748b; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; line-height: 1.5; margin-top: 8px; }

        /* Chart card in detail report */
        .push-chart-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-top: 12px; }
        .push-chart-title { font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 8px; }
        .push-chart-wrap { width: 100%; }

        /* Confirm modal */
        .push-confirm-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; z-index: 2000; }
        .push-confirm-window { background: #fff; width: 90%; max-width: 520px; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
        .push-confirm-header { padding: 20px 24px 12px; border-bottom: 1px solid #e2e8f0; }
        .push-confirm-header h3 { font-size: 17px; font-weight: 800; margin: 0 0 4px; color: #0f172a; }
        .push-confirm-header p { font-size: 12px; color: #64748b; margin: 0; }
        .push-confirm-body { padding: 16px 24px; display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow-y: auto; }
        .push-confirm-row { display: grid; grid-template-columns: 110px 1fr; gap: 12px; align-items: start; }
        .push-confirm-label { font-size: 11px; font-weight: 700; color: #64748b; padding-top: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
        .push-confirm-val { font-size: 13px; color: #0f172a; word-break: break-word; }
        .push-confirm-val.multiline { white-space: pre-wrap; }
        .push-confirm-val.emphasis { font-weight: 800; font-size: 14px; }
        .push-confirm-val.warn { color: #b45309; }
        .push-confirm-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
        
        /* HEADER */
        .push-header { background: #fff; border-bottom: 1px solid #e2e8f0; height: 64px; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .push-header-inner { width: 100%; max-width: 1400px; margin: 0 auto; width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; }
        .push-header-left { display: flex; align-items: center; gap: 8px; }
        .push-header-title { font-size: 1.15rem; font-weight: 800; color: #0f172a; }
        
        .push-back-btn { 
          display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; 
          border-radius: 50%; color: #64748b; background: #f1f5f9; transition: 0.2s; 
        }
        .push-back-btn:hover { background: #e2e8f0; color: #0f172a; }
        
        .push-primary-btn { 
          background: #0f172a; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; 
          font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13px; 
          transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
        }
        .push-primary-btn:hover { background: #1e293b; transform: translateY(-1px); }

        /* LIST VIEW */
        .push-main-content { max-width: 1400px; margin: 24px auto; padding: 0 24px; }
        .push-history-container { background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .push-history-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .push-history-table th { background: #f8fafc; padding: 14px 16px; text-align: left; font-weight: 700; color: #64748b; border-bottom: 1px solid #e2e8f0; }
        .push-history-table td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .clickable-row { cursor: pointer; transition: background 0.1s; }
        .clickable-row:hover { background: #f8fafc; }
        .subj-cell { font-weight: 700; color: #334155; }
        .status-pill { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .status-pill.sent { background: #dcfce7; color: #166534; }
        .status-pill.scheduled { background: #dbeafe; color: #1e40af; }
        .empty-row { padding: 60px; text-align: center; color: #94a3b8; }

        /* MODAL (3カラム) */
        .push-modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); z-index: 2000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px); }
        .push-modal-window { background: #fff; width: 98vw; height: 92vh; max-height: 900px; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.4); }
        .push-modal-body-tri { flex: 1; display: grid; grid-template-columns: 360px 1fr 380px; min-height: 0; background: #f1f5f9; }

        /* COLUMN 1: CONFIG */
        .push-col-config { background: #fff; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; height: 100%; overflow: hidden; }
        .push-panel-scroll { flex: 1; overflow-y: auto; padding: 24px; }
        
        .push-step-group { margin-bottom: 24px; }
        .push-step-header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        .push-step-badge { background: #0f172a; color: #fff; font-size: 10px; font-weight: 800; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
        .push-step-header h3 { font-size: 13px; font-weight: 800; color: #0f172a; margin: 0; }
        
        .push-field { margin-bottom: 16px; }
        .push-field label { display: block; font-size: 11px; font-weight: 700; margin-bottom: 4px; color: #64748b; }
        .push-input, .push-textarea { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px; font-size: 13px; outline: none; transition: border-color 0.2s; }
        .push-input:focus, .push-textarea:focus { border-color: #3b82f6; }
        .push-input:disabled, .push-textarea:disabled { background: #f1f5f9; color: #64748b; }
        
        .push-row-2 { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
        .push-row-2 input { width: 100%; border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 6px; font-size: 12px; }
        .push-check-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .push-check-row label, .push-unpaid-check { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer; color: #334155; }
        .push-unpaid-check { color: #ef4444; margin-top: 8px; }
        
        .push-extract-btn { width: 100%; background: #0f172a; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: 700; font-size: 12px; margin-top: 16px; cursor: pointer; transition: 0.2s; }
        .push-extract-btn:hover:not(:disabled) { background: #334155; }
        .push-extract-btn:disabled { opacity: 0.7; cursor: wait; }
        .push-divider { height: 1px; background: #f1f5f9; margin: 24px 0; }
        
        .push-radio-box { display: flex; background: #f1f5f9; padding: 3px; border-radius: 6px; }
        .push-radio-box label { flex: 1; text-align: center; padding: 8px; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 5px; color: #64748b; }
        .push-radio-box label.active { background: #fff; color: #3b82f6; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .push-radio-box input { display: none; }
        
        .push-info-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; border-bottom: 1px dashed #f1f5f9; padding-bottom: 4px; }
        .push-info-row .label { color: #64748b; font-size: 12px; }

        /* COLUMN 2: LIST / REPORT */
        .push-col-list { border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; height: 100%; background: #f8fafc; min-height: 0; }
        .push-panel-header-sticky { padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 800; color: #64748b; }
        .push-list-container { flex: 1; overflow-y: auto; }
        .push-list-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .push-list-table th { background: #f8fafc; padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 10; color: #94a3b8; }
        .push-list-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; background: #fff; vertical-align: middle; }
        .push-list-table tr.excluded { opacity: 0.4; background: #f9fafb; }
        
        .push-u-info strong { display: block; color: #1e293b; font-size: 12px; margin-bottom: 2px; }
        .push-u-info small { color: #94a3b8; font-size: 10px; display: block; }
        .push-u-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #475569; }
        .status-badge { padding: 2px 6px; border-radius: 4px; font-size: 9px; color: #fff; }
        .status-badge.stable { background: #3b82f6; }
        .status-badge.leaver { background: #94a3b8; }
        .date-info { display: block; font-size: 10px; color: #94a3b8; margin-top: 2px; }
        .unpaid-dot { background: #fee2e2; color: #ef4444; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 10px; }
        
        .push-list-pager { padding: 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: center; gap: 12px; font-size: 11px; font-weight: 700; background: #fff; }
        .push-list-pager button { padding: 4px 10px; border: 1px solid #e2e8f0; background: #fff; border-radius: 4px; cursor: pointer; }
        .push-empty-state { padding: 80px 20px; text-align: center; color: #94a3b8; font-size: 12px; }

        /* Report View */
        .push-report-container { padding: 24px; overflow-y: auto; flex: 1; }
        .push-report-card { background: #fff; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; }
        .push-report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        .kpi-item label { font-size: 10px; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px; }
        .kpi-val { font-size: 20px; font-weight: 800; color: #1e293b; }
        .kpi-val small { font-size: 12px; margin-left: 2px; }
        .text-blue { color: #3b82f6; } .text-green { color: #10b981; } .text-red { color: #ef4444; }
        .error-bar { background: #fef2f2; padding: 12px; border-radius: 8px; border: 1px solid #fee2e2; display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 700; }
        .err-val { color: #ef4444; }

        /* COLUMN 3: PREVIEW (SMARTPHONE STYLE) */
        .push-col-preview { display: flex; flex-direction: column; height: 100%; background: #cbd5e1; }
        .push-preview-frame { flex: 1; padding: 32px; overflow-y: auto; display: flex; justify-content: center; align-items: center; }
        
        .push-phone-mockup { width: 280px; height: 560px; background: #000; border-radius: 36px; padding: 12px; border: 4px solid #334155; position: relative; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
        .push-notch { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); width: 100px; height: 24px; background: #000; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; z-index: 10; }
        .push-screen { width: 100%; height: 100%; background: linear-gradient(135deg, #a8c0ff 0%, #3f2b96 100%); border-radius: 28px; overflow: hidden; position: relative; }
        .push-time { color: #fff; font-size: 14px; font-weight: 600; text-align: center; margin-top: 14px; }
        
        .push-notification-bubble { background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); margin: 40px 10px 0; border-radius: 12px; padding: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
        .push-bubble-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .push-app-info { display: flex; align-items: center; gap: 6px; }
        .push-app-icon { width: 18px; height: 18px; background: #000; border-radius: 4px; }
        .push-app-name { font-size: 11px; font-weight: 600; color: #374151; }
        .push-now { font-size: 10px; color: #4b5563; }
        
        .push-bubble-content { font-size: 13px; color: #1f2937; }
        .push-bubble-title { font-weight: 700; margin-bottom: 2px; }
        .push-bubble-body { font-size: 12px; line-height: 1.4; color: #374151; }
        .push-bubble-img { width: 100%; height: 100px; object-fit: cover; border-radius: 6px; margin-top: 8px; }

        /* FOOTER */
        .push-modal-footer { padding: 16px 24px; border-top: 1px solid #e2e8f0; background: #fff; display: flex; justify-content: flex-end; gap: 12px; }
        .push-modal-submit { background: #3b82f6; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3); }
        .push-modal-submit:hover:not(:disabled) { background: #2563eb; }
        .push-modal-submit:disabled { background: #cbd5e1; cursor: not-allowed; box-shadow: none; }
        .push-modal-cancel { background: #fff; border: 1px solid #cbd5e1; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 13px; color: #64748b; cursor: pointer; }

        .req { color: #ef4444; }
        .mt-2 { margin-top: 8px; }
      `}</style>
    </div>
  );
}