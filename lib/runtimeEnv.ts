// lib/runtimeEnv.ts
// Amplify Hosting (SSR) 対策: ビルド時生成の runtime-env.txt / .env.production を
// 実行時に読み process.env へ注入（コンソール環境変数が実行時に渡らない問題の回避）。
import fs from "node:fs";
import path from "node:path";

let loaded = false;

export function loadRuntimeEnv(): void {
  if (loaded) return;
  loaded = true;
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
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf-8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i < 0) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (k && v && !process.env[k]) process.env[k] = v;
      }
      return;
    } catch {
      /* 次の候補へ */
    }
  }
}
