"use client";

import { useState } from "react";

export default function KnowbieCard() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);

  async function handleAsk() {
    if (!prompt.trim()) return;

    setLoadingAI(true);
    setResponse("");

    try {
      const res = await fetch("/api/amazonq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const json = await res.json();

      if (json.answer) {
        setResponse(json.answer);
      } else {
        setResponse("Amazon Q からの応答取得に失敗しました。");
      }
    } catch (e) {
      console.error(e);
      setResponse("Amazon Q 通信エラー");
    } finally {
      setLoadingAI(false);
    }
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

        <div className="kb-chat-body" style={{ padding: 10 }}>
          {!response && !loadingAI && (
            <span className="kb-subnote">
              質問を入力するとここに回答が表示されます。
              <br />
              例：「入会手続きの流れを教えて」「Canvaでテロップを作りたい」
            </span>
          )}

          {loadingAI && <span className="kb-subnote">Thinking...</span>}

          {response && !loadingAI && (
            <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
              {response}
            </div>
          )}
        </div>

        <div className="kb-chat-input-row">
          <input
            className="kb-chat-input"
            placeholder="Knowbie に質問する..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            className="kb-chat-send"
            onClick={handleAsk}
            disabled={loadingAI}
          >
            送信
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
  );
}
