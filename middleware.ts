import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readVerifiedSession } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const path = req.nextUrl.pathname;

  // APIは各ルートで認可する
  if (path.startsWith("/api")) {
    return NextResponse.next();
  }

  const publicPaths = ["/login", "/login/forgot-password"];
  if (publicPaths.includes(path)) {
    return NextResponse.next();
  }

  const session = await readVerifiedSession({
    get: (n) => {
      const c = req.cookies.get(n);
      return c ? { value: c.value } : undefined;
    },
  });

  if (!session) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/admin") && !session.isAdmin) {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
