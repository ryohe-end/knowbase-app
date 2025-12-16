// app/login/page.tsx
"use client";

import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth as firebaseAuth } from "@/lib/firebaseClient";
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [isSkipping, setIsSkipping] = useState(false); // スキップ状態の管理
  
  const router = useRouter();


  // ★ 強制スキップボタンのハンドラ関数 (API呼び出しを削除)
  async function handleSkipLogin() {
    setIsSkipping(true); // UIを「移動中...」に設定
    setError("");
    
    // WARNING: 開発用環境に特化した、安全ではない処理です。
    // クライアント側で直接Cookieを設定し、API呼び出しをスキップします。
    
    // kb_user: ユーザー認証 (admin@example.com のメールアドレス)
    // kb_admin: 管理者フラグ
    // max-age=604800 (7日間の有効期限)
    document.cookie = "kb_user=admin@example.com; path=/; max-age=604800; secure";
    document.cookie = "kb_admin=1; path=/; max-age=604800; secure";
    
    console.log("クライアントサイドでCookieを設定し、強制リダイレクトします。");
    
    // クライアント側でリダイレクト実行
    router.push('/');
    
    // UIを元に戻す処理はリダイレクトによって不要
  }

  // 通常のメール/パスワードログイン
  async function handleLogin(e: any) {
    e.preventDefault();
    setError("");

    if (isSkipping) return; 

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, pass }),
    });

    const json = await res.json();

    if (json.ok) {
      router.push("/"); // ログイン後トップへ
    } else {
      setError(json.error || "ログインに失敗しました");
    }
  }

  // Googleログイン処理
  async function handleGoogleLogin() {
    setError("");
    if (isSkipping) return;

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(firebaseAuth, provider);
      const userEmail = result.user.email;

      if (!userEmail) {
        setError("Googleアカウントからメールアドレスを取得できませんでした。");
        return;
      }

      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });

      const json = await res.json();

      if (json.ok) {
        router.push("/");
      } else {
        setError(json.error || "このメールアドレスでのログインは許可されていません。");
      }

    } catch (e: any) {
      console.error("Google login error:", e);
      if (e.code === 'auth/popup-closed-by-user') {
        setError("ログインウィンドウが閉じられました。");
      } else {
        setError("Googleログイン中にエラーが発生しました。");
      }
    }
  }

  return (
    <div className="kb-login-root">
      <div className="kb-login-card">
        {/* ヘッダー (アイコン/ロゴ統一済み) */}
        <div className="kb-login-header-new">
          <div className="kb-login-logo-wrap">
            <img
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
              alt="KB Logo"
              style={{
                width: "48px",
                height: "48px",
                objectFit: "contain",
              }}
            />
            <img
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png"
              alt="KnowBase Text Logo"
              style={{
                height: "22px",
                objectFit: "contain",
              }}
            />
          </div>
          <div className="kb-login-title-box">
            <div className="kb-login-sub">Know Base</div>
            <div className="kb-login-title">ログイン</div>
          </div>
        </div>

        {/* フォームは通常ログイン用 */}
        <form onSubmit={handleLogin} className="kb-login-form">
          <label className="kb-login-label">
            メールアドレス
            <input
              className="kb-login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="kb-login-label">
            パスワード
            <input
              className="kb-login-input"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required
            />
          </label>

          {error && <div className="kb-login-error">{error}</div>}

          <button type="submit" className="kb-login-primary" disabled={isSkipping}>
            ログイン
          </button>
        </form>
        
        <div className="kb-login-divider">または</div>
        
        <button 
          type="button" 
          className="kb-login-google"
          onClick={handleGoogleLogin}
          disabled={isSkipping}
        >
          <img 
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/googleicon.jpg" 
            alt="Google" 
            style={{ width: 18, height: 18, objectFit: 'contain' }}
          />
          Googleでログイン
        </button>

        {/* スキップボタン */}
        <div className="kb-login-divider">または</div>
        <button 
          type="button" // ★★★ type="button" を確認 ★★★
          className="kb-login-skip"
          onClick={handleSkipLogin} // ★★★ ここでAPIを叩かないバージョンが実行されます ★★★
          disabled={isSkipping}
          style={{ 
            marginTop: '10px', 
            backgroundColor: '#f1f1f1', 
            color: '#333', 
            border: '1px solid #ddd' 
          }}
        >
          {isSkipping ? "移動中..." : "ログインをスキップして進む (開発用)"}
        </button>
        
      </div>
    </div>
  );
}