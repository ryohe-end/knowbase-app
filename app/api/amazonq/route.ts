// app/api/amazonq/route.ts
import { QBusinessClient, ChatSyncCommand } from "@aws-sdk/client-qbusiness";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Source = {
  title?: string;
  url?: string;
  excerpt?: string;
};

/* =========================
   runtime-env.txt 読み取り（Amplify Hosting Compute 用）
   - 毎回 fs しないように軽くメモ化
========================= */
let _runtimeEnvCache: { at: number; data: Record<string, string> } | null = null;
const RUNTIME_ENV_CACHE_TTL_MS = 5_000;

function readRuntimeEnvFile(): Record<string, string> {
  const now = Date.now();
  if (_runtimeEnvCache && now - _runtimeEnvCache.at < RUNTIME_ENV_CACHE_TTL_MS) {
    return _runtimeEnvCache.data;
  }

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
      let v = s.slice(i + 1);

      v = v.replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
      out[k] = v;
    }

    _runtimeEnvCache = { at: now, data: out };
    return out;
  } catch {
    _runtimeEnvCache = { at: now, data: {} };
    return {};
  }
}

function getEnv(name: string, runtimeEnv: Record<string, string>): string | undefined {
  const v1 = process.env[name];
  if (v1 && v1.length > 0) return v1;

  const v2 = runtimeEnv[name];
  if (v2 && v2.length > 0) return v2;

  return undefined;
}

function mustEnv(name: string, runtimeEnv: Record<string, string>): string {
  const v = getEnv(name, runtimeEnv);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/* =========================
   userId の抽出
========================= */
function pickUserId(req: Request): string | undefined {
  const h = req.headers.get("x-kb-user");
  if (h) return h.slice(0, 128);

  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)kb_user=([^;]+)/);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1]).slice(0, 128);
    } catch {
      return m[1].slice(0, 128);
    }
  }
  return undefined;
}

