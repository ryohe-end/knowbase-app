// app/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  viewScope?: "all" | "direct";
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

  // たまに来る可能性があるので保険で許可
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

function buildGroupIdsHeader(groupId?: string) {
  const HQ = "g003";
  const FRANCHISE = "g002";
  if (!groupId) return "";

  if (groupId === HQ) return HQ;

  // ✅ フランチャイズは自分のグループだけ
  if (groupId === FRANCHISE) return FRANCHISE;

  // ✅ それ以外は「自分 + 本部」
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

type ManualViewScope = "all" | "direct";

const normalizeManualViewScope = (v: unknown): "all" | "direct" => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "direct" ? "direct" : "all";
};

/* ========= キーワード分解（単語検索用） ========= */
function tokenizeJP(input: string) {
  const raw = (input || "").toLowerCase().trim();
  if (!raw) return [];

  // 1) 記号を空白化
  const cleaned = raw.replace(
    /[、。,.!！?？:：;；()（）[\]【】{}「」『』<>・/\\|"'`~^＝=＋+＿_〜\-\n\r\t]/g,
    " "
  );

  // 2) 英数字トークン
  const latin = cleaned.match(/[a-z0-9]+/g) ?? [];

  // 3) 日本語かたまり
  const jpChunks = cleaned.match(/[一-龯々〆ヵヶぁ-んァ-ヴー]{2,}/g) ?? [];

  // 4) 分割
  const particleSplitter =
    /(の|を|は|が|に|へ|と|で|や|から|まで|です|ます|する|したい|教えて|について)/g;
  const suffixSplitter =
    /(方法|やり方|手順|手続き|流れ|とは|って|できない|したい)/g;

  const jpTokens = jpChunks
    .flatMap((chunk) =>
      chunk
        .replace(particleSplitter, " ")
        .replace(suffixSplitter, " ")
        .split(/\s+/)
        .filter(Boolean)
    )
    .filter((t) => t.length >= 2);

  // 5) ストップワード
  const stopWords = new Set([
    "の",
    "を",
    "は",
    "が",
    "に",
    "へ",
    "と",
    "で",
    "や",
    "から",
    "まで",
    "です",
    "ます",
    "する",
    "したい",
    "教えて",
    "方法",
    "やり方",
    "手順",
    "について",
    "流れ",
  ]);

  const tokens = [...latin, ...jpTokens]
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !stopWords.has(t));

  // 6) "fit 365" 対策：連結も追加
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
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: "#e2e8f0", letterSpacing: "0.02em" }}>
          参照元
        </div>
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
                background:
                  "linear-gradient(180deg, rgba(15,23,42,0.65) 0%, rgba(2,6,23,0.45) 100%)",
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
                    minWidth: 28,
                    height: 28,
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#0b1220",
                    background: "linear-gradient(180deg, #93c5fd 0%, #60a5fa 100%)",
                    boxShadow: "0 6px 14px rgba(59,130,246,0.25)",
                    flexShrink: 0,
                  }}
                >
                  {num}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: "#e2e8f0",
                      lineHeight: 1.35,
                      marginBottom: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={s.title || "参照元"}
                  >
                    {s.title || "参照元"}
                  </div>

                  {String(s.snippet || "").trim() && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(226,232,240,0.75)",
                        lineHeight: 1.55,
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
                        overflow: "hidden",
                        marginBottom: 8,
                      }}
                    >
                      {s.snippet}
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div
                      style={{
                        fontSize: 11,
                        color: "rgba(148,163,184,0.9)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "85%",
                      }}
                      title={domain}
                    >
                      {domain || "source"}
                    </div>

                    <div style={{ fontSize: 11, color: "rgba(147,197,253,0.95)", fontWeight: 700 }}>
                      開く ↗
                    </div>
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
  type Me = { name?: string; email?: string; role?: string; groupId?: string; mustChangePassword?: boolean };

