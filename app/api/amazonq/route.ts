// app/api/amazonq/route.ts
import { QBusinessClient, ChatCommand } from "@aws-sdk/client-qbusiness";
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
  const lines = String(data ?? "").split("\n");
  let out = "";

  if (eventName) out += `event: ${eventName}\n`;
  for (const ln of lines) out += `data: ${ln}\n`;
  out += "\n";
  return enc.encode(out);
}

function toSseComment(comment: string) {
  return enc.encode(`: ${comment}\n\n`);
}

/* =========================
   QBusiness client（regionごとに使い回し）
========================= */
const _clientCache = new Map<string, QBusinessClient>();
function getClient(region: string) {
  const hit = _clientCache.get(region);
  if (hit) return hit;

  const c = new QBusinessClient({ region });
  _clientCache.set(region, c);
  return c;
}

/* =========================
   ChatCommand 用 inputStream generator
   - TextInputEvent(userMessage) → EndOfInputEvent
========================= */
function makeInputStream(userMessage: string) {
  async function* gen() {
    yield { textEvent: { userMessage } };
    yield { endOfInputEvent: {} };
  }
  return gen();
}

/* =========================
   SourceAttribution -> Source（あなたのUIに合わせた整形）
========================= */
function normalizeSources(sa: any[] | undefined): Source[] {
  if (!Array.isArray(sa)) return [];

  const out: Source[] = [];
  for (const item of sa) {
    const title = item?.title ?? item?.documentTitle;
    const url = item?.url ?? item?.documentUrl;

    // snippet があれば最優先。なければ textMessageSegments の snippetExcerpt.text を拾う
    const excerpt =
      item?.snippet ??
      item?.excerpt ??
      item?.text ??
      item?.textMessageSegments?.[0]?.snippetExcerpt?.text ??
      item?.snippetExcerpt?.text;

    if (title || url || excerpt) out.push({ title, url, excerpt });
  }

  // uniq
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${s.url || ""}|${s.title || ""}|${s.excerpt || ""}`.trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(req: Request) {
  const runtimeEnv = readRuntimeEnvFile();

  // body parse（SSE開始前に 400 を返せる）
  let body: any = {};
  try {
    body = (await req.json().catch(() => ({}))) as any;
  } catch {
    body = {};
  }

  const prompt = (body?.prompt ?? "").toString();
  const conversationId: string | undefined =
    body?.conversationId ? String(body.conversationId) : undefined;

  // env check
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

  // ===== SSE 本番 =====
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

      // abort
      const onAbort = () => {
        clearInterval(pingTimer);
        close();
      };
      req.signal?.addEventListener?.("abort", onAbort);

      // まず1バイト
      controller.enqueue(toSseComment("sse-open"));

      // keep-alive ping
      const ping = () => controller.enqueue(toSse("ping", JSON.stringify({ t: Date.now() })));
      ping();
      const pingTimer = setInterval(ping, 3_000);

      (async () => {
        try {
          const appId = mustEnv("QBUSINESS_APP_ID", runtimeEnv);
          const awsRegion = getEnv("AWS_REGION", runtimeEnv) ?? "us-east-1";
          const qRegion = getEnv("QBUSINESS_REGION", runtimeEnv) || awsRegion;

          const client = getClient(qRegion);
          const userId = pickUserId(req);

          const sendChatStream = async (opts: { includeUserId: boolean }) => {
            const input: any = {
              applicationId: appId,
              conversationId,
              inputStream: makeInputStream(prompt),
            };
            if (opts.includeUserId && userId) input.userId = userId;

            const cmd = new ChatCommand(input);
            return client.send(cmd);
          };

          let resp: any;
          try {
            resp = await sendChatStream({ includeUserId: true });
          } catch (err: any) {
            if (isAnonymousUserIdValidation(err)) {
              resp = await sendChatStream({ includeUserId: false });
            } else {
              throw err;
            }
          }

          // 会話IDを拾えたらフロントへ（必要なら使う）
          let sentConversation = false;

          // sources は metadataEvent から来る（sourceAttributions）
          let sentSources = false;

          // ★ここが「本当のストリーミング」
          const outStream = resp?.outputStream;
          if (!outStream || typeof outStream[Symbol.asyncIterator] !== "function") {
            throw new Error("outputStream is missing (streaming not available).");
          }

          for await (const ev of outStream) {
            // 生成テキスト（増分）
            const delta = ev?.textEvent?.systemMessage; // TextOutputEvent.systemMessage :contentReference[oaicite:2]{index=2}
            if (typeof delta === "string" && delta.length > 0) {
              controller.enqueue(toSse(null, delta));
            }

            // 会話IDなど（metadataEvent / textEvent どちらからでも拾える）
            const convId =
              ev?.metadataEvent?.conversationId ??
              ev?.textEvent?.conversationId ??
              undefined;
            if (!sentConversation && convId) {
              controller.enqueue(toSse("conversation", JSON.stringify({ conversationId: convId })));
              sentConversation = true;
            }

            // 参照元（metadataEvent.sourceAttributions） :contentReference[oaicite:3]{index=3}
            const atts = ev?.metadataEvent?.sourceAttributions;
            if (!sentSources && Array.isArray(atts) && atts.length > 0) {
              const sources = normalizeSources(atts);
              controller.enqueue(toSse("sources", JSON.stringify(sources)));
              sentSources = true;
            }

            // finalTextMessage は「最終全文」なので、deltaをもう送ってるなら二重送信注意
            // const final = ev?.metadataEvent?.finalTextMessage;
          }

          // done
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
      "x-accel-buffering": "no",
    },
  });
}
