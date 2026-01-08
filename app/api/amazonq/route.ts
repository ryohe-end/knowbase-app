// app/api/amazonq/route.ts
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readRuntimeEnvFile(): Record<string, string> {
  // Amplify build で .next/server/runtime-env.txt にコピーしている前提
  const p = path.join(process.cwd(), ".next", "server", "runtime-env.txt");
  try {
    const text = fs.readFileSync(p, "utf8");
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const i = s.indexOf("=");
      if (i <= 0) continue;
      const k = s.slice(0, i).trim();
      const v = s.slice(i + 1);
      out[k] = v;
    }
    return out;
  } catch (e) {
    return {};
  }
}

/**
 * ✅ ここがポイント：
 * mustEnv() の直前で runtime-env.txt の中身（キー）と
 * QBUSINESS_APP_ID が入っているかをログに出す
 */
function mustEnv(name: string) {
  const runtimeEnv = readRuntimeEnvFile();

  console.log("[RUNTIME ENV CHECK]", {
    cwd: process.cwd(),
    runtimeEnvKeys: Object.keys(runtimeEnv),
    QBUSINESS_APP_ID_in_runtime: runtimeEnv["QBUSINESS_APP_ID"] ? "(set)" : "(missing)",
    AWS_REGION_in_runtime: runtimeEnv["AWS_REGION"] ? "(set)" : "(missing)",
    QBUSINESS_REGION_in_runtime: runtimeEnv["QBUSINESS_REGION"] ? "(set)" : "(missing)",
  });

  // ① まず通常の env
  const v1 = process.env[name];
  if (v1) return v1;

  // ② 次に runtime-env.txt
  const v2 = runtimeEnv[name];
  if (v2) return v2;

  console.error(`[ENV ERROR] Missing env: ${name}`, {
    hasInProcessEnv: name in process.env,
    runtimeHasKey: !!runtimeEnv[name],
    AWS_REGION: process.env.AWS_REGION ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
  });

  throw new Error(`Missing env: ${name}`);
}

export async function POST(req: NextRequest) {
  try {
    // リクエストは読んでおく（形だけ）
    const body = await req.json().catch(() => ({} as any));
    const prompt = String((body as any)?.prompt ?? "").trim();

    // ✅ ここで mustEnv を呼んで、ログを出させる（QBUSINESS_APP_ID を検査）
    const appId = mustEnv("QBUSINESS_APP_ID");

    // 実際の値は返さない（漏洩防止）。長さだけ返す。
    return new Response(
      JSON.stringify(
        {
          ok: true,
          promptLen: prompt.length,
          QBUSINESS_APP_ID: "(set)",
          QBUSINESS_APP_ID_len: appId.length,
          AWS_REGION: process.env.AWS_REGION ?? null,
          QBUSINESS_REGION: process.env.QBUSINESS_REGION ?? null,
          NODE_ENV: process.env.NODE_ENV ?? null,
          AMPLIFY_ENV: process.env.AMPLIFY_ENV ?? null,
        },
        null,
        2
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  } catch (error: any) {
    console.error("amazonq env-check api error:", error);
    const message =
      error?.name
        ? `${error.name}: ${error.message || ""}`.trim()
        : error?.message || String(error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
