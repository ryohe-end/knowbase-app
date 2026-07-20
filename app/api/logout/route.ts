// app/api/logout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySignedValue } from "@/lib/auth";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cookieStore = await cookies();

  // 誰がログアウトしたかを監査に残す(トレイルの終端)。cookie 破棄前に取得。
  const email = await verifySignedValue(cookieStore.get("kb_user")?.value);
  const uid = await verifySignedValue(cookieStore.get("kb_uid")?.value);
  if (email || uid) {
    void writeAudit({
      userId: email || uid || "unknown",
      action: "auth.logout",
      detail: uid ? { uid } : undefined,
      ip: clientIp(req),
      result: "ok",
    });
  }

  cookieStore.delete("kb_user");
  cookieStore.delete("kb_uid");
  cookieStore.delete("kb_admin");
  return NextResponse.json({ ok: true });
}
