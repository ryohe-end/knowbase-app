// lib/storeTerms/title.ts

// タイトル末尾の「(...)」「（...）」を variant 表記として除去して基本タイトルを得る
export function getBaseTitle(title: string): string {
  return title.replace(/[（(][^）)]*[）)]\s*$/u, "").trim();
}

// タイトル末尾の variant ラベルを抽出 (無ければ "")
export function getTitleVariant(title: string): string {
  const m = title.match(/[（(]([^）)]*)[）)]\s*$/u);
  return m ? m[1].trim() : "";
}

// brand + baseTitle から安定した termId を生成
// 日本語を含むので URL-safe な base64 にして 32 桁に切る
export function makeTermId(brand: string, baseTitle: string): string {
  const raw = `${brand}__${baseTitle}`;
  if (typeof window === "undefined") {
    return Buffer.from(raw, "utf-8").toString("base64url");
  }
  // ブラウザ側 (encodeURIComponent → base64-safe)
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
