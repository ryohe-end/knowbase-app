// lib/termsPdf.ts
// 規約の各バリアント本文(HTML/テキスト)から PDF を生成し、公開 S3 バケットへ保存する。
// 保存先は公開PDFと同じ houjin-manual バケット。生成した公開URLは規約バージョンの
// pdfUrlByVariant に格納され、公開API /api/public/terms がそのまま返す。
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { contentToHtml } from "@/lib/storeTerms/blocks";
import type { StoreTerm, TermVersion } from "@/types/storeTerms";
import { DEFAULT_VARIANT_KEY } from "@/types/storeTerms";

const S3_BUCKET = process.env.PUBLIC_PDF_BUCKET || "houjin-manual";
const S3_REGION = process.env.PUBLIC_PDF_REGION || "us-east-2";

const s3 = new S3Client({ region: S3_REGION });

function publicUrlFor(key: string): string {
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${encodeURI(key)}`;
}

// PDF 埋め込み用のフル HTML。generate-pdf ルートと同じA4向けスタイルに揃える。
function fullHtml(title: string, content: string): string {
  const body = contentToHtml(content);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; font-size: 14px; line-height: 1.8; color: #333; padding: 0; margin: 0; }
    h1 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 16px; }
    h2 { font-size: 16px; margin-top: 24px; }
    p { margin: 8px 0; }
    ul, ol { padding-left: 24px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  ${title ? `<h1>${title}</h1>` : ""}
  ${body}
</body>
</html>`;
}

async function renderPdf(html: string): Promise<Buffer> {
  const htmlPdf = await import("html-pdf-node");
  const options = {
    format: "A4" as const,
    margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
  };
  return (await htmlPdf.default.generatePdf({ content: html }, options)) as unknown as Buffer;
}

// S3 キーにファイル名として使えない文字を除去する。
function safeSegment(s: string): string {
  return String(s || "").replace(/[/\\?*:|"<>#%\s]+/g, "_").slice(0, 80) || "_";
}

// 指定バージョンの各バリアントの PDF を生成して S3 に保存し、pdfUrlByVariant を返す。
// 本文が空のバリアントはスキップ。個別バリアントの失敗は握りつぶし、生成できた分だけ返す。
export async function generateVersionPdfs(
  term: Pick<StoreTerm, "termId" | "baseTitle" | "variants">,
  version: TermVersion
): Promise<Record<string, string>> {
  const variantKeys =
    Array.isArray(term.variants) && term.variants.length > 0 ? term.variants : [DEFAULT_VARIANT_KEY];
  const out: Record<string, string> = {};
  for (const variant of variantKeys) {
    const content = version.contentByVariant?.[variant] ?? "";
    if (!content.trim()) continue;
    const titleSuffix = variant && variant !== DEFAULT_VARIANT_KEY ? ` (${variant})` : "";
    try {
      const pdf = await renderPdf(fullHtml(`${term.baseTitle}${titleSuffix}`, content));
      const key = `terms/${safeSegment(term.termId)}/${safeSegment(version.id)}/${safeSegment(variant)}.pdf`;
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: pdf,
          ContentType: "application/pdf",
        })
      );
      out[variant] = publicUrlFor(key);
    } catch (e) {
      console.error(`[termsPdf] generate/upload failed (term=${term.termId}, variant=${variant})`, e);
    }
  }
  return out;
}
