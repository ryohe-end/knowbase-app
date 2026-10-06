// app/api/bi/options/route.ts — グローバルフィルタ候補(DM_クラブマスタ由来)。admin限定。
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { clubOptions } from "@/lib/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ options: await clubOptions() });
  } catch (e: any) {
    return NextResponse.json({ error: "query failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