/* =========================
   Q Business レスポンスから text / sources を頑丈に抽出
========================= */
function extractAnswerAndSources(raw: any): { text: string; sources: Source[] } {
  const textCandidates: (string | undefined)[] = [
    raw?.finalTextMessage,
    raw?.systemMessage,
    raw?.output?.text,
    raw?.outputText,
    raw?.assistantMessage,
    raw?.messages?.find?.((m: any) => m?.role === "assistant")?.content?.[0]?.text,
    raw?.message?.text,
  ];

  const text =
    textCandidates.find((t) => typeof t === "string" && t.trim().length > 0)?.trim() || "";

  const sources: Source[] = [];

  const sa =
    raw?.sourceAttributions ??
    raw?.sourceAttribution ??
    raw?.citations ??
    raw?.attributions;

  if (Array.isArray(sa)) {
    for (const item of sa) {
      const title =
        item?.title ??
        item?.documentTitle ??
        item?.source?.title ??
        item?.retrievedReferences?.[0]?.title;

      const url =
        item?.url ??
        item?.documentUrl ??
        item?.source?.url ??
        item?.retrievedReferences?.[0]?.url;

      const excerpt =
        item?.snippet ??
        item?.excerpt ??
        item?.text ??
        item?.snippetExcerpt?.text ??
        item?.textMessageSegments?.[0]?.snippetExcerpt?.text ??
        item?.source?.excerpt ??
        item?.retrievedReferences?.[0]?.excerpt;

      if (title || url || excerpt) sources.push({ title, url, excerpt });
    }
  }

  const refs = raw?.references ?? raw?.sourceReferences;
  if (Array.isArray(refs)) {
    for (const r of refs) {
      const title = r?.title ?? r?.name;
      const url = r?.url ?? r?.link;
      const excerpt = r?.excerpt ?? r?.snippet ?? r?.text;
      if (title || url || excerpt) sources.push({ title, url, excerpt });
    }
  }

  const seen = new Set<string>();
  const uniq = sources.filter((s) => {
    const key = `${s.url || ""}|${s.title || ""}|${s.excerpt || ""}`.trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { text, sources: uniq };
}

function getClient(region: string) {
  return new QBusinessClient({ region });
}

function isAnonymousUserIdValidation(err: any): boolean {
  const name = err?.name || "";
  const msg = err?.message || "";
  return (
    name === "ValidationException" &&
    typeof msg === "string" &&
    msg.includes("User ID must be null for Anonymous identity enabled applications")
  );
}

/* =========================
   SSE helpers
========================= */
const enc = new TextEncoder();

function toSse(eventName: string | null, data: string) {
  // SSE は data: 行を複数行に分割して送るのが安全
  const lines = String(data ?? "").split("\n");
  let out = "";

  if (eventName) out += `event: ${eventName}\n`;
  for (const ln of lines) out += `data: ${ln}\n`;
  out += "\n";
  return enc.encode(out);
}

function toSseComment(comment: string) {
  // ":" から始まる行は comment（クライアント側では無視されるが、即 flush できる）
  return enc.encode(`: ${comment}\n\n`);
}

export async function POST(req: Request) {
  const runtimeEnv = readRuntimeEnvFile();

  // body の parse はここで先にやる（SSE開始前に 400 を返せる）
  let body: any = {};
  try {
    body = (await req.json().catch(() => ({}))) as any;
  } catch {
    body = {};
  }

  const prompt = (body?.prompt ?? "").toString();
  const conversationId: string | undefined =
    body?.conversationId ? String(body.conversationId) : undefined;

  // デバッグ：env check は JSON で返す（フロントのfetch確認用）
  if (prompt === "env check") {
    const QBUSINESS_APP_ID = getEnv("QBUSINESS_APP_ID", runtimeEnv);
    const AWS_REGION = getEnv("AWS_REGION", runtimeEnv) ?? "us-east-1";
    const QBUSINESS_REGION = getEnv("QBUSINESS_REGION", runtimeEnv) || null;

    return new Response(
      JSON.stringify({
        ok: true,
        promptLen: prompt.length,
        QBUSINESS_APP_ID: QBUSINESS_APP_ID ? "(set)" : "(missing)",
        QBUSINESS_APP_ID_len: QBUSINESS_APP_ID?.length ?? 0,
        AWS_REGION,
        QBUSINESS_REGION,
        NODE_ENV: process.env.NODE_ENV ?? null,
        AMPLIFY_ENV: process.env.AMPLIFY_ENV ?? null,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  if (!prompt.trim()) {
    return new Response(JSON.stringify({ ok: false, error: "prompt is required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // ===== ここから SSE 本番 =====
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      // クライアントが切断したら止める
      const onAbort = () => {
        clearInterval(pingTimer);
        close();
      };
      req.signal?.addEventListener?.("abort", onAbort);

      // ✅ まず 1バイトでも返す（Amplify/ALB/CF のタイムアウト回避）
      controller.enqueue(toSseComment("sse-open"));

      // ✅ keep-alive ping（3秒推奨。環境次第で 2〜5 秒）
      const ping = () => {
        controller.enqueue(toSse("ping", JSON.stringify({ t: Date.now() })));
      };
      ping(); // 最初のpingも即送る
      const pingTimer = setInterval(ping, 3_000);

      (async () => {
        try {
          const appId = mustEnv("QBUSINESS_APP_ID", runtimeEnv);
          const awsRegion = getEnv("AWS_REGION", runtimeEnv) ?? "us-east-1";
          const qRegion = getEnv("QBUSINESS_REGION", runtimeEnv) || awsRegion;

          const client = getClient(qRegion);
          const userId = pickUserId(req);

          const sendChat = async (opts: { includeUserId: boolean }) => {
            const input: any = {
              applicationId: appId,
              conversationId,
              userMessage: prompt,
            };
            if (opts.includeUserId && userId) input.userId = userId;

            const cmd = new ChatSyncCommand(input);
            return client.send(cmd);
          };

          let result: any;
          try {
            result = await sendChat({ includeUserId: true });
          } catch (err: any) {
            if (isAnonymousUserIdValidation(err)) {
              result = await sendChat({ includeUserId: false });
            } else {
              throw err;
            }
          }

          const { text, sources } = extractAnswerAndSources(result);

          // ✅ 参照元を event:sources で先に送る（フロントが最優先で拾える）
          controller.enqueue(toSse("sources", JSON.stringify(sources ?? [])));

          // ✅ 本文（必要なら分割して少しずつ送る）
          const answer = text || "(回答を取得できませんでした)";
          const CHUNK = 240; // data: 1行が長すぎると壊れる環境があるので短め推奨
          for (let i = 0; i < answer.length; i += CHUNK) {
            const chunk = answer.slice(i, i + CHUNK);
            controller.enqueue(toSse(null, chunk));
          }

          // ✅ done
          controller.enqueue(toSse("done", "[DONE]"));
        } catch (err: any) {
          const payload = {
            error: err?.name || "InternalError",
            message: err?.message || String(err),
          };
          controller.enqueue(toSse("error", JSON.stringify(payload)));
        } finally {
          clearInterval(pingTimer);
          close();
          req.signal?.removeEventListener?.("abort", onAbort);
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx 等のバッファ抑止（効く環境のみ）
      "x-accel-buffering": "no",
    },
  });
}
