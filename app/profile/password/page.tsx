"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  // 1. 自分の情報を取得して userId を特定する
  useEffect(() => {
    async function loadMe() {
      try {
        const res = await fetch("/api/me");
        const json = await res.json();
        if (json.userId) {
          setUserId(json.userId);
        } else {
          setError("ユーザー情報の取得に失敗しました。再ログインしてください。");
        }
      } catch (err) {
        setError("通信エラーが発生しました。");
      }
    }
    loadMe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // バリデーション
    if (newPassword !== confirmPassword) {
      setError("入力されたパスワードが一致しません。");
      return;
    }
    if (newPassword.length < 4) {
      setError("パスワードは4文字以上で入力してください。");
      return;
    }

    setIsLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "update-password",
          user: { userId }, // API側の本人確認ロジックで使用
          newPassword: newPassword,
        }),
      });

      const json = await res.json();

      if (res.ok) {
        setMessage("パスワードを正常に更新しました。");
        setNewPassword("");
        setConfirmPassword("");
        // 3秒後にトップページへ戻る
        setTimeout(() => router.push("/"), 3000);
      } else {
        setError(json.error || "パスワードの更新に失敗しました。");
      }
    } catch (err) {
      setError("サーバーとの通信に失敗しました。");
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
            <div className="kb-login-title">パスワード変更</div>
          </div>
        </div>

        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: '1.6' }}>
          新しいパスワードを設定してください。
        </p>

        <form onSubmit={handleSubmit} className="kb-login-form">
          <label className="kb-login-label">
            新しいパスワード
            <input
              className="kb-login-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={4}
              disabled={isLoading}
            />
          </label>

          <label className="kb-login-label">
            新しいパスワード（確認用）
            <input
              className="kb-login-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </label>

          {message && (
            <div style={{ 
              marginBottom: '15px', 
              color: '#10b981', 
              fontSize: '13px', 
              backgroundColor: '#f0fdf4', 
              padding: '12px', 
              borderRadius: '8px',
              border: '1px solid #dcfce7'
            }}>
              {message}
            </div>
          )}

          {error && (
            <div style={{ 
              marginBottom: '15px', 
              color: '#ef4444', 
              fontSize: '13px', 
              backgroundColor: '#fef2f2', 
              padding: '12px', 
              borderRadius: '8px',
              border: '1px solid #fee2e2'
            }}>
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="kb-login-primary" 
            disabled={isLoading || !userId}
            style={{ opacity: isLoading ? 0.7 : 1 }}
          >
            {isLoading ? "更新中..." : "パスワードを更新する"}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <Link 
            href="/" 
            style={{ fontSize: '13px', color: '#64748b', textDecoration: 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
          >
            キャンセルして戻る
          </Link>
        </div>
      </div>
    </div>
  );
}