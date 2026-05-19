import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { html, title } = await req.json();

    if (!html) {
      return NextResponse.json({ error: "HTML content is required" }, { status: 400 });
    }

    // Dynamic import for server-side only
    const htmlPdf = await import("html-pdf-node");

    const options = {
      format: "A4" as const,
      margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
    };

    const fullHtml = `
      <!DOCTYPE html>
      <html>
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
        ${html}
      </body>
      </html>
    `;

    const file = { content: fullHtml };
    const pdfBuffer = await htmlPdf.default.generatePdf(file, options);

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title || "terms")}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error("PDF generation error:", error);
    return NextResponse.json({ error: error.message || "PDF generation failed" }, { status: 500 });
  }
}
