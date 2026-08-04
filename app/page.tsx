// app/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ManualList from "@/components/ManualList";
import SeriesScroll from "@/components/SeriesScroll";
import RefundTasksPanel from "@/components/RefundTasksPanel";
import ContactList from "@/components/ContactList";
import Tour, { type TourStep } from "@/components/Tour";
import HelpModal from "@/components/HelpModal";

/** Know Base 使い方ガイドの Slides URL (Google Slides の /preview リンク) */
const HELP_SLIDES_URL =
  "https://docs.google.com/presentation/d/16EIKzRBEwdLBG1HZbKKkW0OH59SNZEL-mZJ0EeToUgI/preview";

/** ガイドツアーのステップ */
const TOUR_STEPS: TourStep[] = [
  {
    selector: "search-bar",
    title: "🔍 全文検索",
    description:
      "マニュアル・担当者・タグなどを横断検索できます。ヒットした箇所は黄色マーカーでハイライト表示されます。",
  },
  {
    selector: "filter-panel",
    title: "🏷 ブランド・部署で絞り込み",
    description:
      "ブランドや部署のチップをクリックすると、関連するマニュアルだけに絞り込めます。検索ボックスと組み合わせて使えます。",
  },
  {
    selector: "knowbie",
    title: "🤖 Knowbie (AI)",
    description:
      "業務マニュアルや手順について自然文で質問できます。回答の下には参照元のマニュアルが表示されます。",
  },
  {
    selector: "manual-list",
    title: "📚 マニュアル一覧",
    description:
      "登録されているマニュアル一覧です。📚マークの行はシリーズで、クリックすると関連マニュアルが順番に並びます。「公開日 / 更新日」で並び替え可能。",
  },
  {
    selector: "contact-list",
    title: "👥 担当者リスト",
    description:
      "問い合わせ先の担当者一覧。担当業務・部署で索引でき、Gmail アイコンから直接メール起票できます。",
  },
];

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
  viewScope?: "all" | "direct";
  categoryId?: string | null;
  seriesOrder?: number | null;
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
  mailingList?: string | string[];
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
  url?: string;
};

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
};

type SourceAttribution = {
  title?: string;
  url?: string;
  snippet?: string;
  citationNumber?: number;
  updatedAt?: string;
  documentId?: string;

  [key: string]: unknown;
};

type ExternalLink = {
  linkId: string;
  title: string;
  url: string;
  description?: string;
  sortOrder?: number;
  isActive: boolean;
};

/* ========= 定数 ========= */

const ALL_BRAND_ID = "__ALL_BRAND__";
const ALL_DEPT_ID = "__ALL_DEPT__";
const ALL_CATEGORY_ID = "__ALL_CATEGORY__";

type ManualCategory = {
  categoryId: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  description?: string | null;
  bizId?: string | null;
  biz?: string | null;
  publishedAt?: string | null;
  thumbnailUrl?: string | null;
};

function buildGroupIdsHeader(groupId?: string) {
  const HQ = "g003";
  const FRANCHISE = "g002";
  if (!groupId) return "";

  if (groupId === HQ) return HQ;
  if (groupId === FRANCHISE) return FRANCHISE;

  const raw = [groupId, HQ].filter(Boolean) as string[];
  return Array.from(new Set(raw)).join(",");
}

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
  } catch {
    return dateStr;
  }
}

type ManualViewScope = "all" | "direct" | "fc";

const normalizeManualViewScope = (v: unknown): ManualViewScope => {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "direct") return "direct";
  if (s === "fc") return "fc";
  return "all"; 
};

/* ========= キーワード分解（単語検索用） ========= */
function tokenizeJP(input: string) {
  const raw = (input || "").toLowerCase().trim();
  if (!raw) return [];

  const cleaned = raw.replace(
    /[、。,.!！?？:：;；()（）[\]【】{}「」『』<>・/\\|"'`~^＝=＋+＿_〜\-\n\r\t]/g,
    " "
  );

  const latin = cleaned.match(/[a-z0-9]+/g) ?? [];
  const jpChunks = cleaned.match(/[一-龯々〆ヵヶぁ-んァ-ヴー]{2,}/g) ?? [];

  const particleSplitter = /(の|を|は|が|に|へ|と|で|や|から|まで|です|ます|する|したい|教えて|について)/g;
  const suffixSplitter = /(方法|やり方|手順|手続き|流れ|とは|って|できない|したい)/g;

  const jpTokens = jpChunks
    .flatMap((chunk) =>
      chunk
        .replace(particleSplitter, " ")
        .replace(suffixSplitter, " ")
        .split(/\s+/)
        .filter(Boolean)
    )
    .filter((t) => t.length >= 2);

  const stopWords = new Set([
    "の", "を", "は", "が", "に", "へ", "と", "で", "や", "から", "まで", "です", "ます", "する", "したい", "教えて", "方法", "やり方", "手順", "について", "流れ",
  ]);

  const tokens = [...latin, ...jpTokens]
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !stopWords.has(t));

  if (tokens.length >= 2) tokens.push(tokens.join(""));

  return Array.from(new Set(tokens));
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
  return /^[-*•・]\s+/.test(t) || /^\d+[\.\)]\s+/.test(t) || /^\(\d+\)\s+/.test(t);
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
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="kb-news-link">
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


function extractSseEventName(eventBlock: string): string | null {
  const m = eventBlock.match(/^event:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractSseData(eventBlock: string): string {
  const lines = eventBlock
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""));
  return lines.join("\n");
}

/* ===== /SSE helpers ===== */