const [me, setMe] = useState<Me | null>(null);
  const isAdmin = useMemo(() => me?.role === "admin", [me]);
  const [isAdminErrorModalOpen, setIsAdminErrorModalOpen] = useState(false);

  // ✅ authチェック（初回 / リロード）
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

      // ✅ 初回ログイン or 再発行後 → パスワード変更を強制
      if (data.user.mustChangePassword === true && !isOnPasswordPage) {
        const returnTo =
          window.location.pathname + window.location.search;

        router.replace(
          `/account/password?returnTo=${encodeURIComponent(returnTo)}`
        );
        return;
      }

      setMe(data.user);
    } catch {
      router.replace("/login");
    }
  };

  checkAuth();

  return () => {
    cancelled = true;
  };
}, [router]);

  // ✅ 管理画面ボタン
  const handleAdminClick = () => {
    if (isAdmin) window.location.href = "/admin";
    else setIsAdminErrorModalOpen(true);
  };

  /* ========= ユーザー名メニュー（名前クリック） ========= */
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const menuItemStyle: React.CSSProperties = {
    width: "100%",
    textAlign: "left",
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    color: "#0f172a",
    display: "flex",
    alignItems: "center",
  };

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

// 既存の state（あなたのまま）
const [prompt, setPrompt] = useState("");
const [loadingAI, setLoadingAI] = useState(false);
const [messages, setMessages] = useState<Message[]>([]);
const [sources, setSources] = useState<SourceAttribution[]>([]);
const [showSources, setShowSources] = useState(false);
const chatEndRef = useRef<HTMLDivElement | null>(null);
const manualListRef = useRef<HTMLDivElement | null>(null);

const [keyword, setKeyword] = useState("");
const [selectedBrandId, setSelectedBrandId] = useState<string>(ALL_BRAND_ID);
const [selectedDeptId, setSelectedDeptId] = useState<string>(ALL_DEPT_ID);
const [contactSearch, setContactSearch] = useState("");
const SLOW_TIP = "検索に時間がかかっています…（10〜20秒ほどかかる場合があります）";
const INITIAL_TEXT = "送信しました。検索しています…";

// ★ 追加：会話継続したい場合（サーバーから conversationId が返る前提）
const [conversationId, setConversationId] = useState<string | undefined>(undefined);

// ★ 追加：キャンセル用 AbortController を保持
const abortRef = useRef<AbortController | null>(null);

// ★ 追加：ストリーミング描画を軽くするバッファ
const aiBufRef = useRef("");
const flushTimerRef = useRef<number | null>(null);

/** 参照元の uniq merge（あなたのを流用） */
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

/** ★ streaming中は smooth をやめる（最重要） */
useEffect(() => {
  const behavior = loadingAI ? "auto" : "smooth";
  chatEndRef.current?.scrollIntoView({ behavior, block: "end" });
}, [messages, sources, showSources, loadingAI]);

/** ★ 受信テキストを 50ms で間引き反映 */
const flushAssistant = (assistantId: number) => {
  flushTimerRef.current = null;
  const chunk = aiBufRef.current;
  aiBufRef.current = "";
  if (!chunk) return;

  setMessages((prev) =>
    prev.map((m) =>
      m.id === assistantId
        ? { ...m, content: (m.content ?? "") + chunk, loading: true }
        : m
    )
  );
};

const appendToAssistant = (assistantId: number, chunk: string) => {
  if (!chunk) return;
  aiBufRef.current += chunk;
  if (flushTimerRef.current != null) return;

  flushTimerRef.current = window.setTimeout(() => flushAssistant(assistantId), 50);
};

const setAssistantDone = (assistantId: number) => {
  // 残バッファを反映してから終わる
  if (flushTimerRef.current != null) {
    window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }
  if (aiBufRef.current) {
    const rest = aiBufRef.current;
    aiBufRef.current = "";
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? { ...m, content: (m.content ?? "") + rest, loading: true }
          : m
      )
    );
  }

  setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, loading: false } : m)));
};

