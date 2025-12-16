import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const email = cookies().get("kb_user")?.value || null;
  const isAdmin = cookies().get("kb_admin")?.value === "1";

  return NextResponse.json({
    email,
    isAdmin,
  });
}