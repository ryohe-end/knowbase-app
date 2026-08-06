// lib/publicApiAuth.ts
// 外部システム向け公開API(/api/public/*)のAPIキー認証。
// リクエストの x-api-key ヘッダを 環境変数 KB_PUBLIC_API_KEY と照合する。
import { NextResponse } from "next/server";

/** 認証NGなら NextResponse(エラー) を返す。OKなら null。 */
export function requirePublicApiKey(req: Request): NextResponse | null {
  const expected = (process.env.KB_PUBLIC_API_KEY || "").trim();
  if (!expected) {
    return NextResponse.json({ ok: false, error: "public_api_not_configured" }, { status: 503 });
  }
  const got = (req.headers.get("x-api-key") || "").trim();
  if (!got || got !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