/** ★ キャンセル（ボタン用） */
function handleCancelAsk() {
  if (!loadingAI) return;

  try {
    abortRef.current?.abort();
  } catch {}

  abortRef.current = null;

  // UI上も “中断” と分かるようにする（最新のassistantを探す簡易版）
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

/** ★ メイン：質問送信 */
async function handleAsk() {
  if (!prompt.trim() || loadingAI) return;

  const userPrompt = prompt.trim();
  setKeyword(userPrompt);
  setPrompt("");
  setSources([]);
  setShowSources(false);

  const now = Date.now();
  const newUserMessage: Message = { id: now, role: "user", content: userPrompt };
  const assistantId = now + 1;

  const newAssistantMessage: Message = {
    id: assistantId,
    role: "assistant",
    content: "送信しました。検索しています…",
    loading: true,
  };

  // 表示を追加
  setMessages((prev) => [...prev, newUserMessage, newAssistantMessage]);
  setLoadingAI(true);

  // streamingバッファ初期化
  aiBufRef.current = "";
  if (flushTimerRef.current != null) {
    window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }

  // AbortController セット
  const ac = new AbortController();
  abortRef.current = ac;

  const slowTimer = window.setTimeout(() => {
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== assistantId || !m.loading) return m;

      // まだ本文が来てない“初期状態”のときだけ置き換える
      const cur = (m.content ?? "").trim();
      if (cur === "" || cur === INITIAL_TEXT) {
        return { ...m, content: SLOW_TIP };
      }

      // すでに何か本文が来てるなら何もしない（邪魔しない）
      return m;
    })
  );
}, 3000);

  try {
    const res = await fetch("/api/amazonq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        prompt: userPrompt,
        conversationId, // ★ 継続したい場合
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

    // SSE
    if (contentType.includes("text/event-stream")) {
  // ✅ ここで slow 表示を止める（遅い文言が途中で混ざるのを防止）
  window.clearTimeout(slowTimer);

  // “検索しています…” / slowTip を消してストリーム表示開始
  setMessages((prev) =>
    prev.map((m) => (m.id === assistantId ? { ...m, content: "", loading: true } : m))
  );

      const handleSseBlock = (block: string) => {
        const eventName = extractSseEventName(block);
        const data = extractSseData(block);

        if (eventName === "ping") return { stop: false };

        if (eventName === "conversation") {
          // { conversationId: "..." }
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
              // setShowSources(true); // 必要ならON
            }
          } catch (e) {
            console.warn("Failed to parse sources:", e, data);
          }
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

        if (data) appendToAssistant(assistantId, data);
        return { stop: false };
      };

      if (!res.body) {
        // body が無い環境は fallback
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

      // 最後に残った分も処理
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

    // SSEじゃない場合（JSON or text）
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
    // ★ キャンセルはここに来る
    const aborted =
      err instanceof DOMException
        ? err.name === "AbortError"
        : err instanceof Error && (err as any).name === "AbortError";

    if (aborted) {
      // handleCancelAsk 側でも表示してるけど、ここでも保険
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
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newsList, setNewsList] = useState<News[]>([]);
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>([]);

  // ローディング状態
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadingManuals, setLoadingManuals] = useState(true);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);

  const [previewManual, setPreviewManual] = useState<Manual | null>(null);

  const PAGE_SIZE = 5;
  type ManualSortKey = "publish" | "update";
  type SortOrder = "asc" | "desc";

const [manualSortKey, setManualSortKey] = useState<ManualSortKey>("publish"); // 公開日
const [manualSortOrder, setManualSortOrder] = useState<SortOrder>("desc");    // 新しい順
  const [manualPage, setManualPage] = useState(1);

  // ★ お知らせ：ページネーション
  const NEWS_PAGE_SIZE = 3;
  const [newsPage, setNewsPage] = useState(1);

  // ★ お知らせ：最大3件アコーディオン
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

  // ✅ 初期データロード（me確定後）
useEffect(() => {
  // me がまだ無い（認証中/未ログイン）なら何もしない
  if (!me) return;

  let cancelled = false;

  const fetchData = async () => {
    try {
      // ✅ group header（me.groupId がある時だけ付与）
      const groupIds = me?.groupId ? buildGroupIdsHeader(me.groupId) : "";
const groupHeaders: HeadersInit = groupIds
  ? { "x-kb-group-ids": groupIds }
  : {};


      // ✅ まとめて取得
      const [manualsRes, brandsRes, deptsRes, contactsRes, newsRes, linksRes] = await Promise.all([
        fetch("/api/manuals?onlyActive=1", { headers: groupHeaders, cache: "no-store" }).then((res) => res.json()),
        fetch("/api/brands", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/depts", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/contacts", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/news?onlyActive=1", { headers: groupHeaders, cache: "no-store" }).then((res) => res.json()),
        fetch("/api/external-links", { cache: "no-store" }).then((res) => res.json()),
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

  return () => {
    cancelled = true;
  };
}, [me]);

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
  const tokens = tokenizeJP(keyword);
  const hasTokens = tokens.length > 0;

  const isFranchise = me?.groupId === "g002";

  return manuals.filter((m) => {
    // ✅ フランチャイズは direct のみ表示
    if (isFranchise && normalizeManualViewScope(m.viewScope) !== "direct") return false;

    if (selectedBrandId !== ALL_BRAND_ID && (m.brandId ?? "") !== selectedBrandId) return false;
    if (selectedDeptId !== ALL_DEPT_ID && (m.bizId ?? "") !== selectedDeptId) return false;

    if (!hasTokens) return true;

    const haystack = [m.title ?? "", m.desc ?? "", ...(m.tags ?? []), m.brand ?? "", m.biz ?? ""]
      .join(" ")
      .toLowerCase();

    return tokens.some((t) => haystack.includes(t));
  });
}, [manuals, keyword, selectedBrandId, selectedDeptId, me]);

  useEffect(
  () => setManualPage(1),
  [keyword, selectedBrandId, selectedDeptId, manualSortKey, manualSortOrder]
);

  function parseTimeMs(s?: string | null) {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
}

// ✅ 空日付は常に最後に飛ばす（2100年）
const FAR_FUTURE = 4102444800000; // 2100-01-01

// ✅ 全体をソート（公開日>最終更新 or 更新日）してからページング
const sortedManuals = useMemo(() => {
  const list = [...filteredManuals];

  list.sort((a, b) => {
    // 1) primary（publish: startDate / update: updatedAt）
    const aPrimary =
      manualSortKey === "publish"
        ? (parseTimeMs(a.startDate) ?? FAR_FUTURE)
        : (parseTimeMs(a.updatedAt) ?? FAR_FUTURE);

    const bPrimary =
      manualSortKey === "publish"
        ? (parseTimeMs(b.startDate) ?? FAR_FUTURE)
        : (parseTimeMs(b.updatedAt) ?? FAR_FUTURE);

    // 2) publish のときはタイブレークに updatedAt（要件：公開日 > 最終更新）
    const aTie = parseTimeMs(a.updatedAt) ?? FAR_FUTURE;
    const bTie = parseTimeMs(b.updatedAt) ?? FAR_FUTURE;

    const primaryDiff = aPrimary - bPrimary;
    const tieDiff = aTie - bTie;

    const cmp = primaryDiff !== 0 ? primaryDiff : tieDiff;
    return manualSortOrder === "desc" ? -cmp : cmp;
  });

  return list;
}, [filteredManuals, manualSortKey, manualSortOrder]);

// ✅ 総ページ数（sortedManuals 기준で）
const totalManualPages = Math.max(1, Math.ceil(sortedManuals.length / PAGE_SIZE));

// ✅ 5件ずつに切るのはソート後
const pagedManuals = useMemo(() => {
  const start = (manualPage - 1) * PAGE_SIZE;
  return sortedManuals.slice(start, start + PAGE_SIZE);
}, [sortedManuals, manualPage]);

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
        if (
          selectedBrandId !== ALL_BRAND_ID &&
          selectedBrandId &&
          !(c.brandId === "ALL" || c.brandId === selectedBrandId)
        )
          return null;
        if (selectedDeptId !== ALL_DEPT_ID && selectedDeptId && c.deptId !== selectedDeptId) return null;

        if (!kw) return { ...c };

        const deptLabel = deptMap[c.deptId]?.name ?? "";

        const haystack = [c.name, c.email, c.role ?? "", deptLabel].join(" ").toLowerCase();

        if (!haystack.includes(kw)) return null;

        return { ...c };
      })
      .filter((v): v is Contact => v !== null);
  }, [contacts, selectedBrandId, selectedDeptId, contactSearch, keyword, deptMap]);

  const currentDeptTitleLabel =
    selectedDeptId === ALL_DEPT_ID ? "" : `（${deptMap[selectedDeptId]?.name}）`;

  const filteredNews = useMemo(() => {
    const kw = keyword.trim().toLowerCase();

    return newsList
      .filter((n) => {
        if (n.isHidden) return false;

        // ✅ API側でグループ制御している前提なら、ここは削除してOK
// if (me && n.targetGroupIds && n.targetGroupIds.length > 0) {
//   if (!n.targetGroupIds.includes(me.groupId)) return false;
// }

        if (selectedBrandId !== ALL_BRAND_ID && n.brandId !== "ALL" && (n.brandId ?? "") !== selectedBrandId)
          return false;
        if (selectedDeptId !== ALL_DEPT_ID && n.deptId !== "ALL" && (n.deptId ?? "") !== selectedDeptId)
          return false;

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
  }, [newsList, selectedBrandId, selectedDeptId, me, keyword]);

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

  // ✅ 修正後の関数：管理画面で設定したメーリングリストに対応
  const handleInquirySubmit = (emails: string | string[] | undefined, deptName?: string) => {
    if (!emails || (Array.isArray(emails) && emails.length === 0)) {
      alert("問い合わせ先メールアドレスが設定されていません。管理画面の「部署・メーリングリスト管理」で設定を確認してください。");
      return;
    }

    // 配列（メーリングリスト）ならカンマ区切りに結合、単体ならそのまま使用
    const to = Array.isArray(emails) ? emails.join(",") : emails;
    const subject = encodeURIComponent(`【KnowBase問い合わせ】${deptName || ""} 宛`);
    
    // Gmail作成画面のURLを生成
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${subject}`;
    
    window.open(gmailUrl, "_blank", "noopener,noreferrer");
    setIsInquiryModalOpen(false);
  };

  /* ========= UI ========= */

  if (isInitialLoading) {
    return (
      <div className="kb-loading-root">
        <div className="kb-loading-container">
          <img
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
            alt="Logo"
            className="kb-loading-logo"
          />
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
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: "none" }}>
          <div
            className="kb-topbar-left"
            style={{ display: "flex", alignItems: "center", gap: "20px", cursor: "pointer" }}
          >
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                manualListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
          />
        </div>

        <div className="kb-topbar-right">
         {/* ✅ ユーザー名クリックメニュー（Minimal / Modern） */}
<div ref={userMenuRef} style={{ position: "relative" }}>
  <button
    type="button"
    className={"kb-userpill" + (userMenuOpen ? " open" : "")}
    onClick={() => setUserMenuOpen((v) => !v)}
    aria-haspopup="menu"
    aria-expanded={userMenuOpen}
  >
    <span className="kb-userpill-avatar" aria-hidden>
      {(me?.name ?? "G").charAt(0)}
    </span>

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
          <div className="kb-userdropdown-avatar" aria-hidden>
            {(me?.name ?? "G").charAt(0)}
          </div>
          <div className="kb-userdropdown-info">
            <div className="kb-userdropdown-name">{me?.name ? `${me.name} 様` : "ゲスト"}</div>
            {!!me?.email && <div className="kb-userdropdown-email">{me.email}</div>}
          </div>
        </div>
      </div>

      <div className="kb-userdropdown-list">
        <button
          type="button"
          role="menuitem"
          className="kb-userdropdown-item"
          onClick={() => {
            setUserMenuOpen(false);
            router.push("/account/name"); // ←ここはあなたのページに合わせて変更
          }}
        >
          <span className="kb-userdropdown-ico" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span className="kb-userdropdown-label">名前の変更</span>
        </button>

        <button
          type="button"
          role="menuitem"
          className="kb-userdropdown-item"
          onClick={() => {
            setUserMenuOpen(false);
            router.push("/account/password"); // ←ここも変更OK
          }}
        >
          <span className="kb-userdropdown-ico" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M6 11h12v10H6V11z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M12 15v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </span>
          <span className="kb-userdropdown-label">パスワードを変更</span>
        </button>

        <div className="kb-userdropdown-sep" />

        <button
          type="button"
          role="menuitem"
          className="kb-userdropdown-item danger"
          onClick={() => {
            setUserMenuOpen(false);
            handleLogout();
          }}
        >
          <span className="kb-userdropdown-ico" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M10 17l-1 0a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M15 12l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M15 12l-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M21 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35"/>
            </svg>
          </span>
          <span className="kb-userdropdown-label">ログアウト</span>
        </button>
      </div>
    </div>
  )}
</div>


          {/* 管理画面 */}
          {me && (
            <button className={`kb-tab ${isAdmin ? "kb-tab-active" : ""}`} style={{ cursor: "pointer" }} onClick={handleAdminClick}>
              管理画面
            </button>
          )}
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

          {/* ---- 外部リンク ---- */}
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
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        color: "#0f172a",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      {link.title}
                      <span style={{ fontSize: "10px", color: "#94a3b8" }}>↗</span>
                    </div>
                    {link.description && (
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", lineHeight: "1.4" }}>
                        {link.description}
                      </div>
                    )}
                  </a>
                ))}
              {externalLinks.filter((l) => l.isActive).length === 0 && (
                <span className="kb-subnote">登録されたリンクはありません。</span>
              )}
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
              <div className="kb-subnote"></div>
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

                {sources.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,0.35)" }}>
                    <button
                      type="button"
                      onClick={() => setShowSources((v) => !v)}
                      className="kb-sources-toggle"
                      aria-expanded={showSources}
                    >
                      <span className="kb-sources-toggle-left">
                        <span className="kb-sources-dot" />
                        <span className="kb-sources-label">参照元</span>
                        <span className="kb-sources-count">{sources.length}件</span>
                      </span>

                      <span className={"kb-sources-caret" + (showSources ? " open" : "")}>▾</span>
                    </button>

                    {showSources && (
                      <div style={{ marginTop: 8 }}>
                        <SourcesPanel sources={sources} />
                      </div>
                    )}
                  </div>
                )}

                <div ref={chatEndRef} />
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
                <button
  className="kb-chat-send"
  onClick={loadingAI ? handleCancelAsk : handleAsk}
  disabled={!loadingAI && !prompt.trim()}
>
  {loadingAI ? "■" : "送信"}
</button>
              </div>
            </div>
          </div>

          {/* お知らせ */}
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
  {/* 本文の表示 */}
  {n.body ? renderRichText(n.body) : <div className="kb-news-empty">本文はありません。</div>}

  {/* ✅ 参考URLがある場合にリンクを表示 */}
  {n.url && (
    <div 
      className="kb-news-url-section" 
      style={{ 
        marginTop: '12px', 
        paddingTop: '12px', 
        borderTop: '1px dashed #e2e8f0' 
      }}
    >
      <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
        外部URL:
      </span>
      <a 
        href={n.url} 
        target="_blank" 
        rel="noopener noreferrer" 
        style={{ 
          fontSize: '13px', 
          color: '#3b82f6', 
          textDecoration: 'underline',
          wordBreak: 'break-all' 
        }}
      >
        {n.url}
      </a>
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

          {/* マニュアル */}
<div className="kb-card kb-manual-card" ref={manualListRef}>
  {/* ✅ header を差し替え（左：タイトル/件数 右：トグルUI） */}
  <div
    className="kb-card-header"
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end",
      gap: 12,
    }}
  >
    {/* 左：タイトルと件数 */}
    <div>
      <div className="kb-card-title">マニュアル一覧</div>
      <div className="kb-card-meta">
        {loadingManuals
          ? "読み込み中..."
          : filteredManuals.length === 0
          ? "0 件表示中"
          : `${sortedManuals.length} 件中 ${(manualPage - 1) * PAGE_SIZE + 1}〜${Math.min(
    manualPage * PAGE_SIZE,
    sortedManuals.length
  )} 件を表示`}
      </div>
    </div>

    {/* 右：ソートトグルUI */}
<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
  {/* 公開日/更新日 */}
  <div
    style={{
      display: "flex",
      background: "#f1f5f9",
      padding: 4,
      borderRadius: 10,
      gap: 4,
    }}
  >
    <button
      type="button"
      onClick={() => setManualSortKey("publish")}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 800,
        background: manualSortKey === "publish" ? "#fff" : "transparent",
        boxShadow: manualSortKey === "publish" ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
      }}
    >
      公開日
    </button>

    <button
      type="button"
      onClick={() => setManualSortKey("update")}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 800,
        background: manualSortKey === "update" ? "#fff" : "transparent",
        boxShadow: manualSortKey === "update" ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
      }}
    >
      更新日
    </button>
  </div>

  {/* 昇順/降順 */}
  <button
    type="button"
    onClick={() => setManualSortOrder((p) => (p === "desc" ? "asc" : "desc"))}
    style={{
      padding: "6px 10px",
      borderRadius: 10,
      border: "1px solid #e2e8f0",
      background: "#fff",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 800,
    }}
    title="昇順 / 降順"
  >
    {manualSortOrder === "desc" ? "↓" : "↑"}
  </button>
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
        manuals={pagedManuals.map((m) => ({
          ...m,
          // ✅ 表示用だけ JST 文字列にする（ソートは pagedManuals 作成前にやる前提）
          startDate: formatToJST(m.startDate),
          updatedAt: formatToJST(m.updatedAt),
          viewScope: normalizeManualViewScope(m.viewScope),
        }))}
      />

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

  <div
    className="kb-contact-list-wrapper"
    style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
  >
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


      {/* 問い合わせモーダル */}
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
              問い合わせ先を選択してください
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* 管理画面で登録された部署（depts）をループ表示 */}
              {depts.map((d) => (
                <button
                  key={d.deptId}
                  className="kb-secondary-btn"
                  // ✅ ここで上で定義した handleInquirySubmit を呼び出す
                  onClick={() => handleInquirySubmit(d.mailingList, d.name)}
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    cursor: "pointer"
                  }}
                >
                  {d.name}
                </button>
              ))}
              
              {depts.length === 0 && (
                <div style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', padding: '20px' }}>
                  問い合わせ先（部署）が登録されていません。
                </div>
              )}
            </div>

            <button
              className="kb-logout-btn"
              style={{ marginTop: 20, width: "100%", padding: "10px", cursor: "pointer" }}
              onClick={() => setIsInquiryModalOpen(false)}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* マニュアルプレビュー（使っているなら残す） */}
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
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 999,
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
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2, color: "#f9fafb" }}>
                    {previewManual.title}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.9 }}>
                    {previewManual.brandId && (brandMap[previewManual.brandId]?.name || previewManual.brand || "ブランド未設定")}
                    {previewManual.bizId && ` / ${deptMap[previewManual.bizId]?.name || previewManual.biz || "部署未設定"}`}
                    {previewManual.updatedAt && ` / 更新日: ${formatToJST(previewManual.updatedAt)}`}
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
                    onClick={() => window.open(previewManual.embedUrl!, "_blank")}
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

            <div style={{ display: "flex", flexDirection: "column", padding: 16, gap: 12, background: "#f9fafb", flex: 1, minHeight: 0 }}>
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

              {(() => {
                const embedSrc = getEmbedSrc(previewManual.embedUrl);
                if (!embedSrc)
                  return (
                    <div style={{ fontSize: 13, color: "#6b7280", padding: 12, borderRadius: 10, background: "#e5e7eb" }}>
                      プレビューURLがありません。
                    </div>
                  );

                return (
                  <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
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
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                        allowFullScreen
                        loading="lazy"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 管理画面NGモーダル */}
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
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                background: "#0f172a",
                color: "#fff",
                border: "none",
                cursor: "pointer",
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
