// app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ManualList from "@/components/ManualList";
import ContactList from "@/components/ContactList";

/* ========= 型定義 ========= */

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
  email?: string;
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
  targetGroupIds?: string[];
  tags?: string[];
  fromDate?: string | null;
  toDate?: string | null;
  updatedAt?: string;
  isHidden?: boolean;
};

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
};

/* ========= 定数 ========= */

const ALL_BRAND_ID = "__ALL_BRAND__";
const ALL_DEPT_ID = "__ALL_DEPT__";
const INQUIRY_MAIL = "support@example.com";

/* ========= ヘルパー関数: JST変換 ========= */

function formatToJST(dateStr?: string) {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    return date.toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return dateStr;
  }
}

/* ========= ログアウト ========= */

async function handleLogout() {
  try {
    const res = await fetch("/api/logout", { method: "POST" });
    if (res.ok) window.location.href = "/login";
    else alert("ログアウト処理に失敗しました。");
  } catch {
    alert("通信エラーによりログアウトできませんでした。");
  }
}

/* ========= リッチテキスト（URL/改行/箇条書き） ========= */

function isBulletLine(line: string) {
  const t = line.trim();
  return (
    /^[-*•・]\s+/.test(t) ||
    /^\d+[\.\)]\s+/.test(t) ||
    /^\(\d+\)\s+/.test(t)
  );
}

function stripBullet(line: string) {
  return line
    .trim()
    .replace(/^[-*•・]\s+/, "")
    .replace(/^\d+[\.\)]\s+/, "")
    .replace(/^\(\d+\)\s+/, "");
}

function linkifyText(text: string) {
  const urlRe = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;

  const parts: Array<string | { url: string; label: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = urlRe.exec(text)) !== null) {
    const start = m.index;
    const raw = m[0];
    if (start > last) parts.push(text.slice(last, start));

    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    parts.push({ url, label: raw });

    last = start + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === "string") return <span key={i}>{p}</span>;
        return (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="kb-news-link"
          >
            {p.label}
          </a>
        );
      })}
    </>
  );
}

