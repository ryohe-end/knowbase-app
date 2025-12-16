import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const path = req.nextUrl.pathname;

  const user = req.cookies.get("kb_user")?.value;
  const isAdmin = req.cookies.get("kb_admin")?.value === "1";

  // ログイン不要ページ
  const publicPaths = ["/login", "/api/login"];

  if (publicPaths.includes(path)) {
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
