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
 * ビルド時に生成した runtime-env.txt を読み込み、process.env に注入する
 */
function loadEnvFromFileOnce() {
  // すでに必要な変数が存在すればスキップ
  if (process.env.TEMPLATE_FILE_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return;
  }

  const cwd = process.cwd();
  const lambdaRoot = process.env.LAMBDA_TASK_ROOT || "/var/task";

  // Amplify SSR環境でファイルが存在する可能性が高いパスを順番に定義
  const candidates = [
    // Next.js 15 / Amplify の標準的な配置パス
    path.join(cwd, ".next", "server", "runtime-env.txt"),
    path.join(lambdaRoot, "server", "runtime-env.txt"),
    path.join(cwd, "runtime-env.txt"),
    path.join(lambdaRoot, "runtime-env.txt"),
    // バックアップとして元のファイル名も保持
    path.join(cwd, ".env.production"),
  ];

  console.log("[env-load] Checking candidates...", { cwd, lambdaRoot });

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        let loadedCount = 0;

        raw.split("\n").forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return;
          
          const splitIdx = trimmed.indexOf("=");
          if (splitIdx < 0) return;

          const key = trimmed.slice(0, splitIdx).trim();
          let val = trimmed.slice(splitIdx + 1).trim();

          // クォートの除去
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }

          if (key && val && !process.env[key]) {
            process.env[key] = val;
            loadedCount++;
          }
        });

        console.log(`[env-load] Successfully loaded ${loadedCount} keys from: ${p}`);
        return; // 最初に見つかったファイルをロードしたら終了
      } catch (e) {
        console.error(`[env-load] Failed to read ${p}:`, e);
      }
    }
  }
  console.warn("[env-load] No environment file found in candidates.");
}

function loadServiceAccount(): SAJson {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");

  try {
    const json = JSON.parse(raw) as SAJson;
    if (typeof json.private_key === "string") {
      // 改行コードの正規化
      json.private_key = json.private_key.replace(/\\n/g, "\n");
    }
    if (!json.client_email || !json.private_key) throw new Error("JSON missing email or private_key");
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
    // 1. 環境変数のロードを試行
    loadEnvFromFileOnce();

    const templateId = process.env.TEMPLATE_FILE_ID;
    const parentId = process.env.TEMPLATE_COPY_PARENT_FOLDER_ID?.trim() || null;

    console.log("[copy-template] Env Check:", {
      reqId,
      hasTemplateId: !!templateId,
      templateIdLen: templateId?.length ?? 0,
      hasParentId: !!parentId,
      hasSaJson: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    });

    if (!templateId) {
      return NextResponse.json({ 
        error: "TEMPLATE_FILE_ID is not set in environment", 
        reqId,
        debug_info: "Make sure runtime-env.txt is created during build"
      }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "title is required", reqId }, { status: 400 });

    // 2. サービスアカウントの準備
    const sa = loadServiceAccount();
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const drive = google.drive({ version: "v3", auth });

    // 3. テンプレートファイルの存在確認
    try {
      await drive.files.get({
        fileId: templateId,
        fields: "id, name",
        supportsAllDrives: true,
      });
    } catch (e: any) {
      const { status, details } = extractGoogleError(e);
      return NextResponse.json({ error: "Template access denied", details, reqId }, { status });
    }

    // 4. ファイルのコピー実行
    const copyRes = await drive.files.copy({
      fileId: templateId,
      supportsAllDrives: true,
      requestBody: {
        name: `${title}（コピー）`,
        ...(parentId ? { parents: [parentId] } : {}),
      },
    });

    const newFileId = copyRes.data.id;
    if (!newFileId) throw new Error("Copy failed to return a new file ID");

    // 5. 編集URLの取得
    const meta = await drive.files.get({
      fileId: newFileId,
      fields: "webViewLink",
      supportsAllDrives: true,
    });

    return NextResponse.json({ 
      reqId, 
      fileId: newFileId, 
      editUrl: meta.data.webViewLink 
    }, { status: 200 });

  } catch (e: any) {
    const { status, details } = extractGoogleError(e);
    console.error("[copy-template] Unexpected error:", { reqId, status, details });
    return NextResponse.json(
      { error: "Internal Server Error", reqId, details: typeof details === "object" ? JSON.stringify(details) : details },
      { status }
    );
  }
}