// lib/publicApiAuth.ts
// 外部システム向け公開API(/api/public/*)のAPIキー認証。
// リクエストの x-api-key ヘッダを 環境変数 KB_PUBLIC_API_KEY と照合する。
// KB_PUBLIC_API_KEY はカンマ区切りで複数キーを設定でき、外部パートナーごとの
// 個別キー発行やローテーション(新旧キーの併存)に使える。
//   例: KB_PUBLIC_API_KEY="internalKey,partnerAKey,partnerBKey"
import { NextResponse } from "next/server";

/** 認証NGなら NextResponse(エラー) を返す。OKなら null。 */
export function requirePublicApiKey(req: Request): NextResponse | null {
  const expected = (process.env.KB_PUBLIC_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (expected.length === 0) {
    return NextResponse.json({ ok: false, error: "public_api_not_configured" }, { status: 503 });
  }
  const got = (req.headers.get("x-api-key") || "").trim();
  if (!got || !expected.includes(got)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
