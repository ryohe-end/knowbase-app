"use client";

// 店舗設定: キャンペーン(CP)＋入会完了メール管理。店舗を選び、CP単位で件名/本文を設定。
// 外部の入会システムは campaignId を使って /api/public/enrollmentMail を叩き、SendGridで送信する。
import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StoreSelector from "@/components/StoreSelector";

type Campaign = {
  campaignId: string; clubCode: string; name: string; enabled: boolean;
  subject: string; bodyHtml: string; fromName?: string; createdAt?: string; updatedAt?: string;
};

const EMPTY = (clubCode: string): Campaign => ({
  campaignId: "", clubCode, name: "", enabled: true, fromName: "",
  subject: "【{{clubName}}】ご入会ありがとうございます",
  bodyHtml: "<p>{{name}} 様</p>\n<p>この度は {{clubName}} にご入会いただき、誠にありがとうございます。</p>\n<p>今後ともよろしくお願いいたします。</p>",
});

function CampaignsInner({ clubCode }: { clubCode: string }) {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [edit, setEdit] = useState<Campaign | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setMsg(null);
    try {
      const r = await fetch(`/api/store-settings/campaigns?clubCode=${encodeURIComponent(clubCode)}`, { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setList(d.campaigns || []); else setMsg({ ok: false, text: d.error || "取得失敗" });
    } catch { setMsg({ ok: false, text: "取得に失敗しました" }); }
  }, [clubCode]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { setMsg({ ok: false, text: "CP名を入力してください" }); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/store-settings/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...edit, clubCode }) });
      const d = await r.json();
      if (d.ok) { setMsg({ ok: true, text: "保存しました" }); setEdit(null); load(); }
      else setMsg({ ok: false, text: d.error || "保存失敗" });
    } finally { setSaving(false); }
  };
  const remove = async (c: Campaign) => {
    if (!confirm(`CP「${c.name}」を削除します。よろしいですか？`)) return;
    const r = await fetch(`/api/store-settings/campaigns?campaignId=${encodeURIComponent(c.campaignId)}`, { method: "DELETE" });
    const d = await r.json();
    if (d.ok) load(); else setMsg({ ok: false, text: d.error || "削除失敗" });
  };
  const sendTest = async () => {
    if (!edit) return;
    const email = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMsg({ ok: false, text: "テスト送信先メールが不正です" }); return; }
    setTesting(true); setMsg(null);
    try {
      const r = await fetch("/api/store-settings/campaigns", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", campaignId: edit.campaignId || undefined, clubCode, subject: edit.subject, bodyHtml: edit.bodyHtml, fromName: edit.fromName, email }) });
      const d = await r.json();
      if (d.ok && d.sent) setMsg({ ok: true, text: `テスト送信しました（${email}）` });
      else setMsg({ ok: false, text: d.error || "テスト送信失敗" });
    } finally { setTesting(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px 80px" }}>
        <Link href="/store-settings/campaigns" style={{ fontSize: 13, color: "#64748b", fontWeight: 600, textDecoration: "none" }}>← 店舗選択へ戻る</Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "10px 0 4px", color: "#0f172a" }}>キャンペーン（入会完了メール）</h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 18px" }}>
          店舗コード <b>{clubCode}</b>。CP単位で入会完了メールを設定します。外部の入会システムは各CPの <b>campaignId</b> を使って送信APIを呼びます。
        </p>

        {msg && <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 14, background: msg.ok ? "#ecfdf5" : "#fef2f2", color: msg.ok ? "#047857" : "#b91c1c", border: `1px solid ${msg.ok ? "#a7f3d0" : "#fecaca"}` }}>{msg.text}</div>}

        {!edit && (
          <>
            <button onClick={() => setEdit(EMPTY(clubCode))} style={{ padding: "10px 18px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>＋ 新規CPを作成</button>
            <div style={{ background: "#fff", border: "1px solid #e5e8ee", borderRadius: 14, overflow: "hidden" }}>
              {list === null ? <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>
                : list.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>まだCPがありません。</div>
                : list.map((c) => (
                  <div key={c.campaignId} style={{ borderTop: "1px solid #f1f5f9", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{c.name} {c.enabled ? "" : <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 700 }}>（無効）</span>}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>件名: {c.subject}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>campaignId: <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>{c.campaignId}</code></div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setEdit(c)} style={{ padding: "7px 14px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: "#334155", cursor: "pointer" }}>編集</button>
                      <button onClick={() => remove(c)} style={{ padding: "7px 14px", background: "#fff", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: "#dc2626", cursor: "pointer" }}>削除</button>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}

        {edit && (
          <div style={{ background: "#fff", border: "1px solid #e5e8ee", borderRadius: 14, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{edit.campaignId ? "CPを編集" : "新規CP"}</h2>
              <button onClick={() => { setEdit(null); setMsg(null); }} style={{ background: "none", border: "none", color: "#64748b", fontSize: 13, cursor: "pointer" }}>× 一覧へ</button>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <label style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>CP名（管理用）</span>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={inp} placeholder="例：2026春の入会キャンペーン" />
              </label>
              <label style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>差出人名</span>
                <input value={edit.fromName || ""} onChange={(e) => setEdit({ ...edit, fromName: e.target.value })} style={inp} placeholder="例：JOYFIT○○店 運営事務局" />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#475569", fontWeight: 700, paddingTop: 22 }}>
                <input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> 有効
              </label>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>件名</span>
              <input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} style={inp} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>本文（HTML）</span>
              <textarea value={edit.bodyHtml} onChange={(e) => setEdit({ ...edit, bodyHtml: e.target.value })} rows={10} style={{ ...inp, fontFamily: "monospace", lineHeight: 1.6 }} />
            </label>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14, lineHeight: 1.7 }}>
              差し込み変数（送信APIの <code>variables</code> で渡した値に置換）：<code>{"{{name}}"}</code> 会員名 ／ <code>{"{{clubName}}"}</code> 店舗名 ／ その他 <code>{"{{任意キー}}"}</code> も利用可。
            </div>
            <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>プレビュー（{"{{name}}"}=テスト太郎, {"{{clubName}}"}=テスト店舗）</div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, background: "#fcfdfe" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>件名: {edit.subject.replace(/\{\{\s*name\s*\}\}/g, "テスト太郎").replace(/\{\{\s*clubName\s*\}\}/g, "テスト店舗")}</div>
                <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: edit.bodyHtml.replace(/\{\{\s*name\s*\}\}/g, "テスト太郎").replace(/\{\{\s*clubName\s*\}\}/g, "テスト店舗") }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={save} disabled={saving} style={{ padding: "10px 20px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "保存中…" : "保存"}</button>
              <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="テスト送信先メール" style={{ ...inp, maxWidth: 240 }} />
              <button onClick={sendTest} disabled={testing} style={{ padding: "10px 16px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#334155", cursor: "pointer" }}>{testing ? "送信中…" : "テスト送信"}</button>
            </div>
            {edit.campaignId && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 12 }}>campaignId: <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>{edit.campaignId}</code>（外部システムへ共有）</div>}
          </div>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", fontSize: 13.5, width: "100%" };

function Router() {
  const sp = useSearchParams();
  const clubCode = sp.get("clubCode");
  if (!clubCode) {
    return <StoreSelector basePath="/store-settings/campaigns" title="キャンペーン設定 - 店舗選択" backHref="/store-settings" backLabel="メニューへ戻る" />;
  }
  return <CampaignsInner clubCode={clubCode} />;
}

export default function CampaignsPage() {
  return <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f8fafc" }} />}><Router /></Suspense>;
}
