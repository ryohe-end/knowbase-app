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
 * ✅ Amplify Hosting compute(SSR) で process.env が空になりがちなので、
 *    artifacts に同梱した .env.production を実行時に読み込んで補完する。
 *
 * - 既に env があれば上書きしない
 * - 値はログに出さない
 */
function loadEnvFromFileOnce() {
  // すでに必要な値が入っているなら何もしない
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.TEMPLATE_FILE_ID) return;

  const candidates = [
    // たまに cwd 直下にあるケース
    path.join(process.cwd(), ".env.production"),
    // ✅ amplify.yml で .next/.env.production を同梱する想定
    path.join(process.cwd(), ".next", ".env.production"),
    // Lambda の /var/task 直下に置かれるケースに保険
    "/var/task/.env.production",
    "/var/task/.next/.env.production",
  ];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf-8");

      for (const line of raw.split("\n")) {
        const s = line.trim();
        if (!s || s.startsWith("#")) continue;
        const idx = s.indexOf("=");
        if (idx < 0) continue;

        const k = s.slice(0, idx).trim();
        // 値はそのまま（=以降を全て）
        let v = s.slice(idx + 1);

        // .env に "..." や '...' で入ってた場合だけ剥がす
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }

        // 既に入っている場合は上書きしない
        if (!process.env[k]) process.env[k] = v;
      }

      console.log("[copy-template env-load] loaded from", p);
      return;
    } catch (e) {
      // 失敗しても次を試す
      console.warn("[copy-template env-load] failed to load", p);
    }
  }

  console.warn("[copy-template env-load] no env file found (skipped)");
}

// サービスアカウント読み込みを安全にする
function loadServiceAccount(): SAJson {
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH?.trim();

  if (p) {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (!fs.existsSync(abs)) throw new Error(`Service account file not found: ${abs}`);
    const raw = fs.readFileSync(abs, "utf-8");
    const json = JSON.parse(raw) as SAJson;
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");

  try {
    const json = JSON.parse(raw) as SAJson;
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    if (!json.client_email || !json.private_key) throw new Error("JSON missing email/key");
    return json;
  } catch (err) {
    throw new Error(
      `Failed to parse Service Account JSON: ${err instanceof Error ? err.message : String(err)}`
    );
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
    // ✅ 実行時 env を補完（Amplify SSR 対策）
    loadEnvFromFileOnce();

    /* ===============================
       🔍 環境変数チェック（安全ログ）
       =============================== */
    console.log("[copy-template env-check]", {
      hasTemplateId: !!process.env.TEMPLATE_FILE_ID,
      templateIdLen: process.env.TEMPLATE_FILE_ID?.length ?? 0,
      hasParentId: !!process.env.TEMPLATE_COPY_PARENT_FOLDER_ID,
      parentIdLen: process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.length ?? 0,
      hasSaJson: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      nodeEnv: process.env.NODE_ENV,
    });
    /* =============================== */

    // 1. 環境変数の存在確認
    const templateId = process.env.TEMPLATE_FILE_ID;
    if (!templateId) {
      return NextResponse.json(
        { error: "TEMPLATE_FILE_ID is not set in environment", reqId },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "title is required", reqId }, { status: 400 });
    }

    const parentId = process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.trim() || null;

    // 2. サービスアカウントのロード
    let sa: SAJson;
    try {
      sa = loadServiceAccount();
    } catch (err: any) {
      console.error("[copy-template] Config Error", err.message);
      return NextResponse.json(
        { error: "Configuration failed", details: err.message, reqId },
        { status: 500 }
      );
    }

    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const drive = google.drive({ version: "v3", auth });

    // ① テンプレ確認
    try {
      await drive.files.get({
        fileId: templateId,
        fields: "id,name,mimeType",
        supportsAllDrives: true,
      });
    } catch (e: any) {
      const { status, details } = extractGoogleError(e);
      return NextResponse.json({ error: "Template access denied", details, reqId }, { status });
    }

    // ② コピー作成
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

    const editUrl =
      meta.data.webViewLink || `https://docs.google.com/presentation/d/${newFileId}/edit`;

    return NextResponse.json({ reqId, fileId: newFileId, editUrl }, { status: 200 });
  } catch (e: any) {
    const { status, details } = extractGoogleError(e);
    console.error("[copy-template] UNEXPECTED error", { reqId, status, details });
    return NextResponse.json(
      {
        error: "copy-template failed",
        reqId,
        details: typeof details === "object" ? JSON.stringify(details) : details,
      },
      { status }
    );
  }
}