"use client";

import React, { useEffect, useMemo, useState, Suspense } from "react"; // ✅ Suspense を追加
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type KbUserRole = "admin" | "editor" | "viewer";
type KbUser = {
  userId?: string;
  name: string;
  email: string;
  role: KbUserRole;
  mustChangePassword?: boolean;
};

function safeReturnTo(s: string | null) {
  if (!s) return "/";
  if (!s.startsWith("/")) return "/";
  if (s.startsWith("//")) return "/";
  return s;
}

// ✅ 1. ロジック本体を別のコンポーネントに切り出し
function PasswordPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); // ✅ これが Suspense を必要とする
  const returnTo = safeReturnTo(searchParams.get("returnTo"));

  const [me, setMe] = useState<KbUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  const [msg, setMsg] = useState<string>("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showNew2, setShowNew2] = useState(false);

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.user) {
          router.push("/login");
          return;
        }
        setMe(data.user as KbUser);
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router]);

  const mustChange = !!me?.mustChangePassword;

  const pwError = useMemo(() => {
    if (!currentPassword) return "現在のパスワードを入力してください";
    if (!newPassword) return "新しいパスワードを入力してください";
    if (newPassword.length < 8) return "新しいパスワードは8文字以上にしてください";
    if (newPassword.length > 64) return "新しいパスワードは64文字以内にしてください";
    if (newPassword !== newPassword2) return "新しいパスワード（確認）が一致しません";
    if (newPassword === currentPassword) return "新しいパスワードが現在のパスワードと同じです";
    return "";
  }, [currentPassword, newPassword, newPassword2]);

  const canSave = !loading && !saving && !!me && !pwError;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (pwError) {
      setMsg(pwError);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          // ✅ 管理者キー（合言葉）を追加
          "x-kb-admin-key": process.env.NEXT_PUBLIC_KB_ADMIN_API_KEY || ""
        },
        // ✅ ログインセッション（Cookie）をサーバーに送信する設定
        credentials: "include", 
        body: JSON.stringify({ currentPassword, newPassword, newPassword2 }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json?.error ?? "更新に失敗しました");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setNewPassword2("");
      setMsg("保存しました");

      // ユーザー情報の再取得時も同様の設定で実行
      const meRes = await fetch("/api/me", { 
        cache: "no-store",
        headers: {
          "x-kb-admin-key": process.env.NEXT_PUBLIC_KB_ADMIN_API_KEY || ""
        },
        credentials: "include"
      });
      
      const meJson = await meRes.json().catch(() => ({}));
      const nextMe = (meJson?.user ?? null) as KbUser | null;
      setMe(nextMe);

      if (nextMe && !nextMe.mustChangePassword) {
        router.replace(returnTo);
        return;
      }
      setMsg("保存はできましたが、強制フラグの解除に失敗しました。管理者に連絡してください。");
    } catch (err) {
      console.error(err);
      setMsg("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  const tone = msg === "保存しました" ? "ok" : msg ? "ng" : "none";

  return (
    <div className="kb-root">
      <div className="kb-topbar">
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: "none" }}>
          <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" alt="Logo" style={{ width: 48, height: 48, objectFit: "contain" }} />
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png" alt="LogoText" style={{ height: 22, objectFit: "contain" }} />
          </div>
        </Link>
        <div className="kb-topbar-center" style={{ fontSize: 18, fontWeight: 800 }}>パスワードの変更</div>
        <div className="kb-topbar-right">
          {!mustChange && (
            <Link href={returnTo}>
              <button className="kb-logout-btn" disabled={saving}>戻る</button>
            </Link>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "18px auto 0", padding: "0 12px" }}>
        <section className="kb-admin-card-large">
          <div className="kb-admin-head" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>セキュリティ</span>
            {mustChange && !loading && (
              <span style={{ fontSize: 12, fontWeight: 900, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.10)", color: "#92400e", whiteSpace: "nowrap" }}>
                初回ログイン：変更必須
              </span>
            )}
          </div>
          <div className="kb-admin-body" style={{ padding: 16 }}>
            {loading ? (
              <div style={{ padding: 10, color: "#6b7280" }}>読み込み中...</div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 12px", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", background: "linear-gradient(180deg, rgba(2,132,199,0.06), rgba(255,255,255,0.90))", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 14, display: "grid", placeItems: "center", fontWeight: 900, color: "#0f172a", background: "rgba(2,132,199,0.12)", border: "1px solid rgba(2,132,199,0.18)" }} aria-hidden>
                      {(me?.name ?? "?").slice(0, 1)}
                    </div>
                    <div style={{ lineHeight: 1.15 }}>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>{me?.name ?? ""}<span style={{ marginLeft: 8, fontSize: 12, fontWeight: 800, color: "rgba(15,23,42,0.55)" }}>{me?.userId ? `(${me.userId})` : ""}</span></div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(15,23,42,0.55)" }}>{me?.email ?? ""}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(15,23,42,0.10)", background: "#fff", color: "rgba(15,23,42,0.70)", whiteSpace: "nowrap" }}>
                    {me?.role === "admin" ? "管理者" : me?.role === "editor" ? "編集" : "閲覧"}
                  </div>
                </div>

                {mustChange && (
                  <div style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(245,158,11,0.25)", background: "rgba(245,158,11,0.08)", color: "#92400e", fontWeight: 900, fontSize: 13, marginBottom: 12, lineHeight: 1.55 }}>
                    セキュリティのため、初回ログイン時はパスワードの変更が必要です。
                  </div>
                )}

                <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label className="kb-admin-label full" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>現在のパスワード <span style={{ color: "#ef4444" }}>*</span></span>
                      <button type="button" onClick={() => setShowCurrent((v) => !v)} className="kb-logout-btn" style={{ padding: "6px 10px", borderRadius: 999, fontSize: 12 }} disabled={saving}>{showCurrent ? "非表示" : "表示"}</button>
                    </label>
                    <input className="kb-admin-input full" type={showCurrent ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} disabled={saving} autoComplete="current-password" placeholder="現在のパスワード" />
                  </div>
                  <div>
                    <label className="kb-admin-label full" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>新しいパスワード <span style={{ color: "#ef4444" }}>*</span></span>
                      <button type="button" onClick={() => setShowNew((v) => !v)} className="kb-logout-btn" style={{ padding: "6px 10px", borderRadius: 999, fontSize: 12 }} disabled={saving}>{showNew ? "非表示" : "表示"}</button>
                    </label>
                    <input className="kb-admin-input full" type={showNew ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={saving} autoComplete="new-password" placeholder="8文字以上（最大64文字）" />
                  </div>
                  <div>
                    <label className="kb-admin-label full" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>新しいパスワード（確認） <span style={{ color: "#ef4444" }}>*</span></span>
                      <button type="button" onClick={() => setShowNew2((v) => !v)} className="kb-logout-btn" style={{ padding: "6px 10px", borderRadius: 999, fontSize: 12 }} disabled={saving}>{showNew2 ? "非表示" : "表示"}</button>
                    </label>
                    <input className="kb-admin-input full" type={showNew2 ? "text" : "password"} value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} disabled={saving} autoComplete="new-password" placeholder="同じパスワードをもう一度" />
                  </div>
                  {!!msg && (
                    <div style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(15,23,42,0.10)", background: tone === "ok" ? "rgba(14,165,233,0.08)" : "rgba(239,68,68,0.08)", color: tone === "ok" ? "#0369a1" : "#b91c1c", fontWeight: 900, fontSize: 13, lineHeight: 1.6 }}>{msg}</div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                    {!mustChange && (
                      <Link href={returnTo}>
                        <button type="button" className="kb-logout-btn" disabled={saving}>キャンセル</button>
                      </Link>
                    )}
                    <button className="kb-primary-btn" type="submit" disabled={!canSave}>
                      {saving ? "保存中..." : mustChange ? "変更して続行" : "保存する"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ✅ 2. エクスポートするメインコンポーネントを Suspense で囲む
export default function AccountPasswordPage() {
  return (
    <Suspense fallback={
      <div className="kb-root" style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        読み込み中...
      </div>
    }>
      <PasswordPageContent />
    </Suspense>
  );
}