/* ===== 軽量 Markdown レンダラ (Claude 回答用・依存なし) ===== */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdInline(s: string): string {
  // インライン: コード → 太字 → 斜体 → リンク
  return s
    .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function renderMarkdown(src: string): string {
  const text = escapeHtml(src || "");
  const lines = text.split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  for (const raw of lines) {
    const line = raw;
    if (/^```/.test(line.trim())) {
      if (!inCode) { closeList(); out.push("<pre><code>"); inCode = true; }
      else { out.push("</code></pre>"); inCode = false; }
      continue;
    }
    if (inCode) { out.push(line + "\n"); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const lv = Math.min(h[1].length + 2, 6); out.push(`<h${lv}>${mdInline(h[2])}</h${lv}>`); continue; }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*・]\s+(.*)$/);
    if (ol) { if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; } out.push(`<li>${mdInline(ol[1])}</li>`); continue; }
    if (ul) { if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; } out.push(`<li>${mdInline(ul[1])}</li>`); continue; }
    if (line.trim() === "") { closeList(); continue; }
    closeList();
    out.push(`<p>${mdInline(line)}</p>`);
  }
  if (inCode) out.push("</code></pre>");
  closeList();
  return out.join("");
}
function MarkdownMessage({ text }: { text: string }) {
  return <div className="kb-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

function SourcesPanel({ sources }: { sources: SourceAttribution[] }) {
  if (!sources || sources.length === 0) return null;

  const normalizeUrlLabel = (s: SourceAttribution) => {
    const raw = (s.url || s.documentId || "").trim();
    if (!raw) return "";
    return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  };

  return (
    <div
      className="kb-sources"
      style={{
        borderRadius: 14,
        border: "1px solid rgba(148,163,184,0.22)",
        background: "rgba(2,6,23,0.35)",
        backdropFilter: "blur(10px)",
        padding: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#e2e8f0", letterSpacing: "0.02em" }}>参照元</div>
        <div style={{ fontSize: 11, color: "rgba(226,232,240,0.65)" }}>{sources.length} 件</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sources.map((s, i) => {
          const href = (s.url || s.documentId || "").trim() || "#";
          const domain = normalizeUrlLabel(s);
          const num = s.citationNumber ?? i + 1;

          return (
            <a
              key={`${num}-${i}-${domain}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                textDecoration: "none",
                borderRadius: 14,
                border: "1px solid rgba(148,163,184,0.18)",
                background: "linear-gradient(180deg, rgba(15,23,42,0.65) 0%, rgba(2,6,23,0.45) 100%)",
                boxShadow: "0 8px 18px rgba(0,0,0,0.25)",
                padding: 12,
                transition: "transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.borderColor = "rgba(147,197,253,0.35)";
                e.currentTarget.style.boxShadow = "0 12px 26px rgba(0,0,0,0.32)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.borderColor = "rgba(148,163,184,0.18)";
                e.currentTarget.style.boxShadow = "0 8px 18px rgba(0,0,0,0.25)";
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div
                  style={{
                    minWidth: 28, height: 28, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800, color: "#0b1220", background: "linear-gradient(180deg, #93c5fd 0%, #60a5fa 100%)",
                    boxShadow: "0 6px 14px rgba(59,130,246,0.25)", flexShrink: 0,
                  }}
                >
                  {num}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.35, marginBottom: 4,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                    title={s.title || "参照元"}
                  >
                    {s.title || "参照元"}
                  </div>
                  {String(s.snippet || "").trim() && (
                    <div
                      style={{
                        fontSize: 12, color: "rgba(226,232,240,0.75)", lineHeight: 1.55, display: "-webkit-box",
                        WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"], overflow: "hidden", marginBottom: 8,
                      }}
                    >
                      {s.snippet}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 11, color: "rgba(148,163,184,0.9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" }} title={domain}>
                      {domain || "source"}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(147,197,253,0.95)", fontWeight: 700 }}>開く ↗</div>
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ========= ページ ========= */

export default function HomePage() {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => setNowMs(Date.now()), []);

  /* ========= ユーザー情報 ========= */
  // ✅ userId を追加
  type Me = { userId?: string; name?: string; email?: string; role?: string; groupId?: string; mustChangePassword?: boolean; canViewAccounting?: boolean };

  const [me, setMe] = useState<Me | null>(null);
  const isAdmin = useMemo(() => me?.role === "admin", [me]);
  const isSv = useMemo(() => me?.role === "sv", [me]); // 加盟店SV: 店舗設定(FC)へアクセス可
  const [isAdminErrorModalOpen, setIsAdminErrorModalOpen] = useState(false);
  // 直営店舗のブランド (JOYFIT/FIT365)。直営店舗の担当者のみ 管理画面ボタンを出す。
  const [directBrands, setDirectBrands] = useState<string[]>([]);

  // ✅ authチェック
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok || !data?.user) {
          router.replace("/login");
          return;
        }

        const isOnPasswordPage = window.location.pathname === "/account/password";
        if (data.user.mustChangePassword === true && !isOnPasswordPage) {
          const returnTo = window.location.pathname + window.location.search;
          router.replace(`/account/password?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }

        setMe(data.user);
        // 直営店舗のブランドを判定 (管理画面ボタンの出し分け用)
        fetch("/api/store-settings/stores", { cache: "no-store" })
          .then((r) => r.json())
          .then((d) => {
            if (cancelled || !d?.ok) return;
            const brands = [...new Set((d.stores || [])
              .filter((s: any) => s.ownership === "直営")
              .map((s: any) => s.brandGroup)
              .filter(Boolean))] as string[];
            setDirectBrands(brands);
          })
          .catch(() => {});
      } catch {
        router.replace("/login");
      }
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [router]);

  // ✅ 管理画面ボタン
  const handleAdminClick = () => {
    if (isAdmin) window.location.href = "/admin";
    else setIsAdminErrorModalOpen(true);
  };

  /* ========= ログ送信関数 ========= */

  // 🔍 検索ログを送信する関数
  const recordSearchLog = (word: string) => {
    const w = word.trim();
    if (!w || !me?.userId) return;
    fetch("/api/search/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: w, userId: me.userId }),
    }).catch((e) => console.error("Failed to record search log", e));
  };

  // 📢 お知らせ閲覧ログを送信する関数
  const recordNewsViewLog = (newsId: string) => {
    if (!me?.userId) return;
    fetch("/api/news/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newsId, userId: me.userId }),
    }).catch((e) => console.error("Failed to record news log", e));
  };
  // 📘 マニュアル閲覧ログを送信する関数 (追加)
  const recordManualViewLog = (manualId: string) => {
    if (!me?.userId) return;
    fetch("/api/manuals/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualId, userId: me.userId }),
    }).catch((e) => console.error("Failed to record manual view log", e));
  };

  /* ========= ユーザー名メニュー（名前クリック） ========= */
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  /* ========= Knowbie（Amazon Q） ========= */

  const [prompt, setPrompt] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sources, setSources] = useState<SourceAttribution[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [launching, setLaunching] = useState(false); // 送信時のノウビー打ち上げ演出
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const manualListRef = useRef<HTMLDivElement | null>(null);

  const [keyword, setKeyword] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState<string>(ALL_BRAND_ID);
  const [selectedDeptId, setSelectedDeptId] = useState<string>(ALL_DEPT_ID);
  const [contactSearch, setContactSearch] = useState("");
  const SLOW_TIP = "検索に時間がかかっています…（10〜20秒ほどかかる場合があります）";
  const INITIAL_TEXT = "送信しました。検索しています…";
  const STAGE_LABELS: Record<string, string> = {
    retrieving: "🔍 マニュアルを検索中…",
    generating: "✍ 回答を生成中…",
    retrying: "⟳ 再試行中…",
  };
  const stageActiveRef = useRef(false);

  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const aiBufRef = useRef("");            // 受信済みの全文(ターゲット)
  const shownLenRef = useRef(0);          // 表示済み文字数
  const streamDoneRef = useRef(false);    // ストリーム受信完了フラグ
  const flushTimerRef = useRef<number | null>(null); // タイプライタのタイマー

  function mergeSources(prev: SourceAttribution[], incoming: SourceAttribution[]) {
    const next = [...prev, ...incoming];
    const seen = new Set<string>();
    return next.filter((s) => {
      const key = String(s.url || s.documentId || s.title || JSON.stringify(s));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  useEffect(() => {
    const behavior = loadingAI ? "auto" : "smooth";
    chatEndRef.current?.scrollIntoView({ behavior, block: "end" });
  }, [messages, sources, showSources, loadingAI]);

  // タイプライタ: 受信済み全文(aiBufRef)を一定速度で1文字ずつ表示する
  const typeTick = (assistantId: number) => {
    const target = aiBufRef.current;
    const shown = shownLenRef.current;
    if (shown < target.length) {
      // 遅れているほど少し速く追いつく (自然なタイピング感)
      const behind = target.length - shown;
      const step = behind > 240 ? Math.ceil(behind / 40) : behind > 60 ? 3 : 1;
      const next = Math.min(target.length, shown + step);
      shownLenRef.current = next;
      const text = target.slice(0, next);
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: text, loading: true } : m)));
      flushTimerRef.current = window.setTimeout(() => typeTick(assistantId), 18);
    } else if (!streamDoneRef.current) {
      // 追いついた。次の受信を待つ
      flushTimerRef.current = window.setTimeout(() => typeTick(assistantId), 30);
    } else {
      // 完了
      flushTimerRef.current = null;
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: aiBufRef.current, loading: false } : m)));
    }
  };

  const appendToAssistant = (assistantId: number, chunk: string) => {
    if (!chunk) return;
    aiBufRef.current += chunk;
    if (flushTimerRef.current == null) {
      flushTimerRef.current = window.setTimeout(() => typeTick(assistantId), 18);
    }
  };

  const setAssistantDone = (assistantId: number) => {
    streamDoneRef.current = true;
    // タイプライタが動いていなければ即確定
    if (flushTimerRef.current == null) {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: aiBufRef.current, loading: false } : m)));
    }
  };

  function handleCancelAsk() {
    if (!loadingAI) return;
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.role === "assistant" && m.loading);
      if (idx === -1) return prev;
      const realIndex = prev.length - 1 - idx;
      const target = prev[realIndex];
      const next = [...prev];
      next[realIndex] = {
        ...target,
        loading: false,
        content: (target.content ?? "") + "\n\n（キャンセルしました）",
      };
      return next;
    });
    setLoadingAI(false);
  }

  // 会話をリセット (履歴は残さない方針。サーバ側の監査ログのみ保持)
  function handleResetChat() {
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;
    if (flushTimerRef.current != null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    aiBufRef.current = ""; shownLenRef.current = 0; streamDoneRef.current = false;
    setMessages([]);
    setSources([]);
    setShowSources(false);
    setConversationId(undefined);
    setLoadingAI(false);
  }

  // 出典クリック: マニュアル本体を埋め込みモーダルで開く
  function openSourceManual(s: SourceAttribution) {
    const embedUrl = String(s.url || "").trim();
    const mid = String((s as any).manualId || "");
    const full = manuals.find((m) => m.manualId === mid);
    const manualObj: any = full || { manualId: mid, title: String(s.title || "マニュアル"), embedUrl };
    if (!manualObj.embedUrl && embedUrl) manualObj.embedUrl = embedUrl;
    if (!manualObj.embedUrl) {
      if (embedUrl) window.open(embedUrl.startsWith("http") ? embedUrl : `https://${embedUrl}`, "_blank");
      return;
    }
    setShowSources(false);
    setPreviewManual(manualObj);
  }

  async function handleAsk(override?: string) {
    const base = (typeof override === "string" ? override : prompt).trim();
    if (!base || loadingAI) return;

    const userPrompt = base;
    setKeyword(userPrompt);
    recordSearchLog(userPrompt); // ✅ チャット入力時に検索ログ送信

    // 初回送信は「ノウビーが地球から飛び出す」打ち上げ演出を挟む
    if (messages.length === 0) {
      setLaunching(true);
      window.setTimeout(() => setLaunching(false), 1300);
    }
    
    setPrompt("");
    setSources([]);
    setShowSources(false);

    const now = Date.now();
    const newUserMessage: Message = { id: now, role: "user", content: userPrompt };
    const assistantId = now + 1;

    const newAssistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      loading: true,
    };

    setMessages((prev) => [...prev, newUserMessage, newAssistantMessage]);
    setLoadingAI(true);

    aiBufRef.current = "";
    shownLenRef.current = 0;
    streamDoneRef.current = false;
    stageActiveRef.current = false;
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const ac = new AbortController();
    abortRef.current = ac;

    // スロー案内は表示しない (ローディングは Knowbie アニメーションで表現)
    const slowTimer = window.setTimeout(() => {}, 0);

    try {
      const res = await fetch("/api/kb-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          prompt: userPrompt,
          conversationId,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        try {
          const j = JSON.parse(text);
          throw new Error(j.error || j.message || `Server error: ${res.status}`);
        } catch {
          throw new Error(text || `Server error: ${res.status}`);
        }
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        window.clearTimeout(slowTimer);

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: "", loading: true } : m))
        );

        const handleSseBlock = (block: string) => {
          const eventName = extractSseEventName(block);
          const data = extractSseData(block);

          if (eventName === "ping") return { stop: false };

          if (eventName === "conversation") {
            try {
              const j = JSON.parse(data || "{}");
              const cid = j?.conversationId;
              if (cid && typeof cid === "string") setConversationId(cid);
            } catch {}
            return { stop: false };
          }

          if (eventName === "sources") {
            try {
              const parsed = JSON.parse(data || "[]");
              if (Array.isArray(parsed)) {
                setSources((prev) => mergeSources(prev, parsed));
              }
            } catch (e) {
              console.warn("Failed to parse sources:", e, data);
            }
            return { stop: false };
          }

          if (eventName === "stage") {
            try {
              const j = JSON.parse(data || "{}");
              const stage = String(j.stage || "");
              let label = STAGE_LABELS[stage] ?? "";
              if (stage === "retrying" && j.attempt && j.max) {
                label = `⟳ 再試行中… (${j.attempt}/${j.max})`;
              }
              if (label) {
                stageActiveRef.current = true;
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantId || !m.loading) return m;
                    return { ...m, content: label };
                  })
                );
              }
            } catch {}
            return { stop: false };
          }

          if (eventName === "done" || data === "[DONE]") {
            setAssistantDone(assistantId);
            return { stop: true };
          }

          if (eventName === "error") {
            try {
              const j = JSON.parse(data || "{}");
              throw new Error(j.error || j.message || JSON.stringify(j));
            } catch {
              throw new Error(data || "unknown stream error");
            }
          }

          if (data) {
            // 実テキスト到着時にステージラベルを消す (1 回だけ)
            if (stageActiveRef.current) {
              stageActiveRef.current = false;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: "" } : m))
              );
            }
            appendToAssistant(assistantId, data);
          }
          return { stop: false };
        };

        if (!res.body) {
          const all = await res.text().catch(() => "");
          const blocks = all.split("\n\n");
          for (const b of blocks) {
            const r = handleSseBlock(b);
            if (r?.stop) break;
          }
          setAssistantDone(assistantId);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const r = handleSseBlock(part);
            if (r?.stop) {
              try { reader.cancel(); } catch {}
              return;
            }
          }
        }

        if (buffer.trim()) {
          const parts = buffer.split("\n\n");
          for (const part of parts) {
            const r = handleSseBlock(part);
            if (r?.stop) break;
          }
        }

        setAssistantDone(assistantId);
        return;
      }

      const text = await res.text().catch(() => "");
      let answer = text;

      try {
        const j = JSON.parse(text);
        if (j?.ok === false) throw new Error(j.error || j.message || "Unknown error");
        if (j?.error) throw new Error(j.error);
        answer = String(j.text ?? j.answer ?? "");
        const incoming = Array.isArray(j.sources) ? j.sources : [];
        setSources(incoming);
        setShowSources(incoming.length > 0);
      } catch {
        setSources([]);
        setShowSources(false);
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: answer, loading: false } : m))
      );
    } catch (err: unknown) {
      const aborted =
        err instanceof DOMException
          ? err.name === "AbortError"
          : err instanceof Error && (err as any).name === "AbortError";

      if (aborted) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: (m.content ?? "") + "\n\n（キャンセルしました）", loading: false }
              : m
          )
        );
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: `エラーが発生しました：${msg}`, loading: false } : m
        )
      );
      setSources([]);
      setShowSources(false);
    } finally {
      window.clearTimeout(slowTimer);
      abortRef.current = null;
      setLoadingAI(false);
    }
  }

  /* ========= データ ========= */

  const [manuals, setManuals] = useState<Manual[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [categories, setCategories] = useState<ManualCategory[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newsList, setNewsList] = useState<News[]>([]);
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>([]);

  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadingManuals, setLoadingManuals] = useState(true);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);

  const [previewManual, setPreviewManual] = useState<Manual | null>(null);
  const [chapters, setChapters] = useState<{ t: number; title: string }[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [seekSec, setSeekSec] = useState<number | null>(null); // 章クリックの頭出し秒(YouTube)
  const [toc, setToc] = useState<{ title: string }[]>([]);       // ドキュメントの目次
  const [tocLoading, setTocLoading] = useState(false);
  useEffect(() => {
    if (previewManual && previewManual.manualId) {
      recordManualViewLog(previewManual.manualId);
      setChapters([]); setSeekSec(null); setToc([]);
      // 動画は章立て(チャプター)、ドキュメントは目次(TOC)を取得
      if ((previewManual as any).type === "video") {
        fetch(`/api/manuals/${encodeURIComponent(previewManual.manualId)}/chapters`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d?.ok && Array.isArray(d.chapters)) setChapters(d.chapters); })
          .catch(() => {});
      } else {
        fetch(`/api/manuals/${encodeURIComponent(previewManual.manualId)}/toc`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d?.ok && Array.isArray(d.toc)) setToc(d.toc); })
          .catch(() => {});
      }
    }
  }, [previewManual]);

  const fmtChapTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return (h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
  };
  const isYouTubeUrl = (u?: string) => !!u && /(?:youtube\.com|youtu\.be)/.test(u);
  const generateChapters = async () => {
    if (!previewManual) return;
    setChaptersLoading(true);
    try {
      const res = await fetch(`/api/manuals/${encodeURIComponent(previewManual.manualId)}/chapters`, { method: "POST" });
      const d = await res.json();
      if (d.ok && Array.isArray(d.chapters)) setChapters(d.chapters);
      else alert(d.error || "章の生成に失敗しました");
    } catch { alert("章の生成に失敗しました"); }
    finally { setChaptersLoading(false); }
  };
  const generateToc = async () => {
    if (!previewManual) return;
    setTocLoading(true);
    try {
      const res = await fetch(`/api/manuals/${encodeURIComponent(previewManual.manualId)}/toc`, { method: "POST" });
      const d = await res.json();
      if (d.ok && Array.isArray(d.toc)) setToc(d.toc);
      else alert(d.error || "目次の生成に失敗しました");
    } catch { alert("目次の生成に失敗しました"); }
    finally { setTocLoading(false); }
  };

  const PAGE_SIZE = 5;
  type ManualSortKey = "publish" | "update";
  type SortOrder = "asc" | "desc";

  const [manualSortKey, setManualSortKey] = useState<ManualSortKey>("publish");
  const [manualSortOrder, setManualSortOrder] = useState<SortOrder>("desc");
  const [manualPage, setManualPage] = useState(1);

  const NEWS_PAGE_SIZE = 3;
  const [newsPage, setNewsPage] = useState(1);
  const [expandedNews, setExpandedNews] = useState<Record<string, boolean>>({});
  const [expandedOrder, setExpandedOrder] = useState<string[]>([]);

  const toggleNews = (newsIdRaw: string) => {
    const newsId = String(newsIdRaw);

    setExpandedNews((prev) => {
      const isOpen = !!prev[newsId];
      // ✅ 閉じた状態から開く時に閲覧ログを送信
      if (!isOpen) {
        recordNewsViewLog(newsId);
      }
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
    if (!me) return;
    let cancelled = false;

    const fetchData = async () => {
      try {
        const groupIds = me?.groupId ? buildGroupIdsHeader(me.groupId) : "";
        const groupHeaders: HeadersInit = groupIds ? { "x-kb-group-ids": groupIds } : {};

        const [manualsRes, brandsRes, deptsRes, contactsRes, newsRes, linksRes, categoriesRes] = await Promise.all([
          fetch("/api/manuals?onlyActive=1", { headers: groupHeaders, cache: "no-store" }).then((res) => res.json()),
          fetch("/api/brands", { cache: "no-store" }).then((res) => res.json()),
          fetch("/api/depts", { cache: "no-store" }).then((res) => res.json()),
          fetch("/api/contacts", { cache: "no-store" }).then((res) => res.json()),
          fetch("/api/news?onlyActive=1", { headers: groupHeaders, cache: "no-store" }).then((res) => res.json()),
          fetch("/api/external-links", { cache: "no-store" }).then((res) => res.json()),
          fetch("/api/manual-categories", { cache: "no-store" }).then((res) => res.json()).catch(() => ({ categories: [] })),
        ]);

        if (cancelled) return;

        const brandsList: Brand[] = (brandsRes.brands || []).sort(
          (a: Brand, b: Brand) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999)
        );
        const deptsList: Dept[] = (deptsRes.depts || []).sort(
          (a: Dept, b: Dept) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999)
        );

        type ManualsApiResponse = { manuals?: Manual[] };
        const manualsJson = manualsRes as ManualsApiResponse;
        setManuals(
          (manualsJson.manuals ?? []).map((m) => ({
            ...m,
            viewScope: normalizeManualViewScope(m.viewScope),
          }))
        );
        setBrands(brandsList);
        setDepts(deptsList);
        setContacts(contactsRes.contacts || []);
        setNewsList(newsRes.news || []);
        setExternalLinks(linksRes.links || []);
        setCategories(categoriesRes.categories || []);
      } catch (e) {
        console.error("Failed to fetch initial data:", e);
      } finally {
        if (cancelled) return;
        setIsInitialLoading(false);
        setLoadingManuals(false);
        setLoadingBrands(false);
        setLoadingDepts(false);
        setLoadingContacts(false);
        setLoadingNews(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [me]);

  const brandMap = useMemo(
    () => brands.reduce<Record<string, Brand>>((map, b) => { map[b.brandId] = b; return map; }, {}),
    [brands]
  );

  const deptMap = useMemo(
    () => depts.reduce<Record<string, Dept>>((map, d) => { map[d.deptId] = d; return map; }, {}),
    [depts]
  );

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

  // シリーズ (1階層フラット) の名前ルックアップ
  const seriesNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.categoryId] = c.name;
    return m;
  }, [categories]);

  // シリーズ詳細ルックアップ (説明・部署・配信日・サムネイル等)
  const seriesDetailMap = useMemo(() => {
    const m: Record<string, ManualCategory> = {};
    for (const c of categories) m[c.categoryId] = c;
    return m;
  }, [categories]);

  // 検索ハイライト用: 生キーワード + tokenize 後トークン
  const searchHighlightTokens = useMemo<string[]>(() => {
    const raw = keyword.trim();
    const toks = tokenizeJP(keyword);
    const all = raw ? [raw, ...toks] : toks;
    return Array.from(new Set(all));
  }, [keyword]);

  const filteredManuals = useMemo(() => {
    const tokens = tokenizeJP(keyword);
    const hasTokens = tokens.length > 0;
    const isFranchise = me?.groupId === "g002"; // FC

    return manuals.filter((m) => {
      const scope = normalizeManualViewScope(m.viewScope);
      if (isFranchise && scope === "direct") return false;
      if (selectedBrandId !== ALL_BRAND_ID && (m.brandId ?? "") !== selectedBrandId) return false;
      if (selectedDeptId !== ALL_DEPT_ID && (m.bizId ?? "") !== selectedDeptId) return false;
      if (!hasTokens) return true;

      const haystack = [m.title ?? "", m.desc ?? "", ...(m.tags ?? []), m.brand ?? "", m.biz ?? ""]
        .join(" ")
        .toLowerCase();
      return tokens.some((t) => haystack.includes(t));
    });
  }, [manuals, keyword, selectedBrandId, selectedDeptId, me]);

  function parseTimeMs(s?: string | null) {
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : null;
  }

  const FAR_FUTURE = 4102444800000; // 2100-01-01

  /** マニュアル単体の sortKey 計算 */
  const manualSortKeyOf = useCallback((m: Manual): number => {
    return manualSortKey === "publish"
      ? (parseTimeMs(m.startDate) ?? FAR_FUTURE)
      : (parseTimeMs(m.updatedAt) ?? FAR_FUTURE);
  }, [manualSortKey]);

  type MixedItem =
    | { kind: "manual"; manual: Manual; sortKey: number }
    | { kind: "series"; categoryId: string; name: string; manuals: Manual[]; sortKey: number };

  /** シリーズと単独マニュアルを混在させた一覧アイテム */
  const mixedItems = useMemo<MixedItem[]>(() => {
    // シリーズ毎にマニュアルを束ねる (categoryId が存在するシリーズに紐付くもの)
    const seriesGroups: Record<string, Manual[]> = {};
    const standalone: Manual[] = [];
    for (const m of filteredManuals) {
      const cid = m.categoryId || "";
      if (cid && seriesNameMap[cid]) {
        (seriesGroups[cid] ||= []).push(m);
      } else {
        standalone.push(m);
      }
    }

    const out: MixedItem[] = [];
    for (const m of standalone) {
      out.push({ kind: "manual", manual: m, sortKey: manualSortKeyOf(m) });
    }
    for (const [cid, items] of Object.entries(seriesGroups)) {
      // シリーズ内は seriesOrder 昇順
      items.sort((a, b) => (a.seriesOrder ?? 9999) - (b.seriesOrder ?? 9999));
      // シリーズ自体の sortKey は最も新しい (max) を採用
      const keys = items.map(manualSortKeyOf);
      const maxKey = keys.length > 0 ? Math.max(...keys) : FAR_FUTURE;
      out.push({
        kind: "series",
        categoryId: cid,
        name: seriesNameMap[cid],
        manuals: items,
        sortKey: maxKey,
      });
    }

    // 全体ソート
    out.sort((a, b) => {
      const diff = a.sortKey - b.sortKey;
      return manualSortOrder === "desc" ? -diff : diff;
    });
    return out;
  }, [filteredManuals, seriesNameMap, manualSortKeyOf, manualSortOrder]);

  const totalManualPages = Math.max(1, Math.ceil(mixedItems.length / PAGE_SIZE));
  const pagedMixedItems = useMemo(() => {
    const start = (manualPage - 1) * PAGE_SIZE;
    return mixedItems.slice(start, start + PAGE_SIZE);
  }, [mixedItems, manualPage]);

  // シリーズ数 + 単独マニュアル数の合計
  const totalManualCount = filteredManuals.length;

  const recentTags = useMemo(() => {
    const counts: Record<string, number> = {};
    manuals.forEach((m) => (m.tags || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
  }, [manuals]);

  const filteredContacts = useMemo(() => {
    const kw = (contactSearch || keyword).trim().toLowerCase();
    return contacts
      .map((c) => {
        if (selectedBrandId !== ALL_BRAND_ID && selectedBrandId && !(c.brandId === "ALL" || c.brandId === selectedBrandId)) return null;
        if (selectedDeptId !== ALL_DEPT_ID && selectedDeptId && c.deptId !== selectedDeptId) return null;
        if (!kw) return { ...c };

        const deptLabel = deptMap[c.deptId]?.name ?? "";
        const haystack = [c.name, c.email, c.role ?? "", deptLabel].join(" ").toLowerCase();
        if (!haystack.includes(kw)) return null;
        return { ...c };
      })
      .filter((v): v is Contact => v !== null);
  }, [contacts, selectedBrandId, selectedDeptId, contactSearch, keyword, deptMap]);

  const currentDeptTitleLabel = selectedDeptId === ALL_DEPT_ID ? "" : `（${deptMap[selectedDeptId]?.name}）`;

  const filteredNews = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return newsList
      .filter((n) => {
        if (n.isHidden) return false;
        if (selectedBrandId !== ALL_BRAND_ID && n.brandId !== "ALL" && (n.brandId ?? "") !== selectedBrandId) return false;
        if (selectedDeptId !== ALL_DEPT_ID && n.deptId !== "ALL" && (n.deptId ?? "") !== selectedDeptId) return false;
        if (kw) {
          const haystack = [n.title, n.body ?? "", ...(n.tags ?? [])].join(" ").toLowerCase();
          if (!haystack.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ad = a.updatedAt || a.fromDate || "";
        const bd = b.updatedAt || b.fromDate || "";
        return (bd || "").localeCompare(ad || "");
      });
  }, [newsList, selectedBrandId, selectedDeptId, keyword]);

  useEffect(() => setNewsPage(1), [selectedBrandId, selectedDeptId]);

  // 検索キーワード / ブランド / 部署 が変わったらマニュアル一覧のページを1に戻す
  useEffect(() => setManualPage(1), [keyword, selectedBrandId, selectedDeptId]);

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

  const handleInquirySubmit = (emails: string | string[] | undefined, deptName?: string) => {
    if (!emails || (Array.isArray(emails) && emails.length === 0)) {
      alert("問い合わせ先メールアドレスが設定されていません。管理画面の「部署・メーリングリスト管理」で設定を確認してください。");
      return;
    }
    const to = Array.isArray(emails) ? emails.join(",") : emails;
    const subject = encodeURIComponent(`【KnowBase問い合わせ】${deptName || ""} 宛`);
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${subject}`;
    window.open(gmailUrl, "_blank", "noopener,noreferrer");
    setIsInquiryModalOpen(false);
  };

  /* ========= UI ========= */

  if (isInitialLoading) {
    return (
      <div className="kb-loading-root">
        <div className="kb-loading-container">
          <img src="/logos/KnowBase_icon.png" alt="Logo" className="kb-loading-logo" />
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
      <div className="kb-topbar">
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: "none" }}>
          <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px", cursor: "pointer" }}>
            <img src="/logos/KnowBase_site_Banner.png" alt="KnowBase - マニュアル検索ポータルサイト" style={{ height: "52px", objectFit: "contain" }} />
          </div>
        </Link>

        <div className="kb-topbar-center">
          <input
            className="kb-search-input"
            data-tour="search-bar"
            placeholder="キーワードで探す（例：Canva テロップ）"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                recordSearchLog(keyword); // ✅ 検索バーでEnter押下時にログ送信
                manualListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
          />
        </div>

        <div className="kb-topbar-right">
          <button
            type="button"
            className="kb-help-trigger"
            onClick={() => setHelpOpen(true)}
            title="使い方ガイドを開く"
          >
            <span aria-hidden>📖</span>
            <span className="kb-help-trigger-label">使い方</span>
          </button>
          <button
            type="button"
            className="kb-help-trigger"
            onClick={() => setTourOpen(true)}
            title="ガイドツアーを再生"
          >
            <span aria-hidden>❓</span>
            <span className="kb-help-trigger-label">ツアー</span>
          </button>
          <div ref={userMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              className={"kb-userpill" + (userMenuOpen ? " open" : "")}
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <span className="kb-userpill-avatar" aria-hidden>{(me?.name ?? "G").charAt(0)}</span>
              <span className="kb-userpill-text">
                <span className="kb-userpill-name">{me?.name ? me.name : "ゲスト"}</span>
                <span className="kb-userpill-suffix">様</span>
              </span>
              <span className="kb-userpill-chevron" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>

            {userMenuOpen && (
              <div role="menu" className="kb-userdropdown">
                <div className="kb-userdropdown-head">
                  <div className="kb-userdropdown-head-left">
                    <div className="kb-userdropdown-avatar" aria-hidden>{(me?.name ?? "G").charAt(0)}</div>
                    <div className="kb-userdropdown-info">
                      <div className="kb-userdropdown-name">{me?.name ? `${me.name} 様` : "ゲスト"}</div>
                      {!!me?.email && <div className="kb-userdropdown-email">{me.email}</div>}
                    </div>
                  </div>
                </div>
                <div className="kb-userdropdown-list">
                  <button type="button" role="menuitem" className="kb-userdropdown-item" onClick={() => { setUserMenuOpen(false); router.push("/account/name"); }}>
                    <span className="kb-userdropdown-ico" aria-hidden>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <span className="kb-userdropdown-label">名前の変更</span>
                  </button>
                  <button type="button" role="menuitem" className="kb-userdropdown-item" onClick={() => { setUserMenuOpen(false); router.push("/account/password"); }}>
                    <span className="kb-userdropdown-ico" aria-hidden>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M6 11h12v10H6V11z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M12 15v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </span>
                    <span className="kb-userdropdown-label">パスワードを変更</span>
                  </button>
                  <div className="kb-userdropdown-sep" />
                  <button type="button" role="menuitem" className="kb-userdropdown-item danger" onClick={() => { setUserMenuOpen(false); handleLogout(); }}>
                    <span className="kb-userdropdown-ico" aria-hidden>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M10 17l-1 0a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M15 12l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 12l-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35"/></svg>
                    </span>
                    <span className="kb-userdropdown-label">ログアウト</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {me && (
            <button className={`kb-tab ${isAdmin ? "kb-tab-active" : ""}`} style={{ cursor: "pointer" }} onClick={handleAdminClick}>
              管理画面
            </button>
          )}
          {me?.canViewAccounting && (
            <button className="kb-tab" style={{ cursor: "pointer" }} onClick={() => (window.location.href = "/accounting")}>
              経理
            </button>
          )}
        </div>
      </div>

      <div className="kb-main">
        <aside className="kb-panel" aria-label="フィルター" data-tour="filter-panel">
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
                <button 
                  key={tag} 
                  type="button" 
                  className="kb-chip small" 
                  onClick={() => {
                    setKeyword(tag);
                    recordSearchLog(tag); // ✅ タグクリック時にログ送信
                  }}
                >
                  #{tag}
                </button>
              ))}
              {recentTags.length === 0 && <span className="kb-subnote">タグがまだ登録されていません。</span>}
            </div>
          </div>

          <div className="kb-panel-section" style={{ marginTop: "20px" }}>
            <div className="kb-panel-title">外部リンク</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {externalLinks
                .filter((l) => l.isActive)
                .map((link) => (
                  <a
                    key={link.linkId}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="kb-external-link-card"
                    style={{
                      display: "block",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      textDecoration: "none",
                      transition: "transform 0.1s, box-shadow 0.1s",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.1)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "none";
                      e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
                    }}
                  >
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#0f172a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      {link.title}
                      <span style={{ fontSize: "10px", color: "#94a3b8" }}>↗</span>
                    </div>
                    {link.description && (
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", lineHeight: "1.4" }}>{link.description}</div>
                    )}
                  </a>
                ))}
              {externalLinks.filter((l) => l.isActive).length === 0 && <span className="kb-subnote">登録されたリンクはありません。</span>}
            </div>

            {/* 直営店舗の担当者 または SV(加盟店): 店舗設定へのボタン */}
            {(directBrands.length > 0 || isSv) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={() => router.push("/store-settings")}
                  className="kb-admin-brand-btn"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 14px", borderRadius: "10px", cursor: "pointer",
                    border: "none", color: "#fff", fontWeight: 800, fontSize: "13px",
                    background: "linear-gradient(135deg,#334155,#0f172a)",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                  }}
                >
                  <span>管理画面（店舗設定）</span>
                  <span style={{ fontSize: "14px" }}>→</span>
                </button>
              </div>
            )}
          </div>
        </aside>

        <main className="kb-center">
          <div className="kb-card" data-tour="knowbie">
            <div className="kb-card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="kb-avatar">
                  <img src="/logos/Knowble_icon.png" alt="Knowbie アイコン" style={{ width: 32, height: 32, objectFit: "contain" }} />
                </div>
                <div>
                  <div className="kb-card-title">Knowbie（ノウビー）</div>
                  <div className="kb-card-subtitle">社内マニュアル／手順の質問に回答します</div>
                </div>
              </div>
              {messages.length > 0 && (
                <button type="button" className="kb-chat-reset" onClick={handleResetChat} title="会話をリセット">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                  リセット
                </button>
              )}
            </div>

            <div className="kb-chat-box">
              <div className="kb-chat-body">
                {launching && (
                  <div className="kb-launch" aria-hidden>
                    <div className="kb-launch-stars" />
                    <img className="kb-launch-bie" src="/logos/Knowble_icon.png" alt="" />
                    <div className="kb-launch-earth"><span className="kb-launch-earth-mark" /></div>
                  </div>
                )}
                {messages.length === 0 && (
                  <div className="kb-chat-empty">
                    <div className="kb-chat-empty-avatar kb-blink">
                      <img src="/logos/Knowble_icon.png" alt="Knowbie" />
                    </div>
                    <div className="kb-chat-empty-title">何でも聞いてください</div>
                    <div className="kb-chat-empty-sub">社内マニュアル・手順から、出典付きで回答します</div>
                    <div className="kb-chat-suggests">
                      {[
                        "入会手続きの流れを教えて",
                        "未納金がある会員のアプリでの支払い方法は？",
                        "Canvaでテロップを作るには？",
                        "休会の手続きを教えて",
                      ].map((s) => (
                        <button key={s} type="button" className="kb-chat-suggest" onClick={() => handleAsk(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`kb-msg kb-msg-${msg.role}`}>
                    {msg.role === "assistant" && (
                      <img className="kb-msg-avatar" src="/logos/Knowble_icon.png" alt="Knowbie" />
                    )}
                    <div className={`kb-bubble kb-bubble-${msg.role}`}>
                      {msg.role === "user" ? (
                        <span className="kb-bubble-usertext">{msg.content}</span>
                      ) : msg.loading && !msg.content ? (
                        <span className="kb-knowbie-loader">
                          <img src="/logos/Knowble_icon.png" alt="" className="kb-knowbie-loader-img" />
                          <span className="kb-knowbie-loader-text">考え中</span>
                          <span className="kb-typing"><span /><span /><span /></span>
                        </span>
                      ) : (
                        <>
                          <MarkdownMessage text={msg.content} />
                          {msg.loading && <span className="kb-typing inline"><span /><span /><span /></span>}
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {sources.length > 0 && (
                  <div className="kb-sources-wrap">
                    <button type="button" onClick={() => setShowSources(true)} className="kb-sources-btn">
                      <span className="kb-sources-dot" />
                      参照したマニュアル
                      <span className="kb-sources-count">{sources.length}</span>
                    </button>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="kb-chat-input-row">
                <input
                  className="kb-chat-input"
                  placeholder="質問を入力…（例：入会手続きの流れ）"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) handleAsk();
                  }}
                />
                <button
                  className={`kb-chat-send${loadingAI ? " stop" : ""}`}
                  onClick={loadingAI ? handleCancelAsk : () => handleAsk()}
                  disabled={!loadingAI && !prompt.trim()}
                  aria-label={loadingAI ? "停止" : "送信"}
                >
                  {loadingAI ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>
                  )}
                </button>
              </div>
            </div>

            {showSources && sources.length > 0 && (
              <div className="kb-srcmodal-bg" onClick={() => setShowSources(false)}>
                <div className="kb-srcmodal" onClick={(e) => e.stopPropagation()}>
                  <div className="kb-srcmodal-head">
                    <div className="kb-srcmodal-title">参照したマニュアル <span>{sources.length}件</span></div>
                    <button className="kb-srcmodal-x" onClick={() => setShowSources(false)} aria-label="閉じる">×</button>
                  </div>
                  <div className="kb-srcmodal-body">
                    {sources.map((s, i) => (
                      <button type="button" key={`${s.title}-${i}`} className="kb-srcitem" onClick={() => openSourceManual(s)}>
                        <div className="kb-srcitem-top">
                          <span className="kb-srcitem-badge">{i + 1}</span>
                          <span className="kb-srcitem-title">{String(s.title || (s as any).manualId || "マニュアル")}</span>
                        </div>
                        {s.excerpt ? <div className="kb-srcitem-excerpt">{String(s.excerpt)}</div> : null}
                        <span className="kb-srcitem-open">このマニュアルを開く →</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <RefundTasksPanel />

          <div className="kb-card kb-manual-card">
            <div className="kb-card-header">
              <div>
                <div className="kb-card-title">お知らせ</div>
                <div className="kb-card-meta">
                  {loadingNews ? "読み込み中..." : filteredNews.length === 0 ? "0 件表示中" : `${filteredNews.length} 件中 ${(newsPage - 1) * NEWS_PAGE_SIZE + 1}〜${Math.min(newsPage * NEWS_PAGE_SIZE, filteredNews.length)} 件を表示`}
                </div>
              </div>
            </div>

            {loadingNews && <div>読み込み中...</div>}
            {!loadingNews && filteredNews.length === 0 && <div style={{ fontSize: 13, color: "#6b7280", paddingTop: 8 }}>現在表示できるお知らせはありません。</div>}

            {!loadingNews &&
              pagedNews.map((n, idx) => {
                const id = n.newsId ? String(n.newsId) : `temp-key-${idx}`;
                const isExpanded = !!expandedNews[id];
                const brandName = n.brandId === "ALL" ? "全社共通" : brandMap[n.brandId || ""]?.name || "ブランド未設定";
                // yamauchi-News の deptId / bizId から yamauchi-Depts.name を解決
                const newsDeptId = (n as any).bizId || n.deptId || "";
                const deptName =
                  newsDeptId === "ALL" ? "全部署" :
                  newsDeptId ? (deptMap[newsDeptId]?.name || "部署未設定") :
                  "部署未設定";
                const displayDate = formatToJST(n.updatedAt || n.fromDate || "");

                return (
                  <div className={`kb-news-item ${isExpanded ? "open" : ""}`} key={id}>
                    <button type="button" className="kb-news-head" onClick={() => toggleNews(id)} aria-expanded={isExpanded}>
                      <div className="kb-news-head-left">
                        <div className="kb-news-title">{n.title}</div>
                        <div className="kb-news-meta">
                          <span className="kb-news-meta-strong">{brandName} / {deptName}</span>
                          {displayDate && <span className="kb-news-meta-muted">更新日時：{displayDate} </span>}
                        </div>
                        {(n.tags || []).length > 0 && (
                          <div className="kb-news-tags">
                            {(n.tags || []).map((t, i) => <span className="kb-news-tag" key={`tag-${id}-${i}`}>{t}</span>)}
                          </div>
                        )}
                      </div>
                      <div className="kb-news-head-right">{isExpanded ? "▴" : "▾"}</div>
                    </button>

                    <div className="kb-news-body-anim" style={{ maxHeight: isExpanded ? "800px" : "0px" }}>
                      <div className="kb-news-body-inner">
                        {n.body ? renderRichText(n.body) : <div className="kb-news-empty">本文はありません。</div>}
                        {n.url && (
                          <div className="kb-news-url-section" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #e2e8f0' }}>
                            <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>外部URL:</span>
                            <a href={n.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#3b82f6', textDecoration: 'underline', wordBreak: 'break-all' }}>{n.url}</a>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

            {!loadingNews && totalNewsPages > 1 && (
              <div style={{ marginTop: 12 }}>
                <div className="kb-pager">
                  <button type="button" className="kb-pager-btn" disabled={newsPage === 1} onClick={() => setNewsPage((p) => Math.max(1, p - 1))}>前へ</button>
                  <span className="kb-pager-info">{newsPage} / {totalNewsPages}</span>
                  <button type="button" className="kb-pager-btn" disabled={newsPage === totalNewsPages} onClick={() => setNewsPage((p) => Math.min(totalNewsPages, p + 1))}>次へ</button>
                </div>
              </div>
            )}
          </div>

          <div className="kb-card kb-manual-card" ref={manualListRef} data-tour="manual-list">
            <div className="kb-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
              <div>
                <div className="kb-card-title">マニュアル一覧</div>
                <div className="kb-card-meta">
                  {loadingManuals
                    ? "読み込み中..."
                    : totalManualCount === 0
                    ? "0 件表示中"
                    : `マニュアル ${totalManualCount} 本 (シリーズ含む ${mixedItems.length} 件中 ${(manualPage - 1) * PAGE_SIZE + 1}〜${Math.min(manualPage * PAGE_SIZE, mixedItems.length)} 件を表示)`}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", background: "#f1f5f9", padding: 4, borderRadius: 10, gap: 4 }}>
                  <button type="button" onClick={() => setManualSortKey("publish")} style={{ padding: "6px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 800, background: manualSortKey === "publish" ? "#fff" : "transparent", boxShadow: manualSortKey === "publish" ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>公開日</button>
                  <button type="button" onClick={() => setManualSortKey("update")} style={{ padding: "6px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 800, background: manualSortKey === "update" ? "#fff" : "transparent", boxShadow: manualSortKey === "update" ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>更新日</button>
                </div>
                <button type="button" onClick={() => setManualSortOrder((p) => (p === "desc" ? "asc" : "desc"))} style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 800 }} title="昇順 / 降順">{manualSortOrder === "desc" ? "↓" : "↑"}</button>
              </div>
            </div>

            {loadingManuals && <div>読み込み中...</div>}
            {!loadingManuals && mixedItems.length === 0 && <div style={{ fontSize: 13, color: "#6b7280", paddingTop: 8 }}>条件に一致するマニュアルがありません。</div>}
            {!loadingManuals && mixedItems.length > 0 && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {pagedMixedItems.map((item) => {
                    // 配信部署名を bizId からルックアップして補完
                    // (古いマニュアルは biz が保存されているが、新しいものは bizId だけのことがある)
                    const enrichBiz = <T extends { biz?: string | null; bizId?: string }>(m: T): T & { biz?: string } => ({
                      ...m,
                      biz: m.biz || (m.bizId ? deptMap[m.bizId]?.name : undefined) || undefined,
                    });

                    if (item.kind === "series") {
                      const detail = seriesDetailMap[item.categoryId];
                      // シリーズの biz も bizId から補完
                      const seriesBizName = detail?.biz || (detail?.bizId ? deptMap[detail.bizId]?.name : undefined) || null;
                      return (
                        <SeriesScroll
                          key={`series:${item.categoryId}`}
                          seriesName={item.name}
                          manuals={item.manuals.map((m) => enrichBiz({
                            ...m,
                            startDate: formatToJST(m.startDate),
                            updatedAt: formatToJST(m.updatedAt),
                            viewScope: normalizeManualViewScope(m.viewScope),
                          }))}
                          userId={me?.userId ?? ""}
                          description={detail?.description ?? null}
                          biz={seriesBizName}
                          publishedAt={detail?.publishedAt ?? null}
                          thumbnailUrl={detail?.thumbnailUrl ?? null}
                          searchTokens={searchHighlightTokens}
                        />
                      );
                    }
                    // 単独マニュアル
                    const m = item.manual;
                    return (
                      <ManualList
                        key={`manual:${m.manualId}`}
                        manuals={[enrichBiz({
                          ...m,
                          startDate: formatToJST(m.startDate),
                          updatedAt: formatToJST(m.updatedAt),
                          viewScope: normalizeManualViewScope(m.viewScope),
                        })]}
                        userId={me?.userId ?? ""}
                        seriesNameMap={seriesNameMap}
                        searchTokens={searchHighlightTokens}
                      />
                    );
                  })}
                </div>
                {totalManualPages > 1 && (
                  <div className="kb-pager">
                    <button type="button" className="kb-pager-btn" disabled={manualPage === 1} onClick={() => setManualPage((p) => Math.max(1, p - 1))}>前へ</button>
                    <span className="kb-pager-info">{manualPage} / {totalManualPages}</span>
                    <button type="button" className="kb-pager-btn" disabled={manualPage === totalManualPages} onClick={() => setManualPage((p) => Math.min(totalManualPages, p + 1))}>次へ</button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        <aside className="kb-panel" data-tour="contact-list">
          <div className="kb-panel-header-row">
            <div className="kb-panel-title">担当者リスト{currentDeptTitleLabel}</div>
          </div>
          <div className="kb-contact-inquiry-wrap">
            <button type="button" className="kb-contact-inquiry-btn" onClick={() => setIsInquiryModalOpen(true)}>問い合わせ</button>
          </div>
          <div className="kb-contact-list-wrapper" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <ContactList contacts={filteredContacts} contactSearch={contactSearch} setContactSearch={setContactSearch} deptMap={deptMap} loading={loadingContacts} fallbackKeyword={keyword} />
          </div>
        </aside>
      </div>

      {isInquiryModalOpen && (
        <div className="kb-modal-backdrop" onClick={() => setIsInquiryModalOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", justifyContent: "center", alignItems: "center", padding: 16, zIndex: 10000, backdropFilter: "blur(4px)" }}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: 24, background: "#fff", borderRadius: 20, maxHeight: "90vh", overflow: "auto" }}>
            <div className="kb-card-title" style={{ marginBottom: 16 }}>問い合わせ先を選択してください</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {depts.map((d) => (
                <button key={d.deptId} className="kb-secondary-btn" onClick={() => handleInquirySubmit(d.mailingList, d.name)} style={{ textAlign: "left", padding: "12px 16px", borderRadius: 12, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer" }}>
                  {d.name}
                </button>
              ))}
              {depts.length === 0 && <div style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', padding: '20px' }}>問い合わせ先（部署）が登録されていません。</div>}
            </div>
            <button className="kb-logout-btn" style={{ marginTop: 20, width: "100%", padding: "10px", cursor: "pointer" }} onClick={() => setIsInquiryModalOpen(false)}>キャンセル</button>
          </div>
        </div>
      )}

      {previewManual && (
        <div className="kb-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", justifyContent: "center", alignItems: "center", padding: 16, zIndex: 9999, backdropFilter: "blur(4px)" }} onClick={() => setPreviewManual(null)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1040, maxHeight: "90vh", background: "linear-gradient(135deg, #0f172a 0%, #020617 20%, #f9fafb 20%, #ffffff 100%)", borderRadius: 20, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", background: "radial-gradient(circle at top left, #0ea5e9, #020617)", color: "#e5f4ff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 999, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📘</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2, color: "#f9fafb" }}>{previewManual.title}</div>
                  <div style={{ fontSize: 12, opacity: 0.9 }}>{previewManual.brandId && (brandMap[previewManual.brandId]?.name || previewManual.brand || "ブランド未設定")}{previewManual.bizId && ` / ${deptMap[previewManual.bizId]?.name || previewManual.biz || "部署未設定"}`}{previewManual.updatedAt && ` / 更新日: ${formatToJST(previewManual.updatedAt)}`}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {previewManual.embedUrl && <button className="kb-primary-btn" style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, border: "none", background: "#f9fafb", color: "#0f172a", cursor: "pointer" }} onClick={() => window.open(previewManual.embedUrl!, "_blank")}>新しいタブで開く</button>}
                <button className="kb-secondary-btn" style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(248,250,252,0.6)", background: "transparent", color: "#e5f4ff", cursor: "pointer" }} onClick={() => setPreviewManual(null)}>閉じる</button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", padding: 16, gap: 12, background: "#f9fafb", flex: 1, minHeight: 0 }}>
              {previewManual.desc && <div style={{ fontSize: 13, color: "#374151", whiteSpace: "pre-wrap", borderRadius: 12, background: "#ffffff", padding: 10, border: "1px solid #e5e7eb" }}>{previewManual.desc}</div>}
              {(() => {
                const isVideo = (previewManual as any).type === "video";
                const yt = isYouTubeUrl(previewManual.embedUrl);
                let embedSrc = getEmbedSrc(previewManual.embedUrl);
                if (yt) {
                  const idm = String(previewManual.embedUrl).match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
                  const vid = idm?.[1];
                  if (vid) embedSrc = `https://www.youtube.com/embed/${vid}?rel=0${seekSec != null ? `&start=${seekSec}&autoplay=1` : ""}`;
                }
                if (!embedSrc) return <div style={{ fontSize: 13, color: "#6b7280", padding: 12, borderRadius: 10, background: "#e5e7eb" }}>プレビューURLがありません。</div>;
                return (
                  <div style={{ flex: 1, display: "flex", gap: 12, minHeight: 0 }}>
                    <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", minWidth: 0 }}>
                      <div style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 14, overflow: "hidden", border: "1px solid #d1d5db", background: "#020617", position: "relative" }}>
                        <iframe key={yt ? `yt-${seekSec ?? "0"}` : "frame"} src={embedSrc} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} allowFullScreen loading="lazy" allow="autoplay" />
                      </div>
                    </div>
                    {isVideo && (
                      <div style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                        <div style={{ padding: "10px 12px", borderBottom: "1px solid #eef2f7", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>チャプター</span>
                          {isAdmin && (
                            <button onClick={generateChapters} disabled={chaptersLoading}
                              style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 8, border: "1px solid #c7d2fe", background: chaptersLoading ? "#eef2ff" : "#eef2ff", color: "#4338ca", cursor: chaptersLoading ? "default" : "pointer" }}>
                              {chaptersLoading ? "生成中…" : chapters.length ? "再生成" : "AIで生成"}
                            </button>
                          )}
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                          {chapters.length === 0 ? (
                            <div style={{ fontSize: 12, color: "#94a3b8", padding: "16px 8px", textAlign: "center", lineHeight: 1.7 }}>
                              {chaptersLoading ? "生成中…" : "チャプターはまだありません。" + (isAdmin ? "「AIで生成」で作成できます。" : "")}
                            </div>
                          ) : chapters.map((c, i) => (
                            <button key={i} onClick={() => { if (yt) setSeekSec(c.t); }}
                              title={yt ? "ここから再生" : "この動画は頭出し非対応（時刻の参考表示）"}
                              style={{ display: "flex", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", background: seekSec === c.t ? "#eef2ff" : "transparent", cursor: yt ? "pointer" : "default", marginBottom: 2 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "#4338ca", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 38 }}>{fmtChapTime(c.t)}</span>
                              <span style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>{c.title}</span>
                            </button>
                          ))}
                        </div>
                        {chapters.length > 0 && !yt && <div style={{ fontSize: 10.5, color: "#94a3b8", padding: "8px 10px", borderTop: "1px solid #eef2f7", lineHeight: 1.5 }}>※ この動画は頭出し非対応です（時刻は参考表示）。頭出しにはYouTube配信が必要です。</div>}
                      </div>
                    )}
                    {!isVideo && (
                      <div style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                        <div style={{ padding: "10px 12px", borderBottom: "1px solid #eef2f7", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>目次</span>
                          {isAdmin && (
                            <button onClick={generateToc} disabled={tocLoading}
                              style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 8, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", cursor: tocLoading ? "default" : "pointer" }}>
                              {tocLoading ? "生成中…" : toc.length ? "再生成" : "AIで生成"}
                            </button>
                          )}
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                          {toc.length === 0 ? (
                            <div style={{ fontSize: 12, color: "#94a3b8", padding: "16px 8px", textAlign: "center", lineHeight: 1.7 }}>
                              {tocLoading ? "生成中…" : "目次はまだありません。" + (isAdmin ? "「AIで生成」で作成できます。" : "")}
                            </div>
                          ) : toc.map((c, i) => (
                            <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", borderRadius: 8, marginBottom: 2 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "#4338ca", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 20 }}>{i + 1}</span>
                              <span style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>{c.title}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {isAdminErrorModalOpen && (
        <div className="kb-modal-backdrop" onClick={() => setIsAdminErrorModalOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", display: "flex", justifyContent: "center", alignItems: "center", padding: 16, zIndex: 10001, backdropFilter: "blur(6px)" }}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: "32px 24px", background: "#fff", borderRadius: 24, textAlign: "center", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🚫</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#1e293b", marginBottom: "12px" }}>アクセス権限がありません</div>
            <p style={{ fontSize: "14px", color: "#64748b", lineHeight: "1.6", marginBottom: "24px" }}>管理画面へのアクセスには「管理者権限」が必要です。<br />権限が必要な場合は管理者へ連絡してください。</p>
            <button className="kb-primary-btn" style={{ width: "100%", padding: "12px", borderRadius: "12px", background: "#0f172a", color: "#fff", border: "none", cursor: "pointer" }} onClick={() => setIsAdminErrorModalOpen(false)}>閉じる</button>
          </div>
        </div>
      )}

      {/* 使い方ガイドモーダル */}
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        slidesUrl={HELP_SLIDES_URL}
        title="Know Base 使い方ガイド"
      />

      {/* ガイドツアー */}
      <Tour steps={TOUR_STEPS} open={tourOpen} onClose={() => setTourOpen(false)} />

      <style jsx global>{`
        .kb-help-trigger {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 700;
          color: #475569;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          cursor: pointer;
          transition: 0.15s;
        }
        .kb-help-trigger:hover {
          border-color: #3b82f6;
          color: #3b82f6;
          background: #eff6ff;
        }
        .kb-help-trigger-label {
          letter-spacing: 0.02em;
        }
        @media (max-width: 640px) {
          .kb-help-trigger-label { display: none; }
        }
      `}</style>
    </div>
  );
}