// app/store-settings/push/new/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import ConditionGroupForm, { type CondGroup, newCondGroup } from "@/components/ConditionGroupForm";

// 契約種別マスタ (実マスタ提供までの暫定。member-search 側 e.契約形態名 と突合予定)
const CONTRACT_TYPES = ["レギュラー", "ナイト", "デイ", "ホリデー", "学生", "家族", "法人", "1day/OTP"];

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
  const [imageUrl, setImageUrl] = useState(""); // お知らせ欄に埋め込む画像 (今回スコープ)
  // 条件グループ (グループ内は AND、グループ間は groupOp)
  const [groups, setGroups] = useState<CondGroup[]>([newCondGroup(CONTRACT_TYPES)]);
  const [groupOp, setGroupOp] = useState<"OR" | "AND">("OR");
  const updateGroup = (i: number, patch: Partial<CondGroup>) =>
    setGroups((prev) => prev.map((g, gi) => (gi === i ? { ...g, ...patch } : g)));
  const addGroup = () => setGroups((prev) => [...prev, newCondGroup(CONTRACT_TYPES)]);
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

  // 送信 (isDraft=true なら下書き=送信されない安全保存)
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
                <label>お知らせ画像URL（任意）</label>
                <input
                  type="url" className="push-input" value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/image.png"
                />
              </div>
              <div className="push-hint">
                ※ PUSH通知バナー自体はテキストのみ（画像はアプリ改修が必要）。画像はアプリの「お知らせ欄」に埋め込まれます。
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
                      <ConditionGroupForm group={g} onChange={(patch) => updateGroup(gi, patch)} contractTypes={CONTRACT_TYPES} cls="push" />
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

          {/* COLUMN 3: プレビュー (ブランド別) */}
          <section className="push-col-preview">
            <div className="push-panel-header-sticky">スマホ通知プレビュー（{theme.label}）</div>
            <div className="push-preview-frame">
              <div className="push-phone-mockup">
                <div className="push-notch"></div>
                <div className="push-screen">
                  <div className="push-time">10:41</div>
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
                  {/* お知らせ欄プレビュー (画像埋め込み) */}
                  <div className="push-notification-bubble" style={{ marginTop: 12 }}>
                    <div className="push-bubble-header">
                      <span className="push-app-name" style={{ color: theme.color }}>お知らせ</span>
                    </div>
                    {imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl} alt="" style={{ width: "100%", borderRadius: 8, margin: "6px 0" }} />
                    )}
                    <div className="push-bubble-content">
                      <div className="push-bubble-title">{title || "タイトル"}</div>
                      <div className="push-bubble-body">{body || "本文プレビュー"}</div>
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
