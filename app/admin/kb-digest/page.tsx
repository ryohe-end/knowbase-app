"use client";

// KB通信 設定 (管理者専用): 配信ON/OFF・頻度・対象・次回内容(ざっくり)・プレビュー・今すぐ配信
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SectionId = string;
type Config = {
  enabled: boolean;
  frequency: "weekly" | "biweekly" | "monthly";
  dayOfWeek: number; dayOfMonth: number; sendHour: number;
  nextDraft: string;
  targetType: "all" | "groups"; targetGroupIds: string[];
  sections: Record<SectionId, boolean>;
  updateInfo: string; staffIntroText: string; seminarVideoUrl: string;
  lastSentAt?: string; lastSubject?: string;
};
type SectionDef = { id: SectionId; label: string; kind: "auto" | "input" | "creative"; note?: string };
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

export default function KbDigestPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [sectionDefs, setSectionDefs] = useState<SectionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [genLoading, setGenLoading] = useState(false);
  const [genStage, setGenStage] = useState("");
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/admin/kb-digest", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setCfg(d.config); setGroups(d.groups || []); setSectionDefs(d.sectionDefs || []); } else setMsg({ ok: false, text: d.error || "取得失敗" }); })
      .catch(() => setMsg({ ok: false, text: "取得に失敗しました" }))
      .finally(() => setLoading(false));
  }, []);

  const patch = (p: Partial<Config>) => setCfg((c) => (c ? { ...c, ...p } : c));

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/kb-digest", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      const d = await res.json();
      if (d.ok) { setCfg(d.config); setMsg({ ok: true, text: "保存しました" }); }
      else setMsg({ ok: false, text: d.error || "保存失敗" });
    } finally { setSaving(false); }
  }, [cfg]);

  const generate = useCallback(async () => {
    if (!cfg) return;
    setGenLoading(true); setMsg(null); setPreview(null); setGenStage("生成をキューに投入…");
    try {
      const res = await fetch("/api/admin/kb-digest/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cfg }) });
      const d = await res.json();
      if (!d.ok || !d.previewId) { setMsg({ ok: false, text: d.error || `生成失敗 (HTTP ${res.status})` }); return; }
      setGenStage("AIが通信を作成中…（数十秒）");
      const pid = d.previewId;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pr = await fetch(`/api/admin/kb-digest/generate?previewId=${encodeURIComponent(pid)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
        if (pr.status === "ready" && pr.html) { setPreview({ subject: pr.subject || "KB通信", html: pr.html }); return; }
        if (pr.status === "error") { setMsg({ ok: false, text: pr.error || "生成に失敗しました" }); return; }
      }
      setMsg({ ok: false, text: "生成がタイムアウトしました。もう一度お試しください。" });
    } catch { setMsg({ ok: false, text: "生成に失敗しました" }); }
    finally { setGenLoading(false); setGenStage(""); }
  }, [cfg]);

  const sendNow = useCallback(async () => {
    if (!confirm("KB通信を対象全員に今すぐ配信します。よろしいですか？")) return;
    setSending(true); setMsg(null);
    try {
      const body = preview ? { subject: preview.subject, html: preview.html } : {};
      const res = await fetch("/api/admin/kb-digest/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (d.ok) { setMsg({ ok: true, text: "配信を開始しました。数十秒〜数分で対象者へ順次届きます。" }); setPreview(null); patch({ nextDraft: "" }); }
      else setMsg({ ok: false, text: d.error || "配信失敗" });
    } catch { setMsg({ ok: false, text: "配信に失敗しました" }); }
    finally { setSending(false); }
  }, [preview]);

  if (loading) return <div className="kd-root"><div className="kd-loading">読み込み中…</div></div>;
  if (!cfg) return <div className="kd-root"><div className="kd-err">{msg?.text || "設定を取得できませんでした"}</div></div>;

  return (
    <div className="kd-root">
      <Link href="/admin" className="kd-back">← 管理トップへ戻る</Link>
      <h1>KB通信（メールマガジン）</h1>
      <p className="kd-sub">KnowBaseの魅力を全社に届ける定期メール。内容が空ならアクセス動向からAIが自動生成し、スケジュールで自動配信します。</p>

      {msg && <div className={`kd-msg ${msg.ok ? "ok" : "ng"}`}>{msg.text}</div>}

      {/* 配信ON/OFF */}
      <div className="kd-card">
        <div className="kd-toggle-row">
          <div>
            <div className="kd-card-title">自動配信</div>
            <div className="kd-card-note">ONにすると、下のスケジュールで自動的に生成・配信されます。</div>
          </div>
          <button className={`kd-switch ${cfg.enabled ? "on" : ""}`} onClick={() => patch({ enabled: !cfg.enabled })} aria-pressed={cfg.enabled}>
            <span className="kd-knob" /><span className="kd-switch-label">{cfg.enabled ? "ON" : "OFF"}</span>
          </button>
        </div>
      </div>

      {/* スケジュール */}
      <div className="kd-card">
        <div className="kd-card-title">配信スケジュール</div>
        <div className="kd-row">
          <label>頻度
            <select value={cfg.frequency} onChange={(e) => patch({ frequency: e.target.value as any })}>
              <option value="weekly">毎週</option><option value="biweekly">隔週</option><option value="monthly">毎月</option>
            </select>
          </label>
          {cfg.frequency === "monthly" ? (
            <label>毎月<select value={cfg.dayOfMonth} onChange={(e) => patch({ dayOfMonth: Number(e.target.value) })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}日</option>)}
            </select></label>
          ) : (
            <label>曜日<select value={cfg.dayOfWeek} onChange={(e) => patch({ dayOfWeek: Number(e.target.value) })}>
              {DOW.map((d, i) => <option key={i} value={i}>{d}曜</option>)}
            </select></label>
          )}
          <label>時刻(JST)<select value={cfg.sendHour} onChange={(e) => patch({ sendHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select></label>
        </div>
      </div>

      {/* 配信対象 */}
      <div className="kd-card">
        <div className="kd-card-title">配信対象</div>
        <div className="kd-radio-row">
          <label className={cfg.targetType === "all" ? "on" : ""}><input type="radio" checked={cfg.targetType === "all"} onChange={() => patch({ targetType: "all" })} /> 全員</label>
          <label className={cfg.targetType === "groups" ? "on" : ""}><input type="radio" checked={cfg.targetType === "groups"} onChange={() => patch({ targetType: "groups" })} /> グループを指定</label>
        </div>
        {cfg.targetType === "groups" && (
          <div className="kd-groups">
            {groups.length === 0 && <span className="kd-card-note">選択できるグループがありません。</span>}
            {groups.map((g) => {
              const on = cfg.targetGroupIds.includes(g.id);
              return (
                <label key={g.id} className={`kd-chip ${on ? "on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => patch({ targetGroupIds: on ? cfg.targetGroupIds.filter((x) => x !== g.id) : [...cfg.targetGroupIds, g.id] })} />
                  {g.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 掲載セクション (小出し) */}
      <div className="kd-card">
        <div className="kd-card-title">掲載する内容（小出しでトグル）</div>
        <div className="kd-card-note">ONにしたものだけ載ります。データ系(検索ワード/新着/使われ方)は自動、川柳・占い・小ネタはAIがユーモラスに生成します。</div>
        <div className="kd-sections">
          {sectionDefs.map((s) => {
            const on = !!cfg.sections?.[s.id];
            return (
              <label key={s.id} className={`kd-sec ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => patch({ sections: { ...cfg.sections, [s.id]: !on } })} />
                <span className="kd-sec-label">{s.label}</span>
                {s.note && <span className="kd-sec-note">{s.note}</span>}
              </label>
            );
          })}
        </div>
        {/* 手入力が要るセクションの入力欄 */}
        {cfg.sections?.seminarVideo && (
          <div className="kd-field">
            <label>説明会動画URL <span className="kd-req">毎回必須</span></label>
            <input className="kd-input" value={cfg.seminarVideoUrl} onChange={(e) => patch({ seminarVideoUrl: e.target.value })} placeholder="https://（YouTube / Drive など）" />
          </div>
        )}
        {cfg.sections?.update && (
          <div className="kd-field">
            <label>アップデート情報（任意）</label>
            <textarea className="kd-textarea" rows={2} value={cfg.updateInfo} onChange={(e) => patch({ updateInfo: e.target.value })} placeholder="新機能・変更点など。空欄なら動向からおまかせ" />
          </div>
        )}
        {cfg.sections?.staffIntro && (
          <div className="kd-field">
            <label>部署紹介（担当業務など）</label>
            <textarea className="kd-textarea" rows={2} value={cfg.staffIntroText} onChange={(e) => patch({ staffIntroText: e.target.value })} placeholder="例：システム管理部／KnowBaseや各種システムの運用・改善を担当。困ったら相談してください" />
          </div>
        )}
        <div className="kd-card-note" style={{ marginTop: 10 }}>※ 川柳・占い・おもしろニュースは「お楽しみ枠」。ONにしても<b>毎回どれか1つ</b>だけ自動ローテーションで掲載します。</div>
      </div>

      {/* 次回の内容 */}
      <div className="kd-card">
        <div className="kd-card-title">全体の主旨・メモ（ざっくり・任意）</div>
        <div className="kd-card-note">箇条書きでOK。空欄ならアクセス動向からAIが自動で組み立てます。文章はユーモアを効かせて仕上げます。</div>
        <textarea className="kd-textarea" rows={5} value={cfg.nextDraft} onChange={(e) => patch({ nextDraft: e.target.value })}
          placeholder={"例：\n・新しい入会マニュアルが出た\n・Knowbieに「休会」と聞くと手順が出るよ、を推したい"} />
      </div>

      <div className="kd-actions">
        <button className="kd-btn" onClick={save} disabled={saving}>{saving ? "保存中…" : "設定を保存"}</button>
        <button className="kd-btn" onClick={generate} disabled={genLoading}>{genLoading ? (genStage || "生成中…") : "プレビュー生成"}</button>
        <button className="kd-btn primary" onClick={sendNow} disabled={sending}>{sending ? "配信中…" : "今すぐ配信"}</button>
      </div>

      {cfg.lastSentAt && <div className="kd-last">最終配信: {new Date(cfg.lastSentAt).toLocaleString("ja-JP")} ／ {cfg.lastSubject || ""}</div>}

      {preview && (
        <div className="kd-preview">
          <div className="kd-preview-head">プレビュー ／ 件名: <b>{preview.subject}</b></div>
          <iframe className="kd-preview-frame" title="preview" srcDoc={preview.html} />
        </div>
      )}

      <style jsx>{`
        .kd-root { max-width: 860px; margin: 0 auto; padding: 28px 24px 90px; font-family: -apple-system, "Hiragino Sans", sans-serif; color: #0f172a; }
        .kd-back { font-size: 13px; color: #64748b; font-weight: 600; text-decoration: none; }
        h1 { font-size: 22px; font-weight: 800; margin: 10px 0 4px; }
        .kd-sub { color: #64748b; font-size: 13px; margin: 0 0 20px; line-height: 1.7; }
        .kd-msg { padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
        .kd-msg.ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
        .kd-msg.ng { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
        .kd-card { background: #fff; border: 1px solid #e5e8ee; border-radius: 14px; padding: 18px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
        .kd-card-title { font-size: 14px; font-weight: 800; color: #1e293b; }
        .kd-card-note { font-size: 12px; color: #94a3b8; margin-top: 3px; }
        .kd-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .kd-switch { display: inline-flex; align-items: center; gap: 8px; border: none; background: #e2e8f0; border-radius: 999px; padding: 4px; width: 74px; cursor: pointer; position: relative; height: 30px; transition: .18s; }
        .kd-switch.on { background: #4f46e5; }
        .kd-knob { width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: .18s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
        .kd-switch.on .kd-knob { transform: translateX(44px); }
        .kd-switch-label { position: absolute; left: 12px; font-size: 11px; font-weight: 800; color: #fff; }
        .kd-switch:not(.on) .kd-switch-label { left: auto; right: 12px; color: #64748b; }
        .kd-row { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
        .kd-row label, .kd-radio-row label { font-size: 12px; font-weight: 600; color: #475569; display: flex; flex-direction: column; gap: 5px; }
        .kd-row select { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
        .kd-radio-row { display: flex; gap: 18px; margin-top: 10px; }
        .kd-radio-row label { flex-direction: row; align-items: center; gap: 6px; cursor: pointer; }
        .kd-groups { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .kd-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #e2e8f0; border-radius: 999px; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .kd-chip.on { border-color: #4f46e5; background: #eef2ff; color: #4338ca; }
        .kd-sections { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; margin-top: 12px; }
        .kd-sec { display: flex; align-items: center; gap: 8px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 9px 12px; cursor: pointer; font-size: 13px; }
        .kd-sec.on { border-color: #8b5cf6; background: #f5f3ff; }
        .kd-sec input { accent-color: #7c3aed; }
        .kd-sec-label { font-weight: 700; color: #334155; }
        .kd-sec-note { font-size: 11px; color: #94a3b8; margin-left: auto; }
        .kd-field { margin-top: 12px; }
        .kd-field > label { font-size: 12px; font-weight: 700; color: #475569; display: block; margin-bottom: 5px; }
        .kd-req { color: #dc2626; font-size: 11px; margin-left: 6px; }
        .kd-input { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 13px; }
        .kd-input:focus { outline: none; border-color: #6366f1; }
        .kd-textarea { width: 100%; margin-top: 10px; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 12px; font-size: 13.5px; font-family: inherit; line-height: 1.7; resize: vertical; }
        .kd-textarea:focus { outline: none; border-color: #6366f1; }
        .kd-actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 6px; }
        .kd-btn { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 10px; padding: 10px 18px; font-size: 13.5px; font-weight: 700; cursor: pointer; }
        .kd-btn.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
        .kd-btn:disabled { opacity: .55; cursor: default; }
        .kd-last { font-size: 12px; color: #94a3b8; margin: 4px 0 12px; }
        .kd-preview { margin-top: 14px; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
        .kd-preview-head { padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #475569; }
        .kd-preview-frame { width: 100%; height: 620px; border: none; background: #fff; }
        .kd-loading, .kd-err { padding: 60px; text-align: center; color: #94a3b8; }
      `}</style>
    </div>
  );
}
