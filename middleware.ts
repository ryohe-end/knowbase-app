import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const path = req.nextUrl.pathname;

  const user = req.cookies.get("kb_user")?.value;
  const isAdmin = req.cookies.get("kb_admin")?.value === "1";

  // ✅ ログイン不要ページ / API
  // - /api/amazonq は SSE や curl で叩くので、middleware で /login に飛ばさない
  // - 他にも public にしたい API があればここへ
  const publicPaths = [
    "/login",
    "/api/login",
    "/api/amazonq", // ✅ 追加
  ];

  // /api/amazonq 配下も許可したい場合（将来の拡張用）
  const publicPrefixes = [
    "/api/amazonq", // ✅ 追加
  ];

  if (publicPaths.includes(path) || publicPrefixes.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  // 未ログイン → /login へ
  if (!user) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // /admin へアクセスしたが admin 権限なし → Top へ
  if (path.startsWith("/admin") && !isAdmin) {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
