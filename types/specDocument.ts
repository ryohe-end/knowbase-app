// types/specDocument.ts
// 設計業務① 仕様書・標準図ライブラリの型(版履歴付き)。
// 実体は S3、メタデータは DynamoDB。1件の仕様書が複数の「版(version)」を持つ。

export type SpecDocType = "仕様書" | "標準図";
export const SPEC_DOC_TYPES: SpecDocType[] = ["仕様書", "標準図"];

// 閲覧範囲(マニュアルの viewScope と同義)。ALL=全員 / DIRECT=直営+本部 / FC=FC+本部。
export type SpecViewScope = "ALL" | "DIRECT" | "FC";
export const SPEC_VIEW_SCOPES: SpecViewScope[] = ["ALL", "DIRECT", "FC"];

// ブランド。共通=ALL。
export type SpecBrand = "ALL" | "JOYFIT" | "FIT365";
export const SPEC_BRANDS: SpecBrand[] = ["ALL", "JOYFIT", "FIT365"];

// 版に添付される実ファイル(PDF/CAD等)。実体は S3、key で参照。
export type SpecFile = {
  name: string;          // 元ファイル名(表示用)
  key: string;           // S3 オブジェクトキー
  size: number;          // バイト
  contentType: string;   // MIME
  uploadedAt: string;    // ISO
};

// 1つの版(バージョン)。版ごとにファイル一式・版名・変更メモ・作成日を持つ。
export type SpecVersion = {
  versionId: string;         // 一意
  label?: string | null;     // 版名(例: "Rev.3" / "2026-08版")
  note?: string | null;      // 変更点/変更メモ(changelog)
  files: SpecFile[];         // この版のファイル
  createdAt: string;         // 版の作成日時 ISO
  createdBy?: string | null; // 版の登録者メール
  isCurrent: boolean;        // 現行版か(1件だけ true)
};

export type SpecDocument = {
  specId: string;              // PK
  title: string;               // 必須
  desc?: string | null;        // 説明
  docType: SpecDocType;        // 仕様書 / 標準図
  brandId: SpecBrand;          // ALL / JOYFIT / FIT365
  viewScope: SpecViewScope;    // 閲覧範囲
  categoryId?: string | null;  // 任意のシリーズ/分類(自由文字列)
  tags?: string[];
  versions: SpecVersion[];     // 版履歴(新しい順で保持しないが createdAt を持つ)
  createdBy?: string | null;   // 登録者メール(初版)
  createdAt?: string;
  updatedAt?: string;
  readCount?: number;
};

// 現行版を返す(isCurrent 優先、無ければ createdAt 最新)。
export function currentVersion(doc: Pick<SpecDocument, "versions">): SpecVersion | null {
  const vs = doc.versions || [];
  if (vs.length === 0) return null;
  return vs.find((v) => v.isCurrent) || [...vs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}

// 版を新しい順(createdAt 降順)で返す。
export function versionsNewestFirst(doc: Pick<SpecDocument, "versions">): SpecVersion[] {
  return [...(doc.versions || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
