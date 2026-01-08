// app/api/amazonq/route.ts
import { NextResponse } from "next/server";
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

function readRuntimeEnvFile(): Record<string, string> {
  // Amplify Hosting Compute では .next/server に置かれる想定
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
  } catch {
    return {};
  }
}

function getEnv(name: string): string | undefined {
  const v1 = process.env[name];
  if (v1) return v1;

  const runtimeEnv = readRuntimeEnvFile();
  const v2 = runtimeEnv[name];
  if (v2) {
    // runtime-env.txt に書いたときにクォートが付くケースを剥がす
    return v2.replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
  }
  return undefined;
}

function mustEnv(name: string): string {
  const v = getEnv(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function pickUserId(req: Request): string {
  // 1) 明示ヘッダ（フロントから渡す用）
  const h = req.headers.get("x-kb-user");
  if (h) return h.slice(0, 128);

  // 2) Cookie (kb_user)
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)kb_user=([^;]+)/);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1]).slice(0, 128);
    } catch {
      return m[1].slice(0, 128);
    }
  }

  // 3) fallback
  return "anon";
}

/**
 * Q Business のレスポンスからテキストとソースをできるだけ拾う
 * ※SDK/設定によって形が変わるので “頑丈に” しています
 */
function extractAnswerAndSources(raw: any): { text: string; sources: Source[] } {
  // 1) まずテキスト（存在しがちな候補を総当たり）
  const textCandidates: (string | undefined)[] = [
    raw?.systemMessage,
    raw?.output?.text,
    raw?.outputText,
    raw?.messages?.find?.((m: any) => m?.role === "assistant")?.content?.[0]?.text,
    raw?.assistantMessage,
  ];
  const text = textCandidates.find((t) => typeof t === "string" && t.trim().length > 0) || "";

  // 2) ソース（sourceAttribution / citations っぽいところ）
  const sources: Source[] = [];

  // sourceAttribution がある場合（AWS側の典型）
  const sa = raw?.sourceAttribution ?? raw?.citations ?? raw?.attributions;
  if (Array.isArray(sa)) {
    for (const item of sa) {
      // 形が色々あるので拾えるものを拾う
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
        item?.excerpt ??
        item?.text ??
        item?.snippet ??
        item?.source?.excerpt ??
        item?.retrievedReferences?.[0]?.excerpt;

      if (title || url || excerpt) {
        sources.push({ title, url, excerpt });
      }
    }
  }

  // “references” っぽいキーも拾う
  const refs = raw?.references ?? raw?.sourceReferences;
  if (Array.isArray(refs)) {
    for (const r of refs) {
      const title = r?.title ?? r?.name;
      const url = r?.url ?? r?.link;
      const excerpt = r?.excerpt ?? r?.snippet ?? r?.text;
      if (title || url || excerpt) sources.push({ title, url, excerpt });
    }
  }

  // 重複URLを軽く除去
  const seen = new Set<string>();
  const uniq = sources.filter((s) => {
    const key = (s.url || "") + "|" + (s.title || "") + "|" + (s.excerpt || "");
    if (!key.trim()) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { text, sources: uniq };
}

function getClient(region: string) {
  return new QBusinessClient({ region });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const prompt: string = (body?.prompt ?? "").toString();
    const conversationId: string | undefined =
      body?.conversationId ? String(body.conversationId) : undefined;

    // ✅ env check は “デバッグ専用”
    if (prompt === "env check") {
      const QBUSINESS_APP_ID = getEnv("QBUSINESS_APP_ID");
      const AWS_REGION = getEnv("AWS_REGION") ?? "us-east-1";
      const QBUSINESS_REGION = getEnv("QBUSINESS_REGION") || null;

      return NextResponse.json({
        ok: true,
        promptLen: prompt.length,
        QBUSINESS_APP_ID: QBUSINESS_APP_ID ? "(set)" : "(missing)",
        QBUSINESS_APP_ID_len: QBUSINESS_APP_ID?.length ?? 0,
        AWS_REGION,
        QBUSINESS_REGION,
        NODE_ENV: process.env.NODE_ENV ?? null,
        AMPLIFY_ENV: process.env.AMPLIFY_ENV ?? null,
      });
    }

    if (!prompt.trim()) {
      return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
    }

    const appId = mustEnv("QBUSINESS_APP_ID");
    const awsRegion = getEnv("AWS_REGION") ?? "us-east-1";
    const qRegion = getEnv("QBUSINESS_REGION") || awsRegion;

    const client = getClient(qRegion);
    const userId = pickUserId(req);

    // 会話を続けたいなら conversationId をフロント側で保持して渡す
    const cmd = new ChatSyncCommand({
      applicationId: appId,
      userId,
      conversationId,
      userMessage: prompt,
    });

    const result = await client.send(cmd);

    const { text, sources } = extractAnswerAndSources(result);

    // テキストが拾えない場合もあるので、最低限 raw をログに残す
    if (!text) {
      console.log("[amazonq] empty text extracted. keys=", Object.keys(result as any));
    }

    return NextResponse.json({
      ok: true,
      text, // ✅ これがチャット本文
      sources, // ✅ これがソース（タイトル/URL/抜粋）
      conversationId: (result as any)?.conversationId ?? conversationId ?? null,
    });
  } catch (err: any) {
    console.error("[amazonq] error:", err);
    return NextResponse.json(
      { ok: false, error: err?.name || "InternalError", detail: err?.message || String(err) },
      { status: 500 }
    );
  }
}
