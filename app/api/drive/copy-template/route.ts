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
 * ✅ Amplify Hosting compute(SSR) で process.env が入らないことがあるため、
 *    同梱した .env.production を実行時に読み込み、process.env を補完する。
 * - 既に env があれば上書きしない
 * - 値はログに出さない（長さだけ）
 */
function loadEnvFromFileOnce() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.TEMPLATE_FILE_ID) return;

  const cwd = process.cwd();
  const lambdaRoot = process.env.LAMBDA_TASK_ROOT || "/var/task";

// 実際の配置に合わせて候補を多めに（Secrets漏洩防止のため内容は出さない）
const candidates = [
  // ===== build時にプロジェクトルートで読む可能性 =====
  path.join(cwd, ".env.production"),
  path.join(cwd, ".next", ".env.production"),
  path.join(cwd, ".next", "server", ".env.production"),

  // ===== ✅ Amplify SSR 実行時（baseDirectory: .next なので /var/task は ".nextの中身"） =====
  // → /var/task に ".next" ディレクトリは無い
  path.join(lambdaRoot, ".env.production"),                 // /var/task/.env.production
  path.join(lambdaRoot, "server", ".env.production"),       // /var/task/server/.env.production

  // （もし runtime-env.txt 方式も使うなら）
  path.join(lambdaRoot, "runtime-env.txt"),                 // /var/task/runtime-env.txt
  path.join(lambdaRoot, "server", "runtime-env.txt"),       // /var/task/server/runtime-env.txt
];

  // まず「どこにファイルが存在するか」だけログ
  const existMap = candidates.map((p) => ({ p, exists: fs.existsSync(p) }));
  console.log("[copy-template env-load] candidates", { cwd, lambdaRoot, existMap });

  for (const { p, exists } of existMap) {
    if (!exists) continue;

    try {
      const raw = fs.readFileSync(p, "utf-8");
      let loaded = 0;

      for (const line of raw.split("\n")) {
        const s = line.trim();
        if (!s || s.startsWith("#")) continue;
        const idx = s.indexOf("=");
        if (idx < 0) continue;

        const k = s.slice(0, idx).trim();
        let v = s.slice(idx + 1);

        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }

        if (!process.env[k]) {
          process.env[k] = v;
          loaded++;
        }
      }

      console.log("[copy-template env-load] loaded", {
        from: p,
        loadedKeys: loaded,
        hasTemplate: !!process.env.TEMPLATE_FILE_ID,
        templateLen: process.env.TEMPLATE_FILE_ID?.length ?? 0,
        hasParent: !!process.env.TEMPLATE_COPY_PARENT_FOLDER_ID,
        parentLen: process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.length ?? 0,
        hasSa: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
        saLen: process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.length ?? 0,
      });
      return;
    } catch (e: any) {
      console.warn("[copy-template env-load] read/parse failed", { p, message: e?.message ?? String(e) });
    }
  }

  console.warn("[copy-template env-load] env file not found in any candidate");
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
    throw new Error(`Failed to parse Service Account JSON: ${err instanceof Error ? err.message : String(err)}`);
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

    console.log("[copy-template env-check]", {
      reqId,
      hasTemplateId: !!process.env.TEMPLATE_FILE_ID,
      templateIdLen: process.env.TEMPLATE_FILE_ID?.length ?? 0,
      hasParentId: !!process.env.TEMPLATE_COPY_PARENT_FOLDER_ID,
      parentIdLen: process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.length ?? 0,
      hasSaJson: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      saLen: process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.length ?? 0,
      nodeEnv: process.env.NODE_ENV,
    });

    const templateId = process.env.TEMPLATE_FILE_ID;
    if (!templateId) {
      return NextResponse.json({ error: "TEMPLATE_FILE_ID is not set in environment", reqId }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "title is required", reqId }, { status: 400 });

    const parentId = process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.trim() || null;

    let sa: SAJson;
    try {
      sa = loadServiceAccount();
    } catch (err: any) {
      console.error("[copy-template] Config Error", err.message);
      return NextResponse.json({ error: "Configuration failed", details: err.message, reqId }, { status: 500 });
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

    const editUrl = meta.data.webViewLink || `https://docs.google.com/presentation/d/${newFileId}/edit`;
    return NextResponse.json({ reqId, fileId: newFileId, editUrl }, { status: 200 });
  } catch (e: any) {
    const { status, details } = extractGoogleError(e);
    console.error("[copy-template] UNEXPECTED error", { reqId, status, details });
    return NextResponse.json(
      { error: "copy-template failed", reqId, details: typeof details === "object" ? JSON.stringify(details) : details },
      { status }
    );
  }
}
