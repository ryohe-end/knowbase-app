// app/login/page.tsx
"use client";

import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth as firebaseAuth } from "@/lib/firebaseClient";
import { useRouter } from 'next/navigation';

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [rememberMe, setRememberMe] = useState(false); // パスワード保存用
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false); // ローディング状態
  const [isSkipping, setIsSkipping] = useState(false); 
  
  const router = useRouter();

  // 強制スキップボタン (検証ツールで表示させて使用)
  async function handleSkipLogin() {
    setIsSkipping(true);
    setError("");
    document.cookie = "kb_user=admin@example.com; path=/; max-age=604800; secure";
    document.cookie = "kb_admin=1; path=/; max-age=604800; secure";
    router.push('/');
  }

  // 通常ログイン
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading || isSkipping) return;

    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pass }),
      });

      const json = await res.json();

      if (json.ok) {
        router.push("/");
      } else {
        setError(json.error || "ログインに失敗しました");
        setIsLoading(false);
      }
    } catch (err) {
      setError("通信エラーが発生しました。");
      setIsLoading(false);
    }
  }

  // Googleログイン
  async function handleGoogleLogin() {
    if (isLoading || isSkipping) return;
    setError("");
    setIsLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(firebaseAuth, provider);
      const userEmail = result.user.email;

      if (!userEmail) {
        setError("Googleアカウントからメールアドレスを取得できませんでした。");
        setIsLoading(false);
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
        setIsLoading(false);
      }
    } catch (e: any) {
      console.error("Google login error:", e);
      setIsLoading(false);
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
        <div className="kb-login-header-new">
          <div className="kb-login-logo-wrap">
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
          <div className="kb-login-title-box">
            <div className="kb-login-title">ログイン</div>
          </div>
        </div>

        <form onSubmit={handleLogin} className="kb-login-form">
          <label className="kb-login-label">
            メールアドレス
            <input
              className="kb-login-input"
              type="email"
              autoComplete="username"
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
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '8px' }}>
            <input 
              type="checkbox" 
              id="remember" 
              checked={rememberMe} 
              onChange={(e) => setRememberMe(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="remember" style={{ fontSize: '13px', color: '#64748b', cursor: 'pointer' }}>
              パスワードを保存する
            </label>
          </div>

          {error && <div className="kb-login-error" style={{ marginBottom: '15px' }}>{error}</div>}

          <button 
            type="submit" 
            className="kb-login-primary" 
            disabled={isLoading || isSkipping}
          >
            {isLoading ? "認証中..." : "ログイン"}
          </button>
        </form>
        
        <div className="kb-login-divider">または</div>
        
        <button 
          type="button" 
          className="kb-login-google-new"
          onClick={handleGoogleLogin}
          disabled={isLoading || isSkipping}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            width: '100%',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #dadce0',
            backgroundColor: '#ffffff',
            color: '#3c4043',
            fontWeight: '500',
            fontSize: '14px',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          <img 
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/googleicon.jpg" 
            alt="Google" 
            style={{ width: 20, height: 20, objectFit: 'contain' }}
          />
          Google アカウントでログイン
        </button>

        {/* 開発用スキップボタン：検証ツールで display: 'none' を外すと表示されます */}
        <div className="kb-login-skip-wrapper" style={{ display: 'none' }}>
          <div className="kb-login-divider">開発用</div>
          <button 
            type="button" 
            className="kb-login-skip"
            onClick={handleSkipLogin} 
            disabled={isSkipping}
            style={{ 
              marginTop: '10px', 
              backgroundColor: '#f1f1f1', 
              color: '#333', 
              border: '1px solid #ddd',
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            {isSkipping ? "移動中..." : "ログインをスキップして進む"}
          </button>
        </div>
        
      </div>
    </div>
  );
}

export default LoginPage;