"use client";

// components/ContentBlocksEditor.tsx
//
// お知らせ / DM 本文を「ブロック」で構成するエディタ。テキストと画像を任意の順で並べ、
// 画像は配置(左/中央/右)と幅(%)を指定できる。並べ替え(上下)・削除に対応。
// - blocksToHtml(): 配信用HTML(お知らせ content / DM bodyHtml)を生成
// - blocksToText(): プレーンテキスト(PUSHバナー本文 / 送信ガード用)を生成 (画像は除外)
import React, { useRef, useState } from "react";

export type ContentBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; url: string; align: "left" | "center" | "right"; width: number };

let _bid = 0;
const nid = () => `b${++_bid}_${Date.now().toString(36)}`;
export const newTextBlock = (text = ""): ContentBlock => ({ id: nid(), type: "text", text });
export const newImageBlock = (url: string): ContentBlock => ({ id: nid(), type: "image", url, align: "center", width: 100 });

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function attrEscape(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// 配信用HTML。text は改行を <br>、画像は div でラップして配置/幅を反映。
export function blocksToHtml(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "text") {
        const t = b.text.trim();
        return t ? `<div style="margin:0 0 12px;line-height:1.7;">${escapeHtml(b.text).replace(/\n/g, "<br>")}</div>` : "";
      }
      // 画像URLは http(s) のみ許可(javascript: 等のスキーム混入を防ぐ)。幅も数値に丸める。
      if (!/^https?:\/\//i.test(b.url)) return "";
      const justify = b.align === "left" ? "flex-start" : b.align === "right" ? "flex-end" : "center";
      const w = Math.max(10, Math.min(100, Number(b.width) || 100));
      return `<div style="display:flex;justify-content:${justify};margin:0 0 12px;"><img src="${attrEscape(b.url)}" alt="" style="max-width:${w}%;height:auto;border-radius:8px;" /></div>`;
    })
    .filter(Boolean)
    .join("\n");
}

