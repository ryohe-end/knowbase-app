// app/api/me/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();

  const email = cookieStore.get("kb_user")?.value || null;
  const isAdmin = cookieStore.get("kb_admin")?.value === "1";

  return NextResponse.json({
    ok: true,
    email,
    isAdmin,
  });
}
