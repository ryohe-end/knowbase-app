"use client";

import { useEffect, useRef, useState } from "react";

type Source = {
  title?: string;
  url?: string;
  excerpt?: string;
};

export default function KnowbieCard() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [loadingAI, setLoadingAI] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function extractSseData(eventBlock: string) {
    const lines = eventBlock.split("\n");
    const dataLines = lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.replace(/^data:\s?/, ""));
    return dataLines.join("\n");
  }

  function extractSseEventName(eventBlock: string) {
    const line = eventBlock.split("\n").find((l) => l.startsWith("event:"));
    return line ? line.replace(/^event:\s?/, "").trim() : "";
  }

  async function handleAsk() {
    if (!prompt.trim() || loadingAI) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoadingAI(true);
    setResponse("");
    setSources([]);

    try {
      const res = await fetch("/api/amazonq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: ac.signal,
      });

      // ここは純粋にHTTPエラーだけ弾く
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

      // ✅ SSE の場合：ストリームで読む
      if (contentType.includes("text/event-stream")) {
        // ※環境によって res.body が null になることがあるので、nullならフォールバック
        if (!res.body) {
          const all = await res.text().catch(() => "");
          const blocks = all.split("\n\n");

          for (const b of blocks) {
            const ev = extractSseEventName(b);
            const data = extractSseData(b);

            if (ev === "error" && data) {
              try {
                const j = JSON.parse(data);
                throw new Error(j.error || JSON.stringify(j));
              } catch {
                throw new Error(data);
              }
            }

            if (ev === "done" || data === "[DONE]") break;
            if (data) setResponse((p) => p + data);
          }

          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE は \n\n 区切り
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const eventName = extractSseEventName(part);
            const data = extractSseData(part);

            if (eventName === "done" || data === "[DONE]") return;

            if (eventName === "error") {
              try {
                const j = JSON.parse(data);
                throw new Error(j.error || JSON.stringify(j));
              } catch {
                throw new Error(data || "unknown stream error");
              }
            }

            if (!data) continue;
            setResponse((prev) => prev + data);
          }
        }

        return;
      }

      // ✅ SSEじゃない場合：JSON を優先で読む（あなたのAPIはこれ）
      if (contentType.includes("application/json")) {
        const j = await res.json().catch(() => null);

        if (j && typeof j === "object") {
          if (j.ok === false) throw new Error(j.error || j.detail || "Unknown error");
          // APIの形：{ ok: true, text, sources, conversationId }
          if (typeof j.text === "string") setResponse(j.text);
          else setResponse(JSON.stringify(j, null, 2));

          if (Array.isArray(j.sources)) setSources(j.sources);
          else setSources([]);

          return;
        }
      }

      // ✅ JSONじゃない場合：text で読む（保険）
      const text = await res.text().catch(() => "");
      // もしJSONっぽかったらエラー拾う
      try {
        const j = JSON.parse(text);
        if (j?.error) throw new Error(j.error);
        if (typeof j?.text === "string") setResponse(j.text);
        else setResponse(JSON.stringify(j, null, 2));
        if (Array.isArray(j?.sources)) setSources(j.sources);
      } catch {
        setResponse(text);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error("Chat error:", e);
      setResponse(`[エラー] ${e.message}`);
    } finally {
      setLoadingAI(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setLoadingAI(false);
  }

  return (
    <div className="kb-card">
      <div className="kb-card-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="kb-avatar">
            <span className="kb-avatar-face">K</span>
          </div>
          <div>
            <div className="kb-card-title">Knowbie（ノウビー）</div>
            <div className="kb-card-subtitle">
              社内マニュアル／手順の質問に回答します（Amazon Q）
            </div>
          </div>
        </div>
        <div className="kb-subnote">※ マニュアルをもとに回答します</div>
      </div>

      <div className="kb-chat-box">
        <div className="kb-chat-header">💬 チャット</div>

        <div className="kb-chat-body" style={{ padding: 10, minHeight: "100px" }}>
          {!response && !loadingAI && (
            <span className="kb-subnote">質問を入力してください。</span>
          )}

          {/* ✅ ChatGPT風「…」バブル */}
          {loadingAI && !response && (
            <div className="kb-typing" aria-label="AI typing">
              <span className="kb-dot" />
              <span className="kb-dot" />
              <span className="kb-dot" />
            </div>
          )}

          {(response || loadingAI) && (
            <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: "1.6" }}>
              {response}
              {loadingAI && response && <span className="kb-cursor">|</span>}
            </div>
          )}

          {/* ✅ ソース表示（APIが返している sources をそのまま出す） */}
          {sources.length > 0 && (
            <div className="kb-sources">
              <div className="kb-sources-title">参照ソース</div>
              <ul className="kb-sources-list">
                {sources.map((s, i) => (
                  <li className="kb-source-item" key={`${s.url ?? s.title ?? "src"}-${i}`}>
                    <div className="kb-source-title">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title ?? s.url}
                        </a>
                      ) : (
                        <span>{s.title ?? "source"}</span>
                      )}
                    </div>
                    {s.excerpt && <div className="kb-source-excerpt">{s.excerpt}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="kb-chat-input-row">
          <input
            className="kb-chat-input"
            placeholder="Knowbie に質問する..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
            disabled={loadingAI}
          />

          <button
            className="kb-chat-send"
            onClick={handleAsk}
            disabled={loadingAI || !prompt.trim()}
          >
            {loadingAI ? "..." : "送信"}
          </button>

          {loadingAI && (
            <button className="kb-chat-stop" onClick={handleStop} title="停止">
              停止
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .kb-cursor {
          display: inline-block;
          margin-left: 4px;
          animation: blink 1s step-end infinite;
        }
        @keyframes blink {
          from,
          to {
            opacity: 1;
          }
          50% {
            opacity: 0;
          }
        }

        .kb-typing {
          display: inline-flex;
          gap: 6px;
          align-items: center;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.05);
        }
        .kb-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.55);
          animation: kb-bounce 1.2s infinite ease-in-out;
        }
        .kb-dot:nth-child(2) {
          animation-delay: 0.15s;
        }
        .kb-dot:nth-child(3) {
          animation-delay: 0.3s;
        }
        @keyframes kb-bounce {
          0%,
          80%,
          100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          40% {
            transform: translateY(-4px);
            opacity: 1;
          }
        }

        .kb-chat-stop {
          margin-left: 8px;
          padding: 0 10px;
          border-radius: 10px;
          font-size: 12px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: rgba(0, 0, 0, 0.04);
        }

        /* ✅ sources UI */
        .kb-sources {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          background: rgba(0, 0, 0, 0.03);
        }
        .kb-sources-title {
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 8px;
          opacity: 0.85;
        }
        .kb-sources-list {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .kb-source-item {
          line-height: 1.45;
        }
        .kb-source-title a {
          text-decoration: underline;
        }
        .kb-source-excerpt {
          margin-top: 6px;
          font-size: 12px;
          opacity: 0.8;
          white-space: pre-wrap;
          word-break: break-word;
        }
      `}</style>
    </div>
  );
}
