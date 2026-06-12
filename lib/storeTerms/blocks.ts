// lib/storeTerms/blocks.ts

let counter = 0;
export function newId(): string {
  counter += 1;
  return `id${Date.now().toString(36)}${counter}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 入力された自由テキストを HTML 化する。
// すでに <タグ> を含んでいればそのまま返す。
// 含まなければプレーンテキストとして空行段落 + 改行 <br/> に変換する。
export function contentToHtml(input: string): string {
  if (!input) return "";
  const hasHtmlTag = /<\s*[a-zA-Z][^>]*>/.test(input);
  if (hasHtmlTag) return input;

  // 空行で段落を分割
  const paragraphs = input.split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      const escaped = escapeHtml(p).replace(/\n/g, "<br/>");
      return `<p>${escaped}</p>`;
    })
    .join("\n");
}

export function contentToFullHtml(title: string, content: string): string {
  const body = contentToHtml(content);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; font-size: 14px; line-height: 1.8; color: #333; max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 18px; margin-top: 24px; }
    h3 { font-size: 15px; margin-top: 18px; }
    p { margin: 10px 0; }
    ul, ol { padding-left: 24px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}