function renderRichText(body?: string) {
  if (!body) return null;
  const lines = body.replace(/\r\n/g, "\n").split("\n");

  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;

    if (isBulletLine(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && isBulletLine(lines[i])) {
        items.push(stripBullet(lines[i]));
        i++;
      }
      blocks.push(
        <ul className="kb-news-ul" key={`ul-${i}-${items.length}`}>
          {items.map((t, idx) => (
            <li className="kb-news-li" key={idx}>
              {linkifyText(t)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    const paras: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBulletLine(lines[i])) {
      paras.push(lines[i]);
      i++;
    }

    blocks.push(
      <p className="kb-news-p" key={`p-${i}-${paras.length}`}>
        {paras.map((ln, idx) => (
          <span key={idx}>
            {linkifyText(ln)}
            {idx !== paras.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  }

  return <div className="kb-news-rich">{blocks}</div>;
}

/* ========= ページ ========= */

export default function HomePage() {
  /* ========= 1. ユーザー情報と権限の定義 (ここを一番上に!) ========= */
  const [me, setMe] = useState<any>(null); 
  const [isAdminErrorModalOpen, setIsAdminErrorModalOpen] = useState(false);

  // isAdmin の判定
  const isAdmin = useMemo(() => me?.role === "admin", [me]);

  // 管理画面ボタンクリック時のハンドラ
  const handleAdminClick = () => {
    if (isAdmin) {
      window.location.href = "/admin";
    } else {
      setIsAdminErrorModalOpen(true); // ここで呼び出すStateが上に定義されているのでOK
    }
  };

  /* ========= Knowbie（Amazon Q） ========= */

  const [prompt, setPrompt] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  async function handleAsk() {
    if (!prompt.trim() || loadingAI) return;

    const userPrompt = prompt.trim();
    setKeyword(userPrompt);
    setPrompt("");

    const newUserMessage: Message = { id: Date.now(), role: "user", content: userPrompt };
    const newAssistantId = Date.now() + 1;

    const newAssistantMessage: Message = {
      id: newAssistantId,
      role: "assistant",
      content: "送信しました。検索しています…",
      loading: true,
    };

    setMessages((prev) => [...prev, newUserMessage, newAssistantMessage]);
    setLoadingAI(true);

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

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const msg = data?.error || `API error: ${res.status} ${res.statusText}`;
        throw new Error(msg);
      }

      const answer = String(data.answer ?? "(回答が空でした)");

      setMessages((prev) =>
        prev.map((m) => (m.id === newAssistantId ? { ...m, content: answer, loading: false } : m))
      );
    } catch (e: any) {
      const errorMessage = e?.message || "通信エラーが発生しました。";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === newAssistantId ? { ...m, loading: false, content: `[エラー] ${errorMessage}` } : m
        )
      );
    } finally {
      window.clearTimeout(slowTimer);
      setLoadingAI(false);
    }
  }

  /* ========= データ ========= */

  const [manuals, setManuals] = useState<Manual[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newsList, setNewsList] = useState<News[]>([]);

  // ローディング状態の統合
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadingManuals, setLoadingManuals] = useState(true);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);

  const [previewManual, setPreviewManual] = useState<Manual | null>(null);

  const PAGE_SIZE = 5;
  const [manualPage, setManualPage] = useState(1);

  // ★ お知らせ：ページネーション
  const NEWS_PAGE_SIZE = 3;
  const [newsPage, setNewsPage] = useState(1);

  /**
   * ★ お知らせ：最大3件アコーディオン
   */
  const [expandedNews, setExpandedNews] = useState<Record<string, boolean>>({});
  const [expandedOrder, setExpandedOrder] = useState<string[]>([]);

  const toggleNews = (newsIdRaw: string) => {
    const newsId = String(newsIdRaw);

    setExpandedNews((prev) => {
      const isOpen = !!prev[newsId];
      return { ...prev, [newsId]: !isOpen };
    });

    setExpandedOrder((prev) => {
      if (prev.includes(newsId)) return prev.filter((id) => id !== newsId);

      const next = [...prev, newsId];
      if (next.length <= 3) return next;

      const oldest = next[0];
      setExpandedNews((mapPrev) => ({ ...mapPrev, [oldest]: false }));
      return next.slice(1);
    });
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [manualsRes, brandsRes, deptsRes, contactsRes, newsRes, meRes] = await Promise.all([
          fetch("/api/manuals").then((res) => res.json()),
          fetch("/api/brands").then((res) => res.json()),
          fetch("/api/depts").then((res) => res.json()),
          fetch("/api/contacts").then((res) => res.json()),
          fetch("/api/news?onlyActive=1").then((res) => res.json()),
          fetch("/api/me").then((res) => res.json()),
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
        setMe(meRes.user || null);
      } catch (e) {
        console.error("Failed to fetch initial data:", e);
      } finally {
        // 全ての通信が終わったら初期ローディングを解除
        setIsInitialLoading(false);
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
    const arr: { id: string; label: string }[] = [{ id: ALL_BRAND_ID, label: "全て" }];
    brands.forEach((b) => arr.push({ id: b.brandId, label: b.name }));
    return arr;
  }, [brands]);

  const deptOptions: { id: string; label: string }[] = useMemo(() => {
    const arr: { id: string; label: string }[] = [{ id: ALL_DEPT_ID, label: "全て" }];
    depts.forEach((d) => arr.push({ id: d.deptId, label: d.name }));
    return arr;
  }, [depts]);

  const filteredManuals = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const hasKeyword = kw.length > 0;

    return manuals.filter((m) => {
      const title = (m.title ?? "").toLowerCase();
      const desc = (m.desc ?? "").toLowerCase();
      const tags = (m.tags ?? []).map((t) => (t ?? "").toLowerCase());

      const matchKeyword =
        !hasKeyword ||
        title.includes(kw) ||
        desc.includes(kw) ||
        tags.some((t) => t.includes(kw));

      if (!matchKeyword) return false;
      if (hasKeyword) return true;

      if (selectedBrandId !== ALL_BRAND_ID && (m.brandId ?? "") !== selectedBrandId) return false;
      if (selectedDeptId !== ALL_DEPT_ID && (m.bizId ?? "") !== selectedDeptId) return false;

      return true;
    });
  }, [manuals, keyword, selectedBrandId, selectedDeptId]);

  useEffect(() => setManualPage(1), [keyword, selectedBrandId, selectedDeptId]);

  const totalManualPages = Math.max(1, Math.ceil(filteredManuals.length / PAGE_SIZE));
  const pagedManuals = useMemo(() => {
    const start = (manualPage - 1) * PAGE_SIZE;
    return filteredManuals.slice(start, start + PAGE_SIZE);
  }, [filteredManuals, manualPage]);

  const recentTags = useMemo(() => {
    const counts: Record<string, number> = {};
    manuals.forEach((m) => (m.tags || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
  }, [manuals]);

  const filteredContacts = useMemo(() => {
    const kw = contactSearch.trim().toLowerCase();

    return contacts
      .map((c) => {
        if (
          selectedBrandId !== ALL_BRAND_ID &&
          selectedBrandId &&
          !(c.brandId === "ALL" || c.brandId === selectedBrandId)
        ) {
          return null;
        }
        if (selectedDeptId !== ALL_DEPT_ID && selectedDeptId && c.deptId !== selectedDeptId) {
          return null;
        }

        if (!kw) return { ...c, hitTags: [] as string[] };

        const deptLabel = deptMap[c.deptId]?.name ?? "";
        const tags = c.tags ?? [];
        const haystack = [c.name, c.email, c.role ?? "", deptLabel, ...tags].join(" ").toLowerCase();

        if (!haystack.includes(kw)) return null;

        const hitTags = tags.filter((tag) => tag.toLowerCase().includes(kw));
        return { ...c, hitTags };
      })
      .filter((v): v is Contact & { hitTags: string[] } => v !== null);
  }, [contacts, selectedBrandId, selectedDeptId, contactSearch, deptMap]);

  const currentBrandLabel =
    selectedBrandId === ALL_BRAND_ID ? "全社" : brandMap[selectedBrandId]?.name || "全社";

  const currentDeptTitleLabel = selectedDeptId === ALL_DEPT_ID ? "" : `（${deptMap[selectedDeptId]?.name}）`;

  const filteredNews = useMemo(() => {
    return newsList.filter((n) => {
      // 1. 非表示フラグのチェック
      if (n.isHidden) return false;

      // 2. 権限グループの判定
      if (me && n.targetGroupIds && n.targetGroupIds.length > 0) {
        if (!n.targetGroupIds.includes(me.groupId)) return false;
      }

      if (selectedBrandId !== ALL_BRAND_ID && n.brandId !== "ALL" && (n.brandId ?? "") !== selectedBrandId) return false;
      if (selectedDeptId !== ALL_DEPT_ID && n.deptId !== "ALL" && (n.deptId ?? "") !== selectedDeptId) return false;
      return true;
    }).sort((a, b) => {
      // API側のキー名に合わせる（もしnews_id, from_date等で来るならここを修正）
      const ad = a.updatedAt || a.fromDate || "";
      const bd = b.updatedAt || b.fromDate || "";
      return (bd || "").localeCompare(ad || "");
    });
  }, [newsList, selectedBrandId, selectedDeptId, me]);

  useEffect(() => setNewsPage(1), [selectedBrandId, selectedDeptId]);

  const totalNewsPages = Math.max(1, Math.ceil(filteredNews.length / NEWS_PAGE_SIZE));
  const pagedNews = useMemo(() => {
    const start = (newsPage - 1) * NEWS_PAGE_SIZE;
    return filteredNews.slice(start, start + NEWS_PAGE_SIZE);
  }, [filteredNews, newsPage]);

  const getEmbedSrc = (url?: string) => {
    if (!url) return "";
    let embedSrc = url;

    if (embedSrc.includes("docs.google.com/presentation")) {
      if (!embedSrc.includes("embed")) embedSrc = embedSrc.replace("/edit", "/embed");
      if (!embedSrc.includes("start=")) embedSrc += "?start=false&loop=false&delayms=3000";
      return embedSrc;
    }

    if (embedSrc.includes("drive.google.com/file")) {
      const m = embedSrc.match(/https:\/\/drive\.google\.com\/file\/d\/([^/]+)/);
      if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
    }

    return embedSrc;
  };

  const [isInquiryModalOpen, setIsInquiryModalOpen] = useState(false);

  const handleInquirySubmit = (email?: string) => {
    const target = email || INQUIRY_MAIL;
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(target)}&su=${encodeURIComponent("[Know Base] お問い合わせ")}`, "_blank");
    setIsInquiryModalOpen(false);
  };

  /* ========= UI ========= */

  // 起動中のローディング画面
  if (isInitialLoading) {
    return (
      <div className="kb-loading-root">
        <div className="kb-loading-container">
          <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" alt="Logo" className="kb-loading-logo" />
          <div className="kb-loading-spinner"></div>
          <p className="kb-loading-text">KnowBase を起動中...</p>
        </div>
        <style>{`
          .kb-loading-root { position: fixed; inset: 0; background: #f8fafc; display: flex; align-items: center; justify-content: center; z-index: 10000; }
          .kb-loading-container { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 24px; }
          .kb-loading-logo { width: 80px; height: 80px; object-fit: contain; animation: kb-pulse 2s infinite ease-in-out; }
          .kb-loading-spinner { width: 40px; height: 40px; border: 4px solid #e2e8f0; border-top: 4px solid #0ea5e9; border-radius: 50%; animation: kb-spin 1s linear infinite; }
          .kb-loading-text { color: #64748b; font-weight: 600; font-size: 14px; letter-spacing: 0.05em; }
          @keyframes kb-spin { to { transform: rotate(360deg); } }
          @keyframes kb-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(0.95); } }
        `}</style>
      </div>
    );
  }

  return (
    <div className="kb-root">
     {/* ===== Top bar ===== */}
      <div className="kb-topbar">
        {/* 修正箇所: ロゴ部分を Link で囲む */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: 'none' }}>
          <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px", cursor: "pointer" }}>
            <img
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
              alt="KB Logo"
              style={{ width: "48px", height: "48px", objectFit: "contain" }}
            />
            <img
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png"
              alt="KnowBase Text Logo"
              style={{ height: "22px", objectFit: "contain" }}
            />
          </div>
        </Link>

        <div className="kb-topbar-center">
          <input
            className="kb-search-input"
            placeholder="キーワードで探す（例：Canva テロップ）"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="kb-topbar-right">
          <span className="kb-user-email">{me?.name ? `${me.name} 様` : "ゲスト"}</span>

          {/* 4. ボタンの表示条件とクリックイベントを修正 */}
          {/* ログイン済みの場合のみボタンを表示し、権限チェックを行う */}
          {me && (
            <button 
  className={`kb-tab ${isAdmin ? "kb-tab-active" : ""}`} 
  style={{ cursor: 'pointer' }} 
  onClick={handleAdminClick}
>
  管理画面
</button>
          )}

          <button className="kb-logout-btn" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      </div>

      <div className="kb-main">
        <aside className="kb-panel" aria-label="フィルター">
          <div className="kb-panel-section">
            <div className="kb-panel-title">ブランドで探す</div>
            <div className="kb-chip-list vertical">
              {brandOptions.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={"kb-chip" + (selectedBrandId === b.id ? " kb-chip-active" : "")}
                  onClick={() => setSelectedBrandId(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="kb-panel-section">
            <div className="kb-panel-title">部署で探す</div>
            <div className="kb-chip-list vertical">
              {deptOptions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={"kb-chip" + (selectedDeptId === d.id ? " kb-chip-active" : "")}
                  onClick={() => setSelectedDeptId(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="kb-panel-section">
            <div className="kb-panel-title">最近のタグ</div>
            <div className="kb-chip-list">
              {recentTags.map((tag) => (
                <button key={tag} type="button" className="kb-chip small" onClick={() => setKeyword(tag)}>
                  #{tag}
                </button>
              ))}
              {recentTags.length === 0 && <span className="kb-subnote">タグがまだ登録されていません。</span>}
            </div>
          </div>
        </aside>

        <main className="kb-center">
          <div className="kb-card">
            <div className="kb-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="kb-avatar">
                  <img
                    src="https://houjin-manual.s3.us-east-2.amazonaws.com/Knowble_icon.png"
                    alt="Knowbie アイコン"
                    style={{ width: 32, height: 32, objectFit: "contain" }}
                  />
                </div>
                <div>
                  <div className="kb-card-title">Knowbie（ノウビー）</div>
                  <div className="kb-card-subtitle">社内マニュアル／手順の質問に回答します</div>
                </div>
              </div>
              <div className="kb-subnote">※ Amazon Q API を利用</div>
            </div>

            <div className="kb-chat-box">
              <div className="kb-chat-header">チャット</div>

              <div className="kb-chat-body" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {messages.length === 0 && <span className="kb-subnote">質問を入力するとここに回答が表示されます</span>}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`kb-chat-message kb-chat-message-${msg.role}`}
                    style={{
                      alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      marginLeft: msg.role === "user" ? "auto" : 0,
                      display: "flex",
                      gap: 8,
                      flexDirection: msg.role === "user" ? "row-reverse" : "row",
                    }}
                  >
                    {msg.role === "user" ? (
                      <div
                        style={{
                          padding: "8px 12px",
                          borderRadius: 12,
                          fontSize: 13,
                          background: "#0ea5e9",
                          color: "#fff",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 4, color: "#e0f2fe" }}>あなた:</div>
                        {msg.content}
                      </div>
                    ) : (
                      <>
                        <img
                          src="https://houjin-manual.s3.us-east-2.amazonaws.com/Knowble_icon.png"
                          alt="Knowbie Icon"
                          style={{ width: 32, height: 32, objectFit: "contain", borderRadius: 999, flexShrink: 0 }}
                        />
                        <div
                          style={{
                            padding: "8px 12px",
                            borderRadius: 12,
                            fontSize: 13,
                            background: "#334155",
                            color: "#fff",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 4, color: "#60a5fa" }}>Knowbie:</div>
                          {msg.content}
                          {msg.loading && (
                            <span className="kb-subnote" style={{ marginLeft: 8, color: "#94a3b8" }}>
                              ...Thinking
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="kb-chat-input-row">
                <input
                  className="kb-chat-input"
                  placeholder="例：入会手続きの流れを教えて / Canva テロップの作り方"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      handleAsk();
                    }
                  }}
                />
                <button className="kb-chat-send" onClick={handleAsk} disabled={loadingAI}>
                  送信
                </button>
              </div>
            </div>
          </div>

          <div className="kb-card kb-manual-card">
            <div className="kb-card-header">
              <div>
                <div className="kb-card-title">お知らせ</div>
                <div className="kb-card-meta">
                  {loadingNews
                    ? "読み込み中..."
                    : filteredNews.length === 0
                    ? "0 件表示中"
                    : `${filteredNews.length} 件中 ${(newsPage - 1) * NEWS_PAGE_SIZE + 1}〜${Math.min(
                        newsPage * NEWS_PAGE_SIZE,
                        filteredNews.length
                      )} 件を表示`}
                </div>
              </div>
            </div>

            {loadingNews && <div>読み込み中...</div>}
            {!loadingNews && filteredNews.length === 0 && (
              <div style={{ fontSize: 13, color: "#6b7280", paddingTop: 8 }}>現在表示できるお知らせはありません。</div>
            )}

            {!loadingNews &&
              pagedNews.map((n, idx) => {
                // keyを確実にユニークにするため index を結合
                const id = n.newsId ? String(n.newsId) : `temp-key-${idx}`;
                const isExpanded = !!expandedNews[id];

                const brandName =
                  n.brandId === "ALL" ? "全社共通" : brandMap[n.brandId || ""]?.name || "ブランド未設定";
                const deptName =
                  n.deptId === "ALL" ? "全部署" : deptMap[n.deptId || ""]?.name || "部署未設定";

                const displayDate = formatToJST(n.updatedAt || n.fromDate || "");

                return (
                  <div className={`kb-news-item ${isExpanded ? "open" : ""}`} key={id}>
                    <button
                      type="button"
                      className="kb-news-head"
                      onClick={() => toggleNews(id)}
                      aria-expanded={isExpanded}
                    >
                      <div className="kb-news-head-left">
                        <div className="kb-news-title">{n.title}</div>

                        <div className="kb-news-meta">
                          <span className="kb-news-meta-strong">
                            {brandName} / {deptName}
                          </span>
                          {displayDate && <span className="kb-news-meta-muted">更新日時：{displayDate} </span>}
                        </div>

                        {(n.tags || []).length > 0 && (
                          <div className="kb-news-tags">
                            {(n.tags || []).map((t, i) => (
                              <span className="kb-news-tag" key={`tag-${id}-${i}`}>
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="kb-news-head-right">{isExpanded ? "▴" : "▾"}</div>
                    </button>

                    <div className="kb-news-body-anim" style={{ maxHeight: isExpanded ? "800px" : "0px" }}>
                      <div className="kb-news-body-inner">
                        {n.body ? renderRichText(n.body) : <div className="kb-news-empty">本文はありません。</div>}
                      </div>
                    </div>
                  </div>
                );
              })}

            {!loadingNews && totalNewsPages > 1 && (
              <div style={{ marginTop: 12 }}>
                <div className="kb-pager">
                  <button
                    type="button"
                    className="kb-pager-btn"
                    disabled={newsPage === 1}
                    onClick={() => setNewsPage((p) => Math.max(1, p - 1))}
                  >
                    前へ
                  </button>
                  <span className="kb-pager-info">
                    {newsPage} / {totalNewsPages}
                  </span>
                  <button
                    type="button"
                    className="kb-pager-btn"
                    disabled={newsPage === totalNewsPages}
                    onClick={() => setNewsPage((p) => Math.min(totalNewsPages, p + 1))}
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="kb-card kb-manual-card">
            <div className="kb-card-header">
              <div>
                <div className="kb-card-title">マニュアル一覧</div>
                <div className="kb-card-meta">
                  {loadingManuals
                    ? "読み込み中..."
                    : filteredManuals.length === 0
                    ? "0 件表示中"
                    : `${filteredManuals.length} 件中 ${(manualPage - 1) * PAGE_SIZE + 1}〜${Math.min(
                        manualPage * PAGE_SIZE,
                        filteredManuals.length
                      )} 件を表示`}
                </div>
              </div>
            </div>

            {loadingManuals && <div>読み込み中...</div>}

            {!loadingManuals && filteredManuals.length === 0 && (
              <div style={{ fontSize: 13, color: "#6b7280", paddingTop: 8 }}>条件に一致するマニュアルがありません。</div>
            )}

            {!loadingManuals && filteredManuals.length > 0 && (
              <>
                <ManualList manuals={pagedManuals.map(m => ({
                  ...m,
                  startDate: formatToJST(m.startDate),
                  updatedAt: formatToJST(m.updatedAt)
                }))} />

                {totalManualPages > 1 && (
                  <div className="kb-pager">
                    <button
                      type="button"
                      className="kb-pager-btn"
                      disabled={manualPage === 1}
                      onClick={() => setManualPage((p) => Math.max(1, p - 1))}
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
                      onClick={() => setManualPage((p) => Math.min(totalManualPages, p + 1))}
                    >
                      次へ
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        <aside className="kb-panel">
          <div className="kb-panel-header-row">
            <div className="kb-panel-title">担当者リスト{currentDeptTitleLabel}</div>
          </div>

          <div className="kb-contact-inquiry-wrap">
            <button
              type="button"
              className="kb-contact-inquiry-btn"
              onClick={() => setIsInquiryModalOpen(true)}
            >
              問い合わせ
            </button>
          </div>

          <div className="kb-contact-list-wrapper" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <ContactList 
              contacts={filteredContacts} 
              contactSearch={contactSearch} 
              setContactSearch={setContactSearch} 
              deptMap={deptMap} 
              loading={loadingContacts}
            />
          </div>
        </aside>
      </div>

      {isInquiryModalOpen && (
        <div
          className="kb-modal-backdrop"
          onClick={() => setIsInquiryModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            zIndex: 10000,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="kb-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 400,
              padding: 24,
              background: "#fff",
              borderRadius: 20,
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div className="kb-card-title" style={{ marginBottom: 16 }}>
              問い合わせ先部署を選択してください
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                className="kb-secondary-btn"
                onClick={() => handleInquirySubmit(INQUIRY_MAIL)}
                style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                }}
              >
                全体問い合わせ先（サポート）
              </button>

              {depts.map((d) => (
                <button
                  key={d.deptId}
                  className="kb-secondary-btn"
                  onClick={() => handleInquirySubmit(d.email)}
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                  }}
                >
                  {d.name}
                </button>
              ))}
            </div>

            <button
              className="kb-logout-btn"
              style={{ marginTop: 20, width: "100%", padding: "10px" }}
              onClick={() => setIsInquiryModalOpen(false)}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

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
            padding: 16,
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
              maxWidth: 1040,
              maxHeight: "90vh",
              background: "linear-gradient(135deg, #0f172a 0%, #020617 20%, #f9fafb 20%, #ffffff 100%)",
              borderRadius: 20,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                background: "radial-gradient(circle at top left, #0ea5e9, #020617)",
                color: "#e5f4ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 999, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📘</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2, color: "#f9fafb" }}>{previewManual.title}</div>
                  <div style={{ fontSize: 12, opacity: 0.9 }}>
                    {previewManual.brandId && (brandMap[previewManual.brandId]?.name || previewManual.brand || "ブランド未設定")}
                    {previewManual.bizId && ` / ${deptMap[previewManual.bizId]?.name || previewManual.biz || "部署未設定"}`}
                    {previewManual.updatedAt && ` / 更新日: ${formatToJST(previewManual.updatedAt)}`}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {previewManual.embedUrl && (
                  <button className="kb-primary-btn" style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, border: "none", background: "#f9fafb", color: "#0f172a", cursor: "pointer" }} onClick={() => window.open(previewManual.embedUrl!, "_blank")}>新しいタブで開く</button>
                )}
                <button className="kb-secondary-btn" style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(248,250,252,0.6)", background: "transparent", color: "#e5f4ff", cursor: "pointer" }} onClick={() => setPreviewManual(null)}>閉じる</button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", padding: 16, gap: 12, background: "#f9fafb", flex: 1, minHeight: 0 }}>
              {previewManual.desc && (
                <div style={{ fontSize: 13, color: "#374151", whiteSpace: "pre-wrap", borderRadius: 12, background: "#ffffff", padding: 10, border: "1px solid #e5e7eb" }}>{previewManual.desc}</div>
              )}
              {(() => {
                const embedSrc = getEmbedSrc(previewManual.embedUrl);
                if (!embedSrc) return <div style={{ fontSize: 13, color: "#6b7280", padding: 12, borderRadius: 10, background: "#e5e7eb" }}>プレビューURLがありません。</div>;
                return (
                  <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
                    <div style={{ width: "100%", maxWidth: 960, aspectRatio: "16 / 9", borderRadius: 14, overflow: "hidden", border: "1px solid #d1d5db", background: "#020617", position: "relative" }}>
                      <iframe src={embedSrc} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} allowFullScreen loading="lazy" />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      
      {isAdminErrorModalOpen && (
        <div
          className="kb-modal-backdrop"
          onClick={() => setIsAdminErrorModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.65)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            zIndex: 10001,
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            className="kb-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 400,
              padding: "32px 24px",
              background: "#fff",
              borderRadius: 24,
              textAlign: "center",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🚫</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#1e293b", marginBottom: "12px" }}>
              アクセス権限がありません
            </div>
            <p style={{ fontSize: "14px", color: "#64748b", lineHeight: "1.6", marginBottom: "24px" }}>
              管理画面へのアクセスには「管理者権限」が必要です。<br />
              権限が必要な場合は管理者へ連絡してください。
            </p>
            <button
              className="kb-primary-btn"
              style={{ 
                width: "100%", padding: "12px", borderRadius: "12px", 
                background: "#0f172a", color: "#fff", border: "none", cursor: "pointer" 
              }}
              onClick={() => setIsAdminErrorModalOpen(false)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}