// app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import ManualList from "@/components/ManualList";
import Link from "next/link"; 

/* ========= 型 (埋め込み) ========= */

type Manual = {
  manualId: string;
  title: string;
  brandId?: string;
  brand?: string;
  bizId?: string;
  biz?: string;
  desc?: string | null;
  updatedAt?: string;
  tags?: string[];
  embedUrl?: string;
  isNew?: boolean;
  noDownload?: boolean;
  readCount?: number;
  startDate?: string; 
  endDate?: string; 
};

type Brand = {
  brandId: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
};

type Dept = {
  deptId: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
};

type Contact = {
  contactId: string;
  name: string;
  email: string;
  brandId: string; 
  deptId: string;
  role?: string;
  tags?: string[];
  hitTags?: string[]; 
};

type News = {
  newsId: string;
  title: string;
  body?: string;
  brandId?: string; 
  deptId?: string; 
  tags?: string[];
  startDate?: string; 
  endDate?: string; 
  updatedAt?: string;
};

// ★追加: メッセージ履歴の型定義
type Message = {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    loading?: boolean;
};


/* ========= 定数 ========= */

const ALL_BRAND_ID = "__ALL_BRAND__";
const ALL_DEPT_ID = "__ALL_DEPT__";
const INQUIRY_MAIL = "support@example.com";

/* ========= ログアウト処理 (フックの外で定義) ========= */
async function handleLogout() {
  try {
    const res = await fetch("/api/logout", {
      method: "POST",
    });

    if (res.ok) {
      window.location.href = "/login";
    } else {
      console.error("Logout failed:", await res.text());
      alert("ログアウト処理に失敗しました。");
    }
  } catch (e) {
    console.error("Logout error:", e);
    alert("通信エラーによりログアウトできませんでした。");
  }
}

/* ========= ページ本体 ========= */

