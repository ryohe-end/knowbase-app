// types/publicPdf.ts
// S3 houjin-manual バケットに配置した外部公開 PDF のメタデータ。
// DynamoDB: yamauchi-PublicPdfs (PK: pdfId)

export type PublicPdf = {
  pdfId: string;            // UUID 由来
  s3Key: string;            // external-share/<pdfId>/<originalName>
  s3Bucket: string;         // "houjin-manual"
  s3Region: string;         // "us-east-2"
  publicUrl: string;        // https://houjin-manual.s3.us-east-2.amazonaws.com/<s3Key>

  title: string;            // 任意の表示用タイトル (空なら originalName を使う)
  description?: string;
  originalName: string;
  contentType: string;      // "application/pdf"
  sizeBytes: number;

  status: "pending" | "ready"; // pending = init 済み未 finalize
  uploadedById: string;
  uploadedByName: string;
  uploadedByEmail: string;
  createdAt: string;        // ISO
  updatedAt: string;
};
