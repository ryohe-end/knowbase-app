"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type KbUserRole = "admin" | "editor" | "viewer";
type KbUser = {
  userId: string;
  name: string;
  email: string;
  role: KbUserRole;
};

function normalizeName(name: string) {
  return name.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
}

export default function AccountNamePage() {
  const router = useRouter();

  const [me, setMe] = useState<KbUser | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // 初回：ログインチェック + 現在ユーザー取得
  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data?.user) {
          router.push("/login");
          return;
        }
        setMe(data.user);
        setName(data.user.name ?? "");
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router]);

  const normalized = useMemo(() => normalizeName(name), [name]);
  const canSave = !loading && !saving && !!me && normalized.length >= 1 && normalized.length <= 40;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const n = normalizeName(name);
    if (!n) {
      setMsg("名前を入力してください");
      return;
    }
    if (n.length > 40) {
      setMsg("名前は40文字以内にしてください");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/account/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json?.error ?? "更新に失敗しました");
        return;
      }
      setMe(json.user);
      setMsg("保存しました");
      // トップへ戻したいならここを有効化
      // router.push("/");
    } catch (e) {
      setMsg("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kb-root">
      <div className="kb-topbar">
        <Link
          href="/"
          style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: "none" }}
        >
          <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <img
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
              alt="Logo"
              style={{ width: 48, height: 48, objectFit: "contain" }}
            />
            <img
              src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png"
              alt="LogoText"
              style={{ height: 22, objectFit: "contain" }}
            />
          </div>
        </Link>

        <div className="kb-topbar-center" style={{ fontSize: 18, fontWeight: 800 }}>
          名前の変更
        </div>

        <div className="kb-topbar-right">
          <Link href="/">
            <button className="kb-logout-btn" disabled={saving}>
              戻る
            </button>
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "18px auto 0" }}>
        <section className="kb-admin-card-large">
          <div className="kb-admin-head">プロフィール</div>

          <div className="kb-admin-body" style={{ padding: 14 }}>
            {loading ? (
              <div style={{ padding: 10, color: "#6b7280" }}>読み込み中...</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                  <div>
                    <div className="kb-subnote" style={{ marginBottom: 6 }}>
                      メールアドレス
                    </div>
                    <div
                      style={{
                        padding: "10px 12px",
                        border: "1px solid rgba(15,23,42,0.10)",
                        borderRadius: 12,
                        background: "#fff",
                        fontWeight: 800,
                      }}
                    >
                      {me?.email ?? ""}
                    </div>
                  </div>
                  <div>
                    <div className="kb-subnote" style={{ marginBottom: 6 }}>
                      ユーザーID
                    </div>
                    <div
                      style={{
                        padding: "10px 12px",
                        border: "1px solid rgba(15,23,42,0.10)",
                        borderRadius: 12,
                        background: "#fff",
                        fontWeight: 800,
                      }}
                    >
                      {me?.userId ?? ""}
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <label className="kb-admin-label full">
                    名前 <span style={{ color: "#ef4444" }}>*</span>
                  </label>

                  <input
                    className="kb-admin-input full"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例：山内 太郎"
                    disabled={saving}
                    maxLength={60}
                    autoFocus
                  />

                  <div className="kb-subnote">
                    ※ 40文字以内（前後のスペースは自動で除去します）
                  </div>

                  {!!msg && (
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(15,23,42,0.10)",
                        background: msg === "保存しました" ? "rgba(14,165,233,0.08)" : "rgba(239,68,68,0.08)",
                        color: msg === "保存しました" ? "#0369a1" : "#b91c1c",
                        fontWeight: 800,
                        fontSize: 13,
                      }}
                    >
                      {msg}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                    <Link href="/">
                      <button type="button" className="kb-logout-btn" disabled={saving}>
                        キャンセル
                      </button>
                    </Link>

                    <button className="kb-primary-btn" type="submit" disabled={!canSave}>
                      {saving ? "保存中..." : "保存する"}
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
