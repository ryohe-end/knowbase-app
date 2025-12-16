// app/api/drive/copy-template/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SAJson = {
  client_email: string;
  private_key: string;
  [k: string]: any;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/**
 * サービスアカウント読み込み
 * 1) GOOGLE_SERVICE_ACCOUNT_JSON_PATH（ファイル）
 * 2) GOOGLE_SERVICE_ACCOUNT_JSON（文字列）
 */
function loadServiceAccount(): SAJson {
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH?.trim();

  if (p) {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (!fs.existsSync(abs)) throw new Error(`Service account file not found: ${abs}`);
    const raw = fs.readFileSync(abs, "utf-8");
    const json = JSON.parse(raw) as SAJson;

    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    if (!json.client_email || !json.private_key) throw new Error("Service account JSON missing client_email/private_key");
    return json;
  }

  const raw = mustEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  const json = JSON.parse(raw) as SAJson;

  if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
  if (!json.client_email || !json.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email/private_key");
  return json;
}

function extractGoogleError(e: any) {
  const status = e?.code || e?.response?.status || e?.status || 500;
  const details = e?.response?.data || e?.errors || e?.message || String(e);
  return { status: typeof status === "number" ? status : 500, details };
}

export async function POST(req: Request) {
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "title is required", reqId }, { status: 400 });

    const templateId = mustEnv("TEMPLATE_FILE_ID");

    // コピー先フォルダ（共有ドライブ側のフォルダIDでもOK）
    // 例: 0AJGh0hH-_9qWUk9PVA 配下に作りたいなら、その配下フォルダIDを入れる
    const parentId = process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.trim() || null;

    const sa = loadServiceAccount();

    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const drive = google.drive({ version: "v3", auth });

    console.log("[copy-template] start", {
      reqId,
      title,
      templateId,
      parentId,
      saEmail: sa.client_email,
      saSource: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH ? "file" : "env",
    });

    // ① テンプレ確認（共有ドライブの場合 supportsAllDrives が重要）
    await drive.files.get({
      fileId: templateId,
      fields: "id,name,mimeType",
      supportsAllDrives: true,
    });

    // ② コピー作成（parents を指定すれば狙った場所に作れる）
    const copyRes = await drive.files.copy({
      fileId: templateId,
      supportsAllDrives: true,
      requestBody: {
        name: `${title}（テンプレートコピー）`,
        ...(parentId ? { parents: [parentId] } : {}),
      },
    });

    const newFileId = copyRes.data.id;
    if (!newFileId) {
      return NextResponse.json({ error: "Copy succeeded but missing fileId", reqId }, { status: 500 });
    }

    // ③ 編集URL取得
    const meta = await drive.files.get({
      fileId: newFileId,
      fields: "id,webViewLink",
      supportsAllDrives: true,
    });

    const editUrl = meta.data.webViewLink || `https://docs.google.com/presentation/d/${newFileId}/edit`;

    console.log("[copy-template] done", { reqId, newFileId, editUrl });

    return NextResponse.json({ reqId, fileId: newFileId, editUrl }, { status: 200 });
  } catch (e: any) {
    const { status, details } = extractGoogleError(e);
    console.error("[copy-template] error", { reqId, status, details });
    return NextResponse.json({ error: "copy-template failed", reqId, details }, { status });
  }
}
