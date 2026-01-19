// app/api/drive/trash/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ✅ GOOGLE_SERVICE_ACCOUNT_JSON から認証情報を抽出
 */
function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  try {
    const json = JSON.parse(raw);
    if (typeof json.private_key === "string") {
      json.private_key = json.private_key.replace(/\\n/g, "\n");
    }
    return json;
  } catch (err) {
    throw new Error("Failed to parse Service Account JSON");
  }
}

export async function POST(req: Request) {
  try {
    const { fileId } = (await req.json()) as { fileId?: string };
    if (!fileId) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    }

    // ✅ コピー時と同じ認証方式に変更
    const sa = loadServiceAccount();

    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const drive = google.drive({ version: "v3", auth });

    // ✅ ゴミ箱へ移動
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Trash error:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to trash file" },
      { status: 500 }
    );
  }
}
