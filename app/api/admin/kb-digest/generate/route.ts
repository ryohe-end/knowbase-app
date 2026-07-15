// app/api/admin/kb-digest/generate/route.ts
// KB通信のプレビュー生成 (管理者専用)。生成に数十秒かかり Amplify SSR の
// ゲートウェイタイムアウト(≈28s)を超えるため、SSE ストリーミングで返す。
//   event: status  data: {stage}
//   (default)      data: <HTML断片>   ← 逐次
//   event: done    data: [DONE]
//   event: error   data: {error}
import { isAdminRequest } from "@/lib/auth";
import { getConfig, gatherTrends, buildDigestMessages, DIGEST_MODEL_ID } from "@/lib/kbDigest";
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });
const enc = new TextEncoder();
function sse(event: string | null, data: string): Uint8Array {
  let out = "";
  if (event) out += `event: ${event}\n`;
  for (const ln of String(data ?? "").split("\n")) out += `data: ${ln}\n`;
  out += "\n";
  return enc.encode(out);
}

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  }
  let body: { cfg?: any; periodDays?: number } = {};
  try { body = await req.json(); } catch {}

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(sse("status", JSON.stringify({ stage: "アクセス動向を集計中…" })));
        const saved = await getConfig();
        const cfg = { ...saved, ...(body.cfg || {}), sections: { ...saved.sections, ...(body.cfg?.sections || {}) } };
        const periodDays = body.periodDays || (cfg.frequency === "monthly" ? 30 : cfg.frequency === "biweekly" ? 14 : 7);
        const trends = await gatherTrends(periodDays);

        controller.enqueue(sse("status", JSON.stringify({ stage: "AIが通信を作成中…" })));
        const { system, user } = buildDigestMessages({ cfg, trends });
        const resp = await bedrock.send(new InvokeModelWithResponseStreamCommand({
          modelId: DIGEST_MODEL_ID, contentType: "application/json", accept: "application/json",
          body: JSON.stringify({ anthropic_version: "bedrock-2023-05-31", max_tokens: 4096, system, messages: [{ role: "user", content: [{ type: "text", text: user }] }] }),
        }));
        for await (const ev of resp.body ?? []) {
          const bytes = (ev as any).chunk?.bytes;
          if (!bytes) continue;
          try {
            const j = JSON.parse(new TextDecoder().decode(bytes));
            if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) {
              controller.enqueue(sse(null, j.delta.text));
            }
          } catch {}
        }
        controller.enqueue(sse("done", "[DONE]"));
      } catch (e: any) {
        console.error("[kb-digest/generate] error:", e?.name, e?.message);
        controller.enqueue(sse("error", JSON.stringify({ error: e?.message || "生成に失敗しました" })));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
