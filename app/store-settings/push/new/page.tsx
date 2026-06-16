// app/store-settings/push/new/page.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";

const generateMockMembers = (count: number) => {
  return Array.from({ length: count }).map((_, i) => {
    const isLeaver = i % 10 === 0;
    const isUnpaid = i % 23 === 0;
    return {
      id: `1000${i + 1}`,
      name: `利用者 ${i + 1}`,
      email: `user${i + 1}@example.com`,
      gender: i % 2 === 0 ? "male" : "female",
      joinDate: "2023-04-15",
      leaveDate: isLeaver ? "2025-12-31" : "",
      lastVisitDate: "2026-02-10",
      visitCount: (i * 7) % 50,
      status: isLeaver ? "退会済" : "在籍中",
      hasUnpaid: isUnpaid,
    };
  });
};

export default function NewPushPage() {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // フォーム
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [condition, setCondition] = useState({
    joinDateFrom: "", joinDateTo: "",
    leaveDateFrom: "", leaveDateTo: "",
    visitCountFrom: "", visitCountTo: "",
    gender: ["male", "female"] as string[],
    membershipStatus: ["stable", "leaver"] as string[],
    hasUnpaidOnly: false,
  });
  const [extractedMembers, setExtractedMembers] = useState<any[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  // スケジュール
  const [isImmediate, setIsImmediate] = useState(true);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  const handleExtract = () => {
    setIsExtracting(true);
    setTimeout(() => {
      const mockResult = generateMockMembers(250);
      setExtractedMembers(mockResult);
      setSelectedMemberIds(new Set(mockResult.map((m) => m.id)));
      setIsExtracting(false);
      setCurrentPage(1);
    }, 400);
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

  const toggleConditionArray = (key: "gender" | "membershipStatus", value: string) => {
    setCondition((prev) => {
      const current = prev[key];
      if (current.includes(value)) return { ...prev, [key]: current.filter((v) => v !== value) };
      return { ...prev, [key]: [...current, value] };
    });
  };

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
          <button
            className="push-primary-btn"
            onClick={requestConfirm}
            disabled={selectedMemberIds.size === 0 || !title}
          >
            内容を確認する ({selectedMemberIds.size}件)
          </button>
        </div>
      </header>

      <main className="push-new-main">
        <div className="push-new-grid">
          {/* COLUMN 1: 設定 */}
          <aside className="push-col-config">
            <div className="push-step-group">
              <div className="push-step-header">
                <div className="push-step-badge">1</div>
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
              <div className="push-hint">
                ※ PUSH 通知は仕様上、本画面ではテキストのみ取り扱います。画像配信は別途配信基盤の設定が必要です。
              </div>
            </div>

            <div className="push-divider" />

            <div className="push-step-group">
              <div className="push-step-header"><div className="push-step-badge">2</div><h3>ターゲット抽出</h3></div>
              <div className="push-filter-box">
                <div className="push-field">
                  <label>入会日範囲</label>
                  <div className="push-row-2">
                    <input type="date" value={condition.joinDateFrom} onChange={(e) => setCondition({ ...condition, joinDateFrom: e.target.value })} />
                    <span>~</span>
                    <input type="date" value={condition.joinDateTo} onChange={(e) => setCondition({ ...condition, joinDateTo: e.target.value })} />
                  </div>
                </div>
                <div className="push-field">
                  <label>退会日範囲</label>
                  <div className="push-row-2">
                    <input type="date" value={condition.leaveDateFrom} onChange={(e) => setCondition({ ...condition, leaveDateFrom: e.target.value })} />
                    <span>~</span>
                    <input type="date" value={condition.leaveDateTo} onChange={(e) => setCondition({ ...condition, leaveDateTo: e.target.value })} />
                  </div>
                </div>
                <div className="push-field">
                  <label>来館回数</label>
                  <div className="push-row-2">
                    <input type="number" value={condition.visitCountFrom} onChange={(e) => setCondition({ ...condition, visitCountFrom: e.target.value })} placeholder="Min" />
                    <input type="number" value={condition.visitCountTo} onChange={(e) => setCondition({ ...condition, visitCountTo: e.target.value })} placeholder="Max" />
                  </div>
                </div>
                <div className="push-field">
                  <label>性別</label>
                  <div className="push-check-row">
                    <label><input type="checkbox" checked={condition.gender.includes("male")} onChange={() => toggleConditionArray("gender", "male")} /> 男性</label>
                    <label><input type="checkbox" checked={condition.gender.includes("female")} onChange={() => toggleConditionArray("gender", "female")} /> 女性</label>
                  </div>
                </div>
                <div className="push-field">
                  <label>会員区分</label>
                  <div className="push-check-row">
                    <label><input type="checkbox" checked={condition.membershipStatus.includes("stable")} onChange={() => toggleConditionArray("membershipStatus", "stable")} /> 在籍中</label>
                    <label><input type="checkbox" checked={condition.membershipStatus.includes("leaver")} onChange={() => toggleConditionArray("membershipStatus", "leaver")} /> 退会済</label>
                  </div>
                </div>
                <div className="push-field">
                  <label className="push-unpaid-check">
                    <input type="checkbox" checked={condition.hasUnpaidOnly} onChange={(e) => setCondition({ ...condition, hasUnpaidOnly: e.target.checked })} /> 未納者のみを抽出
                  </label>
                </div>
                <button className="push-extract-btn" onClick={handleExtract} disabled={isExtracting}>
                  {isExtracting ? "検索中..." : "条件で名簿を作成"}
                </button>
              </div>
            </div>

            <div className="push-divider" />

            <div className="push-step-group">
              <div className="push-step-header"><div className="push-step-badge">3</div><h3>スケジュール</h3></div>
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
            <div className="push-panel-header-sticky">宛先リスト精査 ({selectedMemberIds.size}名)</div>
            <div className="push-list-container">
              {extractedMembers.length > 0 ? (
                <table className="push-list-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.size === extractedMembers.length}
                          onChange={() => {
                            if (selectedMemberIds.size === extractedMembers.length) setSelectedMemberIds(new Set());
                            else setSelectedMemberIds(new Set(extractedMembers.map((m) => m.id)));
                          }}
                        />
                      </th>
                      <th>会員情報</th>
                      <th>区分/来館</th>
                      <th style={{ width: 30 }}>未</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedMembers.map((m) => (
                      <tr key={m.id} className={selectedMemberIds.has(m.id) ? "" : "excluded"}>
                        <td><input type="checkbox" checked={selectedMemberIds.has(m.id)} onChange={() => toggleSelectMember(m.id)} /></td>
                        <td>
                          <div className="push-u-info">
                            <strong>{m.name}</strong>
                            <small>ID:{m.id} | {m.email}</small>
                          </div>
                        </td>
                        <td>
                          <div className="push-u-meta">
                            <span className={`status-badge ${m.status === "退会済" ? "leaver" : "stable"}`}>{m.status}</span>
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
                <div className="push-empty-state">STEP 2 で条件を指定して<br />「名簿を作成」してください</div>
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

          {/* COLUMN 3: プレビュー */}
          <section className="push-col-preview">
            <div className="push-panel-header-sticky">スマホ通知プレビュー</div>
            <div className="push-preview-frame">
              <div className="push-phone-mockup">
                <div className="push-notch"></div>
                <div className="push-screen">
                  <div className="push-time">10:41</div>
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
                <span className={`push-confirm-val ${isImmediate ? "emphasis warn" : "emphasis"}`}>{scheduledLabel}</span>
              </div>
            </div>
            <footer className="push-confirm-footer">
              <button className="push-modal-cancel" onClick={() => setConfirmOpen(false)} disabled={sending}>戻って修正する</button>
              <button className="push-modal-submit" onClick={handleSubmit} disabled={sending}>
                {sending ? "送信中..." : isImmediate ? "今すぐ送信する" : "予約配信を確定する"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
