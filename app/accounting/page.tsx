"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type MenuItem = { href: string; title: string; desc: string; color: string };

const MENU: MenuItem[] = [
  {
    href: "/accounting/points",
    title: "ポイント会計ダッシュボード",
    desc: "各店舗のポイント取得・使用・失効・残高を会計向けに集計し、月次推移・エリア別・CSV出力・原資取込を行います。",
    color: "#0f766e",
  },
  {
    href: "/store-settings/refund-payment/refund/finance",
    title: "返金の経理処理",
    desc: "承認済みの返金申請について、経理としての処理（確認・完了）を行います。",
    color: "#2563eb",
  },
  {
    href: "/store-settings/refund-payment/deposit/finance",
    title: "入金の経理処理",
    desc: "承認済みの入金申請について、経理としての処理（確認・完了）を行います。",
    color: "#0ea5e9",
  },
];

export default function AccountingHome() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ok" | "forbidden">("loading");
  const [name, setName] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json = await res.json();
        const u = json?.user;
        if (res.ok && u?.canViewAccounting) {
          setName(u.name || "");
          setState("ok");
        } else {
          setState("forbidden");
          setTimeout(() => router.replace("/"), 1500);
        }
      } catch {
        setState("forbidden");
        setTimeout(() => router.replace("/"), 1500);
      }
    })();
  }, [router]);

  if (state === "loading") return <div style={{ padding: 40, color: "#94a3b8" }}>読み込み中…</div>;
  if (state === "forbidden") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        <p style={{ fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>経理管理へのアクセス権がありません</p>
        <p style={{ fontSize: 13 }}>経理担当・経理権限をお持ちの方のみ閲覧できます。トップへ戻ります…</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fcfdfe" }}>
      <div style={{ height: 64, background: "rgba(255,255,255,0.9)", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: "100%", maxWidth: 1140, margin: "0 auto", padding: "0 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>経理管理</div>
          <button onClick={() => (window.location.href = "/")} style={{ background: "#fff", border: "1px solid #e2e8f0", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b", cursor: "pointer" }}>一般画面へ戻る</button>
        </div>
      </div>

      <main style={{ maxWidth: 1140, margin: "0 auto", padding: "48px 32px" }}>
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "#0f766e", background: "#f0fdfa", padding: "4px 10px", borderRadius: 4, marginBottom: 12 }}>ACCOUNTING</div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>経理管理</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>ポイント会計・返金/入金の経理処理を行います。{name && `（${name} さん）`}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 20 }}>
          {MENU.map((m) => (
            <Link key={m.href} href={m.href} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
                <div style={{ height: 5, background: m.color }} />
                <div style={{ padding: 28, flex: 1 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", margin: "0 0 10px" }}>{m.title}</h3>
                  <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, margin: 0 }}>{m.desc}</p>
                </div>
                <div style={{ padding: "14px 28px", background: "#fcfdfe", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>開く</span>
                  <span style={{ fontSize: 18, color: "#cbd5e1" }}>→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