// プレーンテキスト(画像は除外、テキストブロックを2改行で連結)
export function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export default function ContentBlocksEditor({
  value,
  onChange,
  disabled,
}: {
  value: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  disabled?: boolean;
}) {
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // ドラッグで並べ替え
  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null);
    const from = value.findIndex((b) => b.id === dragId);
    const to = value.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return setDragId(null);
    const next = [...value];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onChange(next);
    setDragId(null);
  };

  const update = (id: string, patch: Partial<ContentBlock>) =>
    onChange(value.map((b) => (b.id === id ? ({ ...b, ...patch } as ContentBlock) : b)));
  const remove = (id: string) => onChange(value.filter((b) => b.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = value.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addText = () => onChange([...value, newTextBlock("")]);
  const addImagePlaceholder = () => {
    const b = { id: nid(), type: "image" as const, url: "", align: "center" as const, width: 100 };
    onChange([...value, b]);
    // 追加直後にファイル選択を促す
    setTimeout(() => fileInputs.current[b.id]?.click(), 0);
  };

  const upload = async (id: string, file: File | null) => {
    if (!file) return;
    setErr("");
    if (!ALLOWED.includes(file.type)) { setErr("PNG / JPEG / WebP / GIF のみアップロードできます。"); return; }
    if (file.size > 10 * 1024 * 1024) { setErr("ファイルサイズは 10MB 以内にしてください。"); return; }
    setUploadingId(id);
    try {
      const initRes = await fetch("/api/store-settings/media/upload-image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      const init = await initRes.json();
      if (!initRes.ok || !init.ok) throw new Error(init?.error || "アップロード準備に失敗しました");
      const putRes = await fetch(init.presignedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!putRes.ok) throw new Error("S3 へのアップロードに失敗しました");
      update(id, { url: init.publicUrl });
    } catch (e: any) {
      setErr(e?.message || "アップロードに失敗しました");
      // 空の画像ブロックはアップ失敗時に残さない
      if (!(value.find((b) => b.id === id) as any)?.url) remove(id);
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="cbe">
      {err && <div className="cbe-err">{err}</div>}
      <div className="cbe-list">
        {value.length === 0 && <div className="cbe-empty">「＋テキスト」「＋画像」で本文を組み立てます。画像は好きな位置に挿入できます。</div>}
        {value.map((b, i) => (
          <div key={b.id} className={`cbe-block${dragId === b.id ? " dragging" : ""}`}
            draggable={!disabled}
            onDragStart={() => setDragId(b.id)}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={() => onDrop(b.id)}
            onDragEnd={() => setDragId(null)}>
            <div className="cbe-block-head">
              <span className="cbe-block-type"><span className="cbe-grip" title="ドラッグで並べ替え">⠿</span>{b.type === "text" ? "テキスト" : "画像"}</span>
              <div className="cbe-block-tools">
                <button type="button" disabled={disabled || i === 0} onClick={() => move(b.id, -1)} title="上へ">↑</button>
                <button type="button" disabled={disabled || i === value.length - 1} onClick={() => move(b.id, 1)} title="下へ">↓</button>
                <button type="button" disabled={disabled} className="cbe-del" onClick={() => remove(b.id)} title="削除">×</button>
              </div>
            </div>
            {b.type === "text" ? (
              <textarea className="cbe-textarea" rows={3} value={b.text} disabled={disabled}
                placeholder="本文を入力" onChange={(e) => update(b.id, { text: e.target.value })} />
            ) : (
              <div className="cbe-image">
                <input ref={(el) => { fileInputs.current[b.id] = el; }} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={(e) => upload(b.id, e.target.files?.[0] ?? null)} />
                {b.url ? (
                  <div className={`cbe-image-preview align-${b.align}`}>
                    <img src={b.url} alt="" style={{ maxWidth: `${b.width}%`, cursor: "zoom-in" }} onClick={() => setZoom(b.url)} title="クリックで拡大" />
                  </div>
                ) : (
                  <button type="button" className="cbe-upload-btn" disabled={disabled || uploadingId === b.id} onClick={() => fileInputs.current[b.id]?.click()}>
                    {uploadingId === b.id ? "アップロード中…" : "画像を選択"}
                  </button>
                )}
                {b.url && (
                  <div className="cbe-image-opts">
                    <div className="cbe-opt">
                      <span>配置</span>
                      <div className="cbe-align">
                        {(["left", "center", "right"] as const).map((a) => (
                          <button type="button" key={a} className={b.align === a ? "on" : ""} disabled={disabled}
                            onClick={() => update(b.id, { align: a })}>{a === "left" ? "左" : a === "center" ? "中央" : "右"}</button>
                        ))}
                      </div>
                    </div>
                    <div className="cbe-opt">
                      <span>幅 {b.width}%</span>
                      <input type="range" min={20} max={100} step={5} value={b.width} disabled={disabled}
                        onChange={(e) => update(b.id, { width: Number(e.target.value) })} />
                    </div>
                    <button type="button" className="cbe-replace" disabled={disabled} onClick={() => fileInputs.current[b.id]?.click()}>差し替え</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="cbe-add">
        <button type="button" disabled={disabled} onClick={addText}>＋ テキスト</button>
        <button type="button" disabled={disabled} className="alt" onClick={addImagePlaceholder}>＋ 画像</button>
      </div>

      {zoom && (
        <div className="cbe-lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" onClick={(e) => e.stopPropagation()} />
          <button type="button" className="cbe-lightbox-close" onClick={() => setZoom(null)}>×</button>
        </div>
      )}

      <style jsx>{`
        .cbe-err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 8px; padding: 8px 12px; font-size: 12px; margin-bottom: 8px; }
        .cbe-empty { text-align: center; color: #94a3b8; font-size: 12px; padding: 18px; border: 1px dashed #cbd5e1; border-radius: 10px; }
        .cbe-list { display: flex; flex-direction: column; gap: 10px; }
        .cbe-block { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background: #fff; }
        .cbe-block.dragging { opacity: 0.5; border-color: #6d28d9; }
        .cbe-grip { cursor: grab; color: #cbd5e1; margin-right: 6px; font-size: 14px; letter-spacing: -2px; }
        .cbe-lightbox { position: fixed; inset: 0; background: rgba(15,23,42,0.8); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 24px; }
        .cbe-lightbox img { max-width: 92vw; max-height: 88vh; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
        .cbe-lightbox-close { position: fixed; top: 20px; right: 24px; width: 40px; height: 40px; border-radius: 50%; border: none; background: rgba(255,255,255,0.9); font-size: 22px; cursor: pointer; color: #0f172a; }
        .cbe-block-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .cbe-block-type { font-size: 11px; font-weight: 800; color: #64748b; }
        .cbe-block-tools { display: flex; gap: 4px; }
        .cbe-block-tools button { width: 26px; height: 26px; border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 6px; cursor: pointer; font-size: 13px; color: #475569; }
        .cbe-block-tools button:disabled { opacity: 0.35; cursor: not-allowed; }
        .cbe-block-tools .cbe-del { color: #b91c1c; }
        .cbe-textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 14px; line-height: 1.6; resize: vertical; box-sizing: border-box; }
        .cbe-image-preview { display: flex; }
        .cbe-image-preview.align-left { justify-content: flex-start; }
        .cbe-image-preview.align-center { justify-content: center; }
        .cbe-image-preview.align-right { justify-content: flex-end; }
        .cbe-image-preview img { height: auto; border-radius: 8px; border: 1px solid #f1f5f9; }
        .cbe-upload-btn { width: 100%; padding: 18px; border: 1px dashed #cbd5e1; border-radius: 8px; background: #f8fafc; color: #475569; font-weight: 700; font-size: 13px; cursor: pointer; }
        .cbe-image-opts { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 10px; }
        .cbe-opt { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #64748b; font-weight: 700; }
        .cbe-align { display: flex; gap: 4px; }
        .cbe-align button { padding: 4px 10px; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; font-size: 12px; cursor: pointer; color: #475569; }
        .cbe-align button.on { background: #0f172a; color: #fff; border-color: #0f172a; }
        .cbe-opt input[type="range"] { width: 120px; }
        .cbe-replace { padding: 5px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; font-size: 12px; cursor: pointer; color: #475569; font-weight: 700; }
        .cbe-add { display: flex; gap: 8px; margin-top: 10px; }
        .cbe-add button { flex: 1; padding: 9px; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; color: #334155; }
        .cbe-add button.alt { color: #6d28d9; background: #f5f3ff; border-color: #ddd6fe; }
        .cbe-add button:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
