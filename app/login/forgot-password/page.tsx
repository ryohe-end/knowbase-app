"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setError("");
    setMessage("");

    try {
      // 既存の /api/users を「メールアドレス指定」で叩く
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "resend",
          user: { 
            userId: "", // userIdを空にする
            email: email 
          },
          resetPassword: true, // パスワードを新しく発行する
          includePassword: true, // メールにパスワードを載せる
        }),
      });

      const json = await res.json();

      if (res.ok) {
        setMessage("一時パスワードをメールで送信しました。メールボックスを確認してログインしてください。");
        // 5秒後にログイン画面へ戻す
        setTimeout(() => {
          router.push("/login");
        }, 5000);
      } else {
        setError(json.error || "送信に失敗しました。アドレスが正しいかご確認ください。");
      }
    } catch (err) {
      setError("通信エラーが発生しました。");
    } finally {
      setIsLoading(false);
    }
  };

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
            <div className="kb-login-title">パスワード再設定</div>
          </div>
        </div>

        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: '1.6' }}>
          ご登録のメールアドレスを入力してください。<br />
          新しい一時パスワードを発行し、メールでお送りします。
        </p>

        <form onSubmit={handleSubmit} className="kb-login-form">
          <label className="kb-login-label">
            メールアドレス
            <input
              className="kb-login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="example@knowbase.com"
              disabled={isLoading}
            />
          </label>

          {message && (
            <div style={{ marginBottom: '15px', color: '#10b981', fontSize: '13px', backgroundColor: '#f0fdf4', padding: '12px', borderRadius: '8px', border: '1px solid #dcfce7' }}>
              {message}
            </div>
          )}

          {error && (
            <div style={{ marginBottom: '15px', color: '#ef4444', fontSize: '13px', backgroundColor: '#fef2f2', padding: '12px', borderRadius: '8px', border: '1px solid #fee2e2' }}>
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="kb-login-primary" 
            disabled={isLoading || !email}
            style={{ opacity: isLoading ? 0.7 : 1 }}
          >
            {isLoading ? "送信中..." : "一時パスワードを発行する"}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <Link 
            href="/login" 
            style={{ fontSize: '13px', color: '#3b82f6', textDecoration: 'none' }}
          >
            ログイン画面に戻る
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;