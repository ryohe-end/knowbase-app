import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const path = req.nextUrl.pathname;

  // ✅ API は middleware で触らない（307 /login の元凶を潰す）
  if (path.startsWith("/api")) {
    return NextResponse.next();
  }

  // Cookie
  const user = req.cookies.get("kb_user")?.value;
  const isAdmin = req.cookies.get("kb_admin")?.value === "1";

  // ✅ ログイン不要ページ（APIは上で除外済み）
  const publicPaths = ["/login"];

  if (publicPaths.includes(path)) {
    return NextResponse.next();
  }

  // 未ログイン → /login へ
  if (!user) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // /admin は admin のみ
  if (path.startsWith("/admin") && !isAdmin) {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