export default function HomePage() {
  const isAdmin = true;

  /* ========= Amazon Q（Knowbie） - ストリーミング対応 ========= */
  
  const [prompt, setPrompt] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]); // ★回答履歴State
  function typewriter(text: string, onDelta: (t: string) => void, speedMs = 12) {
  let i = 0;
  const id = window.setInterval(() => {
    i += 1;
    onDelta(text.slice(0, i));
    if (i >= text.length) window.clearInterval(id);
  }, speedMs);
  return () => window.clearInterval(id);
}

  async function handleAsk() {
  if (!prompt.trim() || loadingAI) return;

  const userPrompt = prompt.trim();
  setPrompt("");

  const newUserMessage: Message = { id: Date.now(), role: "user", content: userPrompt };
  const newAssistantId = Date.now() + 1;

  // ✅ 無言ゼロ
  const newAssistantMessage: Message = {
    id: newAssistantId,
    role: "assistant",
    content: "送信しました。検索しています…",
    loading: true,
  };

  setMessages((prev) => [...prev, newUserMessage, newAssistantMessage]);

  setTimeout(() => {
    const chatBody = document.querySelector(".kb-chat-body");
    if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
  }, 50);

  setLoadingAI(true);

  // ✅ 3秒超えたらメッセージ変更（体感改善）
  const slowTimer = window.setTimeout(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === newAssistantId && m.loading
          ? { ...m, content: "検索に時間がかかっています…（10〜20秒ほどかかる場合があります）" }
          : m
      )
    );
  }, 3000);

  try {
    const res = await fetch("/api/amazonq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userPrompt }),
    });

    // ✅ JSONとして読む
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      const msg = data?.error || `API error: ${res.status} ${res.statusText}`;
      throw new Error(msg);
    }

    const answer = String(data.answer ?? "(回答が空でした)");

    // ✅ 回答を表示（まずは一気に表示でOK）
    setMessages((prev) =>
      prev.map((m) =>
        m.id === newAssistantId ? { ...m, content: answer, loading: false } : m
      )
    );

    setTimeout(() => {
      const chatBody = document.querySelector(".kb-chat-body");
      if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
    }, 50);
  } catch (e: any) {
    const errorMessage = e?.message || "通信エラーが発生しました。";
    setMessages((prev) =>
      prev.map((m) =>
        m.id === newAssistantId
          ? { ...m, loading: false, content: `[エラー] ${errorMessage}` }
          : m
      )
    );
  } finally {
    window.clearTimeout(slowTimer);
    setLoadingAI(false);
  }
}


  /* ========= DynamoDB データ (既存のロジックはすべて維持) ========= */

  const [manuals, setManuals] = useState<Manual[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newsList, setNewsList] = useState<News[]>([]);

  const [loadingManuals, setLoadingManuals] = useState(true);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);

  const [previewManual, setPreviewManual] = useState<Manual | null>(null);

  const PAGE_SIZE = 5;
  const [manualPage, setManualPage] = useState(1);

  useEffect(() => {
    const fetchData = async () => {
        try {
            const [
                manualsRes,
                brandsRes,
                deptsRes,
                contactsRes,
                newsRes,
            ] = await Promise.all([
                fetch("/api/manuals").then(res => res.json()),
                fetch("/api/brands").then(res => res.json()),
                fetch("/api/depts").then(res => res.json()),
                fetch("/api/contacts").then(res => res.json()),
                fetch("/api/news?onlyActive=1").then(res => res.json()),
            ]);

            const brandsList: Brand[] = (brandsRes.brands || []).sort(
                (a: Brand, b: Brand) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999)
            );
            const deptsList: Dept[] = (deptsRes.depts || []).sort(
                (a: Dept, b: Dept) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999)
            );

            setManuals(manualsRes.manuals || []);
            setBrands(brandsList);
            setDepts(deptsList);
            setContacts(contactsRes.contacts || []);
            setNewsList(newsRes.news || []);

        } catch (e) {
            console.error("Failed to fetch initial data:", e);
        } finally {
            setLoadingManuals(false);
            setLoadingBrands(false);
            setLoadingDepts(false);
            setLoadingContacts(false);
            setLoadingNews(false);
        }
    };
    fetchData();
  }, []);

  const brandMap = useMemo(
    () =>
      brands.reduce<Record<string, Brand>>((map, b) => {
        map[b.brandId] = b;
        return map;
      }, {}),
    [brands]
  );

  const deptMap = useMemo(
    () =>
      depts.reduce<Record<string, Dept>>((map, d) => {
        map[d.deptId] = d;
        return map;
      }, {}),
    [depts]
  );

  const [keyword, setKeyword] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState<string>(ALL_BRAND_ID);
  const [selectedDeptId, setSelectedDeptId] = useState<string>(ALL_DEPT_ID);
  const [contactSearch, setContactSearch] = useState("");

  const brandOptions: { id: string; label: string }[] = useMemo(() => {
    const arr: { id: string; label: string }[] = [
      { id: ALL_BRAND_ID, label: "全て" },
    ];
    brands.forEach((b) => arr.push({ id: b.brandId, label: b.name }));
    return arr;
  }, [brands]);

  const deptOptions: { id: string; label: string }[] = useMemo(() => {
    const arr: { id: string; label: string }[] = [
      { id: ALL_DEPT_ID, label: "全て" },
    ];
    depts.forEach((d) => arr.push({ id: d.deptId, label: d.name }));
    return arr;
  }, [depts]);

  const filteredManuals = useMemo(() => {
    if (!Array.isArray(manuals)) return [];

    const kw = (keyword ?? "").toString().trim().toLowerCase();
    const hasKeyword = kw.length > 0;

    const result = manuals.filter((m) => {
      if (!m) return false;

      const title = (m.title ?? "").toString().toLowerCase();
      const desc = (m.desc ?? "").toString().toLowerCase();
      const tags = (m.tags ?? []).map((t) =>
        (t ?? "").toString().toLowerCase()
      );

      const matchKeyword =
        !hasKeyword ||
        title.includes(kw) ||
        desc.includes(kw) ||
        tags.some((t) => t.includes(kw));

      if (!matchKeyword) return false;

      if (hasKeyword) {
        return true;
      }

      if (selectedBrandId && selectedBrandId !== ALL_BRAND_ID) {
        const manualBrandId = (m.brandId ?? "").toString();
        if (manualBrandId !== selectedBrandId) return false;
      }

      if (selectedDeptId && selectedDeptId !== ALL_DEPT_ID) {
        const manualDeptId = (m.bizId ?? "").toString();
        if (manualDeptId !== selectedDeptId) return false;
      }

      return true;
    });

    return result;
  }, [manuals, keyword, selectedBrandId, selectedDeptId]);

  useEffect(() => {
    setManualPage(1);
  }, [keyword, selectedBrandId, selectedDeptId]);

  const totalManualPages = Math.max(
    1,
    Math.ceil(filteredManuals.length / PAGE_SIZE)
  );

  const pagedManuals = useMemo(() => {
    const start = (manualPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return filteredManuals.slice(start, end);
  }, [filteredManuals, manualPage, PAGE_SIZE]);

  const recentTags = useMemo(() => {
    const counts: Record<string, number> = {};
    manuals.forEach((m) => {
      (m.tags || []).forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
  }, [manuals]);

  const filteredContacts = useMemo(() => {
  const kw = contactSearch.trim().toLowerCase();

  return contacts
    .map((c) => {
      // ブランド絞り込み
      if (
        selectedBrandId !== ALL_BRAND_ID &&
        selectedBrandId &&
        !(c.brandId === "ALL" || c.brandId === selectedBrandId)
      ) {
        return null;
      }

      // 部署絞り込み
      if (
        selectedDeptId !== ALL_DEPT_ID &&
        selectedDeptId &&
        c.deptId !== selectedDeptId
      ) {
        return null;
      }

      // キーワードなし → hitTags は空配列で確定
      if (!kw) {
        return { ...c, hitTags: [] as string[] };
      }

      const deptLabel = deptMap[c.deptId]?.name ?? "";
      const tags = c.tags ?? []; // ★常に配列

      const haystack = [c.name, c.email, c.role ?? "", deptLabel, ...tags]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(kw)) return null;

      const hitTags = tags.filter((tag) => tag.toLowerCase().includes(kw));

      // ★常に hitTags: string[]
      return { ...c, hitTags };
    })
    // ★hitTags は必須（undefined を許さない）
    .filter((v): v is Contact & { hitTags: string[] } => v !== null);
}, [contacts, selectedBrandId, selectedDeptId, contactSearch, deptMap]);

  const currentBrandLabel =
    selectedBrandId === ALL_BRAND_ID
      ? "全社"
      : brandMap[selectedBrandId]?.name || "全社";

  const filteredNews = useMemo(() => {
    return newsList.sort((a, b) => {
        const ad = a.updatedAt || a.startDate || "";
        const bd = b.updatedAt || b.startDate || "";
        return (bd || "").localeCompare(ad || "");
    });
  }, [newsList]);


  const getEmbedSrc = (url?: string) => {
    if (!url) return "";

    let embedSrc = url;

    if (embedSrc.includes("docs.google.com/presentation")) {
      if (!embedSrc.includes('embed')) {
          embedSrc = embedSrc.replace('/edit', '/embed');
      }
      if (!embedSrc.includes('start=')) {
          embedSrc += '?start=false&loop=false&delayms=3000';
      }
      return embedSrc;
    }

    if (embedSrc.includes("drive.google.com/file")) {
      const m = embedSrc.match(
        /https:\/\/drive\.google\.com\/file\/d\/([^/]+)/
      );
      if (m) {
        const id = m[1];
        return `https://drive.google.com/file/d/${id}/preview`;
      }
    }

    return embedSrc;
  };


  /* ========= 画面 ========= */

  return (
    <div className="kb-root">
      {/* ===== Top bar (ロゴ画像を使用) ===== */}
      <div className="kb-topbar">
        <div
          className="kb-topbar-left"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
          }}
        >
          {/* 左：KBアイコン */}
          <img
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
            alt="KB Logo"
            style={{
              width: "48px",
              height: "48px",
              objectFit: "contain",
            }}
          />

          {/* 右：KnowBase文字ロゴ */}
          <img
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png"
            alt="KnowBase Text Logo"
            style={{
              height: "22px",
              objectFit: "contain",
            }}
          />
        </div>

        <div className="kb-topbar-center">
          <input
            className="kb-search-input"
            placeholder="キーワードで探す（例：Canva テロップ）"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="kb-topbar-right">
          <span className="kb-user-email">demo-all@example.com</span>

          {isAdmin && (
            <button
              className="kb-tab kb-tab-active"
              onClick={() => (window.location.href = "/admin")}
            >
              管理画面
            </button>
          )}

          {/* ログアウトボタン */}
          <button className="kb-logout-btn" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      </div>

      {/* ===== 3カラム本体 ===== */}
      <div className="kb-main">
        {/* === 左：フィルタ === */}
        <aside className="kb-panel" aria-label="フィルター">
          {/* ブランドで探す */}
          <div className="kb-panel-section">
            <div className="kb-panel-title">ブランドで探す</div>
            <div className="kb-chip-list vertical">
              {brandOptions.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={
                    "kb-chip" +
                    (selectedBrandId === b.id ? " kb-chip-active" : "")
                  }
                  onClick={() => setSelectedBrandId(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* 部署で探す */}
          <div className="kb-panel-section">
            <div className="kb-panel-title">部署で探す</div>
            <div className="kb-chip-list vertical">
              {deptOptions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={
                    "kb-chip" +
                    (selectedDeptId === d.id ? " kb-chip-active" : "")
                  }
                  onClick={() => setSelectedDeptId(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* 最近のタグ */}
          <div className="kb-panel-section">
            <div className="kb-panel-title">最近のタグ</div>
            <div className="kb-chip-list">
              {recentTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="kb-chip small"
                  onClick={() => setKeyword(tag)}
                >
                  #{tag}
                </button>
              ))}
              {recentTags.length === 0 && (
                <span className="kb-subnote">
                  タグがまだ登録されていません。
                </span>
              )}
            </div>
          </div>
        </aside>

        {/* === 中央：Knowbie + お知らせ + マニュアル一覧 === */}
        <main className="kb-center">
          {/* Knowbie カード（Amazon Q） */}
          <div className="kb-card">
            <div className="kb-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="kb-avatar">
                  {/* Knowbie アイコン画像 */}
                  <img
                    src="https://houjin-manual.s3.us-east-2.amazonaws.com/Knowble_icon.png"
                    alt="Knowbie アイコン"
                    style={{
                      width: "32px",
                      height: "32px",
                      objectFit: "contain",
                    }}
                  />
                </div>
                <div>
                  <div className="kb-card-title">Knowbie（ノウビー）</div>
                  <div className="kb-card-subtitle">
                    社内マニュアル／手順の質問に回答します
                  </div>
                </div>
              </div>
              <div className="kb-subnote">※ Amazon Q API を利用</div>
            </div>

            <div className="kb-chat-box">
              <div className="kb-chat-header">💬 チャット</div>
              
              {/* ★修正: チャット履歴の表示エリア */}
              <div className="kb-chat-body" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {messages.length === 0 && (
                  <span className="kb-subnote">
                    質問を入力するとここに回答が表示されます
                  </span>
                )}
                
                {messages.map(msg => (
                  <div 
                    key={msg.id}
                    className={`kb-chat-message kb-chat-message-${msg.role}`}
                    // スタイルをインラインで適用
                    style={{
                        // ユーザーメッセージは右揃え
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        marginLeft: msg.role === 'user' ? 'auto' : '0', 
                        display: 'flex',
                        gap: '8px',
                        flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                    }}
                  >
                    {/* ユーザーメッセージの吹き出し */}
                    {msg.role === 'user' && (
                        <div
                            style={{
                                padding: '8px 12px',
                                borderRadius: '12px',
                                fontSize: '13px',
                                background: '#0ea5e9',
                                color: '#fff',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}
                        >
                            <div style={{fontWeight: 600, marginBottom: '4px', color: '#e0f2fe'}}>あなた:</div>
                            {msg.content}
                        </div>
                    )}

                    {/* アシスタントメッセージの吹き出しとアイコン */}
                    {msg.role === 'assistant' && (
                        <>
                            {/* アイコン */}
                            <img
                                src="https://houjin-manual.s3.us-east-2.amazonaws.com/Knowble_icon.png"
                                alt="Knowbie Icon"
                                style={{
                                    width: '32px',
                                    height: '32px',
                                    objectFit: 'contain',
                                    borderRadius: '999px',
                                    flexShrink: 0,
                                }}
                            />
                            {/* テキスト */}
                            <div
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '12px',
                                    fontSize: '13px',
                                    background: '#334155',
                                    color: '#fff',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                }}
                            >
                                <div style={{fontWeight: 600, marginBottom: '4px', color: '#60a5fa'}}>Knowbie:</div>
                                {msg.content}
                                {msg.loading && (
                                    <span className="kb-subnote" style={{ marginLeft: '8px', color: '#94a3b8' }}>
                                        ...Thinking
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                  </div>
                ))}

              </div>
              {/* ★修正: 入力エリアは handleAsk を使用 */}
              <div className="kb-chat-input-row">
                <input
                  className="kb-chat-input"
                  placeholder="例：入会手続きの流れを教えて / Canva テロップの作り方"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    // Enterキーで送信
                    if (e.key === 'Enter') handleAsk();
                  }}
                />
                <button
                  className="kb-chat-send"
                  onClick={handleAsk}
                  disabled={loadingAI}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#0ea5e9",
                    borderRadius: "999px",
                    width: "40px",
                    height: "40px",
                    padding: 0,
                    border: "none",
                    cursor: "pointer",
                    opacity: loadingAI ? 0.5 : 1,
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              </div>
            </div>

            <div className="kb-suggestion-row">
              <div
                className="kb-suggestion"
                onClick={() => setPrompt("入退会手続きの流れを教えて")}
              >
                入退会の流れ
              </div>
              <div
                className="kb-suggestion"
                onClick={() => setPrompt("契約プランの違いをまとめてください")}
              >
                契約プランの比較
              </div>
              <div
                className="kb-suggestion"
                onClick={() => setPrompt("店舗スタッフ研修のポイントを教えて")}
              >
                研修のポイント
              </div>
            </div>
          </div>

          {/* お知らせカード */}
          <div className="kb-card kb-manual-card">
            <div className="kb-card-header">
              <div>
                <div className="kb-card-title">お知らせ</div>
                <div className="kb-card-meta">
                  {loadingNews
                    ? "読み込み中..."
                    : `${filteredNews.length} 件表示中`}
                </div>
              </div>
            </div>

            {loadingNews && <div>読み込み中...</div>}
            {!loadingNews && filteredNews.length === 0 && (
              <div style={{ fontSize: 13, color: "#6b7280", paddingTop: 8 }}>
                現在表示できるお知らせはありません。
              </div>
            )}

            {!loadingNews &&
              filteredNews.map((n) => (
                <div className="kb-manual-item" key={n.newsId}>
                  <div className="kb-manual-main">
                    <div className="kb-manual-title">{n.title}</div>
                    <div className="kb-manual-meta">
                      {n.startDate && n.endDate
                        ? `${n.startDate} 〜 ${n.endDate}`
                        : n.startDate
                        ? `${n.startDate} 〜`
                        : n.endDate
                        ? `〜 ${n.endDate}`
                        : ""}
                      {n.updatedAt ? ` / 更新日: ${n.updatedAt}` : ""}
                    </div>
                    {n.body && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "#4b5563",
                          marginTop: 4,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {n.body}
                      </div>
                    )}
                    <div className="kb-tag-row">
                      {(n.tags || []).map((t, i) => (
                        <span className="kb-tag" key={i}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {/* マニュアル一覧 */}
          <div className="kb-card kb-manual-card">
            <div className="kb-card-header">
              <div>
                <div className="kb-card-title">マニュアル一覧</div>
                <div className="kb-card-meta">
                  {loadingManuals
                    ? "読み込み中..."
                    : filteredManuals.length === 0
                    ? "0 件表示中"
                    : `${filteredManuals.length} 件中 ${
                        (manualPage - 1) * PAGE_SIZE + 1
                      }〜${Math.min(
                        manualPage * PAGE_SIZE,
                        filteredManuals.length
                      )} 件を表示`}
                </div>
              </div>
            </div>

            {loadingManuals && <div>読み込み中...</div>}

            {!loadingManuals && filteredManuals.length === 0 && (
              <div style={{ fontSize: 13, color: "#6b7280", paddingTop: 8 }}>
                条件に一致するマニュアルがありません。
              </div>
            )}

            {!loadingManuals && filteredManuals.length > 0 && (
              <>
                <ManualList
                  manuals={pagedManuals}
                  brandMap={brandMap}
                  deptMap={deptMap}
                  onPreview={setPreviewManual}
                  pageSize={PAGE_SIZE} 
                />

                {/* ページャー */}
                {totalManualPages > 1 && (
                  <div className="kb-pager">
                    <button
                      type="button"
                      className="kb-pager-btn"
                      disabled={manualPage === 1}
                      onClick={() =>
                        setManualPage((p) => Math.max(1, p - 1))
                      }
                    >
                      前へ
                    </button>
                    <span className="kb-pager-info">
                      {manualPage} / {totalManualPages}
                    </span>
                    <button
                      type="button"
                      className="kb-pager-btn"
                      disabled={manualPage === totalManualPages}
                      onClick={() =>
                        setManualPage((p) =>
                          Math.min(totalManualPages, p + 1)
                        )
                      }
                    >
                      次へ
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        {/* === 右：担当者リスト === */}
<aside className="kb-panel">
  <div className="kb-panel-header-row">
    <div className="kb-panel-title">担当者リスト（{currentBrandLabel}）</div>
  </div>

  <div className="kb-contact-inquiry-wrap">
    <button
      type="button"
      className="kb-contact-inquiry-btn"
      onClick={() => {
        const mail = INQUIRY_MAIL;
        window.open(
          `https://mail.google.com/mail/?view=cm&fs=1&to=${mail}&su=${encodeURIComponent(
            "[Know Base] お問い合わせ"
          )}`,
          "_blank"
        );
      }}
    >
      問い合わせ
    </button>
  </div>

  <input
    className="kb-small-input"
    placeholder="担当業務や名前・メールで検索"
    type="text"
    value={contactSearch}
    onChange={(e) => setContactSearch(e.target.value)}
  />

  <div className="kb-contact-list">
    {loadingContacts && <div>読み込み中...</div>}
    {!loadingContacts && filteredContacts.length === 0 && (
      <div className="kb-subnote">該当する担当者がいません。</div>
    )}

    {!loadingContacts &&
      filteredContacts.map((c) => {
        const deptLabel = deptMap[c.deptId]?.name ?? "";
        const initial = c.name.charAt(0);
        const showHitTags =
          contactSearch.trim() && c.hitTags && c.hitTags.length > 0;

        return (
          <div className="kb-contact-item" key={c.contactId}>
            <div className="kb-contact-avatar">{initial}</div>

            <div className="kb-contact-body">
              <div className="kb-contact-name">{c.name}</div>
              <div className="kb-contact-dept">{deptLabel}</div>
              <a
                className="kb-contact-mail"
                href={`https://mail.google.com/mail/?view=cm&fs=1&to=${c.email}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {c.email}
              </a>

              {showHitTags && (
                <div className="kb-contact-hit-tags">
                  ヒットしたタグ：
                  {c.hitTags!.map((t, i) => (
                    <span className="kb-hit-tag" key={i}>
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <a
              className="kb-contact-mail-btn"
              href={`https://mail.google.com/mail/?view=cm&fs=1&to=${c.email}&su=${encodeURIComponent(
                "[Know Base] お問い合わせ"
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              title="メール送信 (Gmail)"
              aria-label="メール送信 (Gmail)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </a>
          </div>
        );
      })}
  </div>
</aside>
      </div>

      {/* ===== マニュアル プレビューモーダル (省略) ===== */}
      {previewManual && (
        <div
          className="kb-modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "16px",
            zIndex: 9999,
            backdropFilter: "blur(4px)",
          }}
          onClick={() => setPreviewManual(null)}
        >
          <div
            className="kb-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "1040px",
              maxHeight: "90vh",
              background:
                "linear-gradient(135deg, #0f172a 0%, #020617 20%, #f9fafb 20%, #ffffff 100%)",
              borderRadius: 20,
              padding: 0,
              boxShadow: "0 24px 60px rgba(15,23,42,0.5)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* ヘッダー */}
            <div
              style={{
                padding: "16px 20px",
                background:
                  "radial-gradient(circle at top left, #0ea5e9, #020617)",
                color: "#e5f4ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "999px",
                    background: "rgba(15,23,42,0.6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                  }}
                >
                  📘
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      marginBottom: 2,
                      color: "#f9fafb",
                    }}
                  >
                    {previewManual.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.9,
                    }}
                  >
                    {previewManual.brandId &&
                      (brandMap[previewManual.brandId]?.name ||
                        previewManual.brand ||
                        "ブランド未設定")}
                    {previewManual.bizId &&
                      ` / ${
                        deptMap[previewManual.bizId]?.name ||
                        previewManual.biz ||
                        "部署未設定"
                      }`}
                    {previewManual.updatedAt &&
                      ` / 更新日: ${previewManual.updatedAt}`}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {previewManual.embedUrl && (
                  <button
                    className="kb-primary-btn"
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "none",
                      background: "#f9fafb",
                      color: "#0f172a",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      window.open(previewManual.embedUrl!, "_blank");
                    }}
                  >
                    新しいタブで開く
                  </button>
                )}
                <button
                  className="kb-secondary-btn"
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(248,250,252,0.6)",
                    background: "transparent",
                    color: "#e5f4ff",
                    cursor: "pointer",
                  }}
                  onClick={() => setPreviewManual(null)}
                >
                  閉じる
                </button>
              </div>
            </div>

            {/* ボディ */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: 16,
                gap: 12,
                background: "#f9fafb",
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* タグ & 説明 */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {(previewManual.tags || []).length > 0 && (
                  <div className="kb-tag-row">
                    {(previewManual.tags || []).map((t, i) => (
                      <span
                        className="kb-tag"
                        key={i}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "#e0f2fe",
                          color: "#0369a1",
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {previewManual.desc && (
                  <div
                    style={{
                      fontSize: 13,
                      color: "#374151",
                      whiteSpace: "pre-wrap",
                      borderRadius: 12,
                      background: "#ffffff",
                      padding: 10,
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    {previewManual.desc}
                  </div>
                )}
              </div>

              {/* プレビューエリア（16:9 固定） */}
              {(() => {
                const embedSrc = getEmbedSrc(previewManual.embedUrl);
                if (!embedSrc) {
                  return (
                    <div
                      className="kb-subnote"
                      style={{
                        fontSize: 13,
                        color: "#6b7280",
                        padding: 12,
                        borderRadius: 10,
                        background: "#e5e7eb",
                      }}
                    >
                      このマニュアルにはプレビュー用の URL が設定されていません。
                    </div>
                  );
                }

                return (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 960,
                        aspectRatio: "16 / 9",
                        borderRadius: 14,
                        overflow: "hidden",
                        border: "1px solid #d1d5db",
                        background: "#020617",
                        position: "relative",
                      }}
                    >
                      <iframe
                        src={embedSrc}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          border: "none",
                          background: "#020617",
                        }}
                        allowFullScreen
                        loading="lazy"
                      />

                      {/* 表示されない場合のメッセージバー */}
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: 0,
                          padding: "6px 10px",
                          fontSize: 11,
                          color: "#e5e7eb",
                          background:
                            "linear-gradient(90deg, rgba(15,23,42,0.95), rgba(15,23,42,0.7))",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span>
                          表示されない場合は「新しいタブで開く」ボタンから閲覧してください。
                        </span>
                        {previewManual.embedUrl && (
                          <button
                            style={{
                              fontSize: 11,
                              padding: "4px 8px",
                              borderRadius: 999,
                              border: "1px solid rgba(248,250,252,0.8)",
                              background: "transparent",
                              color: "#e5e7eb",
                              cursor: "pointer",
                            }}
                            onClick={() =>
                              window.open(previewManual.embedUrl!, "_blank")
                            }
                          >
                            タブで開く
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}