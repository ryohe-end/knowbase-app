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

/* =========================
   runtime-env.txt 読み取り（Amplify Hosting Compute 用）
   - 毎回 fs しないように軽くメモ化
========================= */
let _runtimeEnvCache: { at: number; data: Record<string, string> } | null = null;
const RUNTIME_ENV_CACHE_TTL_MS = 5_000; // 5秒だけキャッシュ（デバッグ用途なので十分）

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

      // runtime-env.txt に書いたときにクォートが付くケースを剥がす
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
   - Anonymous identity 有効アプリでは userId を送ると ValidationException
   - なので「まずは取る」だけ。送るかどうかは後で決める/リトライで決める
========================= */
function pickUserId(req: Request): string | undefined {
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

  // 3) fallback（未ログインなど）
  return undefined;
}

/* =========================
   Q Business レスポンスから text / sources を頑丈に抽出
========================= */
function extractAnswerAndSources(raw: any): { text: string; sources: Source[] } {
  // ✅ ChatSync の本命は finalTextMessage
  const textCandidates: (string | undefined)[] = [
    raw?.finalTextMessage,     // ← 追加
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

  // ✅ ChatSync の本命は sourceAttributions（複数形）
  const sa =
    raw?.sourceAttributions ?? // ← 追加（最優先）
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

      // ✅ SourceAttribution の本文は snippet が基本
      const excerpt =
        item?.snippet ?? // ← snippet を前に
        item?.excerpt ??
        item?.text ??
        item?.snippetExcerpt?.text ?? // 念のため
        item?.textMessageSegments?.[0]?.snippetExcerpt?.text ?? // 念のため
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

  // 軽い重複除去
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

export async function POST(req: Request) {
  const runtimeEnv = readRuntimeEnvFile();

  try {
    const body = (await req.json().catch(() => ({} as any))) as any;

    const prompt = (body?.prompt ?? "").toString();
    const conversationId: string | undefined =
      body?.conversationId ? String(body.conversationId) : undefined;

    // ✅ デバッグ専用：env check（値そのものは返さない）
    if (prompt === "env check") {
      const QBUSINESS_APP_ID = getEnv("QBUSINESS_APP_ID", runtimeEnv);
      const AWS_REGION = getEnv("AWS_REGION", runtimeEnv) ?? "us-east-1";
      const QBUSINESS_REGION = getEnv("QBUSINESS_REGION", runtimeEnv) || null;

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

    const appId = mustEnv("QBUSINESS_APP_ID", runtimeEnv);
    const awsRegion = getEnv("AWS_REGION", runtimeEnv) ?? "us-east-1";
    const qRegion = getEnv("QBUSINESS_REGION", runtimeEnv) || awsRegion;

    const client = getClient(qRegion);

    // まずは userId を “取るだけ取る”
    const userId = pickUserId(req);

    // 送信関数（userId あり/なしを切り替えられる）
    const sendChat = async (opts: { includeUserId: boolean }) => {
      const input: any = {
        applicationId: appId,
        conversationId,
        userMessage: prompt,
      };

      // includeUserId=true の時だけ userId を渡す（undefined は入れない）
      if (opts.includeUserId && userId) {
        input.userId = userId;
      }

      const cmd = new ChatSyncCommand(input);
      return client.send(cmd);
    };

    let result: any;

    // ✅ 1回目：userId ありで試す（ログイン運用アプリならこれが正）
    // ✅ Anonymous 有効アプリなら ValidationException が来るので userId なしでリトライ
    try {
      result = await sendChat({ includeUserId: true });
    } catch (err: any) {
      if (isAnonymousUserIdValidation(err)) {
        // Anonymous identity 有効 → userId を付けずに再試行
        result = await sendChat({ includeUserId: false });
      } else {
        throw err;
      }
    }

    const { text, sources } = extractAnswerAndSources(result);

    // テキストが拾えない場合もあるので、最低限ログ
    if (!text) {
      const keys = result ? Object.keys(result) : [];
      console.log("[amazonq] empty text extracted. keys=", keys);
    }

    return NextResponse.json({
      ok: true,
      text, // ✅ チャット本文
      sources, // ✅ ソース（タイトル/URL/抜粋）
      conversationId: (result as any)?.conversationId ?? conversationId ?? null,
    });
  } catch (err: any) {
    console.error("[amazonq] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.name || "InternalError",
        detail: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
