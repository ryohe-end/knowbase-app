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

/**
 * ✅ Amplify Hosting (SSR) 対策
 */
function loadEnvFromFileOnce() {
  if (process.env.TEMPLATE_FILE_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return;
  }
  const cwd = process.cwd();
  const lambdaRoot = process.env.LAMBDA_TASK_ROOT || "/var/task";
  const candidates = [
    path.join(cwd, ".next", "server", "runtime-env.txt"),
    path.join(lambdaRoot, "server", "runtime-env.txt"),
    path.join(cwd, "runtime-env.txt"),
    path.join(lambdaRoot, "runtime-env.txt"),
    path.join(cwd, ".env.production"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        raw.split("\n").forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return;
          const splitIdx = trimmed.indexOf("=");
          if (splitIdx < 0) return;
          const key = trimmed.slice(0, splitIdx).trim();
          let val = trimmed.slice(splitIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (key && val && !process.env[key]) {
            process.env[key] = val;
          }
        });
        return; 
      } catch (e) {
        console.error(`[env-load] Failed to read ${p}:`, e);
      }
    }
  }
}

function loadServiceAccount(): SAJson {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  try {
    const json = JSON.parse(raw) as SAJson;
    if (typeof json.private_key === "string") {
      json.private_key = json.private_key.replace(/\\n/g, "\n");
    }
    return json;
  } catch (err) {
    throw new Error("Failed to parse Service Account JSON");
  }
}

function extractGoogleError(e: any) {
  const status = e?.code || e?.response?.status || e?.status || 500;
  const details = e?.response?.data || e?.errors || e?.message || String(e);
  return { status: typeof status === "number" ? status : 500, details };
}

export async function POST(req: Request) {
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    loadEnvFromFileOnce();

    // ✅ 横Verと縦VerのIDを環境変数から取得(変更前)
    //const templateIdLandscape = process.env.TEMPLATE_FILE_ID; 
    //const templateIdPortrait = process.env.TEMPLATE_FILE_ID_PORTRAIT;
    //const parentId = process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.trim() || null;//

    // ✅ 横Verと縦VerのIDを環境変数から取得
    const templateIdLandscape = "1zmRStrfKMGvASGkQeKfUtIfHklxj0UHHul9Z71xgwKM"; 
    const templateIdPortrait = "1Jy-o8antfycfi5J-AX5b30SGJ6FMo-cZa0goLbC6ySA";
    const parentId = process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.trim() || null;

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? "").trim();
    const templateType = body?.templateType || "landscape"; // "landscape" or "portrait"

    // ✅ タイプに応じてテンプレートIDを切り替え
    const templateId = templateType === "portrait" ? templateIdPortrait : templateIdLandscape;

    if (!templateId) {
      return NextResponse.json({ error: `${templateType} template ID is not set`, reqId }, { status: 500 });
    }
    if (!title) return NextResponse.json({ error: "title is required", reqId }, { status: 400 });

    const sa = loadServiceAccount();
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const drive = google.drive({ version: "v3", auth });

    // コピー実行
    const copyRes = await drive.files.copy({
      fileId: templateId,
      supportsAllDrives: true,
      requestBody: {
        name: `${title}（コピー）`,
        ...(parentId ? { parents: [parentId] } : {}),
      },
    });

    const newFileId = copyRes.data.id;
    if (!newFileId) throw new Error("Copy failed");

    // 権限設定
    try {
      await drive.permissions.create({
        fileId: newFileId,
        supportsAllDrives: true,
        requestBody: { role: "writer", type: "anyone" },
      });
    } catch (permError) {}

    const meta = await drive.files.get({
      fileId: newFileId,
      fields: "webViewLink",
      supportsAllDrives: true,
    });

    return NextResponse.json({ reqId, fileId: newFileId, editUrl: meta.data.webViewLink }, { status: 200 });

  } catch (e: any) {
    const { status, details } = extractGoogleError(e);
    return NextResponse.json({ error: "Internal Server Error", reqId, details }, { status });
  }
}