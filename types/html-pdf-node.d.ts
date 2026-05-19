declare module "html-pdf-node" {
  interface FileOptions {
    content?: string;
    url?: string;
  }
  interface PdfOptions {
    format?: "A4" | "A3" | "Letter" | "Legal";
    margin?: { top?: string; right?: string; bottom?: string; left?: string };
    landscape?: boolean;
  }
  const defaultExport: {
    generatePdf(file: FileOptions, options?: PdfOptions): Promise<Buffer>;
  };
  export default defaultExport;
}
