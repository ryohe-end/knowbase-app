"use client";

import { useState, useEffect } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth as firebaseAuth } from "@/lib/firebaseClient";
import { useRouter } from 'next/navigation';
import Link from "next/link"; // 追加

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false); 
  
  const router = useRouter();

  // 24時間経過チェック
  useEffect(() => {
    const loginTime = localStorage.getItem("kb_login_time");
    if (loginTime) {
      const now = new Date().getTime();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      if (now - parseInt(loginTime) > twentyFourHours) {
        localStorage.removeItem("kb_login_time");
        document.cookie = "kb_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = "kb_admin=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      }
    }
  }, []);

  /**
   * クッキー設定ヘルパー
   */
  const setAuthSession = (emailValue: string, isAdmin: boolean) => {
    document.cookie = `kb_user=${emailValue}; path=/; samesite=lax; secure`;
    if (isAdmin) {
      document.cookie = `kb_admin=1; path=/; samesite=lax; secure`;
    }
    localStorage.setItem("kb_login_time", new Date().getTime().toString());
  };

  async function handleSkipLogin() {
    setIsSkipping(true);
    setError("");
    setAuthSession("admin@example.com", true);
    router.push('/');
  }

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
        setAuthSession(json.user.email, json.user.role === "admin");
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
        setAuthSession(json.user.email, json.user.role === "admin");
        router.push("/");
      } else {
        setError(json.error || "このメールアドレスでのログインは許可されていません。");
        setIsLoading(false);
      }
    } catch (e: any) {
      console.error("Google login error:", e);
      setIsLoading(false);
      setError("Googleログイン中にエラーが発生しました。");
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
              style={{ cursor: 'pointer', width: '16px', height: '16px' }}
            />
            <label htmlFor="remember" style={{ fontSize: '13px', color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
              パスワードを保存する
            </label>
          </div>

          {error && <div className="kb-login-error" style={{ marginBottom: '15px', color: '#ef4444', fontSize: '13px' }}>{error}</div>}

          <button 
            type="submit" 
            className="kb-login-primary" 
            disabled={isLoading || isSkipping}
            style={{ opacity: (isLoading || isSkipping) ? 0.7 : 1 }}
          >
            {isLoading ? "認証中..." : "ログイン"}
          </button>

          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <Link 
              href="/login/forgot-password" 
              style={{ 
                fontSize: '13px', 
                color: '#3b82f6', 
                textDecoration: 'none',
                display: 'inline-block' // クリック範囲を安定させるため
              }}
              className="hover-underline-link" // CSSファイルがあるならそちらでhoverを制御するのが理想
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
            >
              パスワードをお忘れの方はこちら
            </Link>
          </div>
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

        <div className="kb-login-skip-wrapper" style={{ display: 'none' }}>
          <div className="kb-login-divider" style={{ margin: '20px 0 10px' }}>開発用</div>
          <button 
            type="button" 
            className="kb-login-skip"
            onClick={handleSkipLogin} 
            disabled={isSkipping}
            style={{ 
              backgroundColor: '#f8fafc', 
              color: '#64748b', 
              border: '1px dashed #cbd5e1',
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {isSkipping ? "移動中..." : "ログインをスキップして進む"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;