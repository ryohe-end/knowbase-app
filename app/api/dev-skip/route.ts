// app/api/dev-skip/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  console.log("--- [DEV-SKIP] 1. API処理開始 ---");

  const ADMIN_EMAIL_FALLBACK =
    process.env.ADMIN_EMAIL_FALLBACK || "admin@example.com";
  const maxAge = 60 * 60 * 24 * 7;

  // ✅ Next.js 15: cookies() は Promise なので await 必須
  const cookieStore = await cookies();

  cookieStore.set("kb_user", ADMIN_EMAIL_FALLBACK, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  cookieStore.set("kb_admin", "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  console.log("--- [DEV-SKIP] 2. Cookie設定完了 ---");

  const url = new URL("/", req.url);
  console.log("--- [DEV-SKIP] 3. リダイレクト応答返却 ---");

  return NextResponse.redirect(url, { status: 307 });
}
