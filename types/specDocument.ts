// types/specDocument.ts
// 設計業務① 仕様書・標準図ライブラリの型。
// マニュアル(yamauchi-Manuals)と同じ思想で、実体は S3、メタデータは DynamoDB。

export type SpecDocType = "仕様書" | "標準図";
export const SPEC_DOC_TYPES: SpecDocType[] = ["仕様書", "標準図"];

// 閲覧範囲(マニュアルの viewScope と同義)。ALL=全員 / DIRECT=直営+本部 / FC=FC+本部。
export type SpecViewScope = "ALL" | "DIRECT" | "FC";
export const SPEC_VIEW_SCOPES: SpecViewScope[] = ["ALL", "DIRECT", "FC"];

// ブランド。共通=ALL。
export type SpecBrand = "ALL" | "JOYFIT" | "FIT365";
export const SPEC_BRANDS: SpecBrand[] = ["ALL", "JOYFIT", "FIT365"];

// 1件の仕様書に添付される実ファイル(PDF/CAD等)。実体は S3、key で参照。
export type SpecFile = {
  name: string;          // 元ファイル名(表示用)
  key: string;           // S3 オブジェクトキー
  size: number;          // バイト
  contentType: string;   // MIME
  uploadedAt: string;    // ISO
};

export type SpecDocument = {
  specId: string;              // PK
  title: string;               // 必須
  desc?: string | null;        // 説明
  docType: SpecDocType;        // 仕様書 / 標準図
  brandId: SpecBrand;          // ALL / JOYFIT / FIT365
  viewScope: SpecViewScope;    // 閲覧範囲
  categoryId?: string | null;  // 任意のシリーズ/分類(自由文字列)
  version?: string | null;     // 版(例: "Rev.3" / "2026-08")
  tags?: string[];
  files: SpecFile[];           // 添付ファイル(複数可)
  createdBy?: string | null;   // 登録者メール
  createdAt?: string;
  updatedAt?: string;
  readCount?: number;
};
