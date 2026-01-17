// app/api/drive/trash/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getPrivateKey() {
  // envの改行が \n で入ってる場合に復元
  return (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

export async function POST(req: Request) {
  try {
    const { fileId } = (await req.json()) as { fileId?: string };
    if (!fileId) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    }

    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || "";
    const privateKey = getPrivateKey();
    if (!clientEmail || !privateKey) {
      return NextResponse.json(
        { error: "Google auth env is missing (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY)" },
        { status: 500 }
      );
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/drive"], // trashに必要
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
    console.error(e);
    return NextResponse.json(
      { error: e?.message || "Failed to trash file" },
      { status: 500 }
    );
  }
}
