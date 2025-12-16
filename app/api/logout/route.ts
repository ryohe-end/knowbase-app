import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  cookies().delete("kb_user");
  cookies().delete("kb_admin");

  return NextResponse.json({ ok: true });
}
