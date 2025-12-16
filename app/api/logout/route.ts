// app/api/logout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();

  cookieStore.delete("kb_user");
  cookieStore.delete("kb_admin");

  return NextResponse.json({ ok: true });
}
