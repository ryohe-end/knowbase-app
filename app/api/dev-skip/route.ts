// app/api/dev-skip/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeAdminCookiePayload, signValue } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 本番環境での dev-skip は絶対に許可しない
  const nodeEnv: string = process.env.NODE_ENV ?? "";
  if (nodeEnv === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const ADMIN_EMAIL_FALLBACK =
    process.env.ADMIN_EMAIL_FALLBACK || "admin@example.com";
  const maxAge = 60 * 60 * 24 * 7;

  const cookieStore = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };

  cookieStore.set("kb_user", await signValue(ADMIN_EMAIL_FALLBACK), opts);
  cookieStore.set("kb_admin", await makeAdminCookiePayload(ADMIN_EMAIL_FALLBACK), opts);

  const url = new URL("/", req.url);
  return NextResponse.redirect(url, { status: 307 });
}
