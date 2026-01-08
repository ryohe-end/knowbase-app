// app/api/amazonq/route.ts
import { NextRequest } from "next/server";
import { QBusinessClient, ChatSyncCommand } from "@aws-sdk/client-qbusiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) {
    // 何が見えているかをログに残す（デバッグ最重要）
    console.error(`[ENV ERROR] Missing env: ${name}`, {
      hasQBUSINESS_APP_ID: !!process.env.QBUSINESS_APP_ID,
      QBUSINESS_REGION: process.env.QBUSINESS_REGION,
      AWS_REGION: process.env.AWS_REGION,
      NODE_ENV: process.env.NODE_ENV,
      AMPLIFY_ENV: process.env.AMPLIFY_ENV,
    });
    throw new Error(`Missing env: ${name}`);
  }
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * SSEで安全に送る（必ずJSONにして改行や特殊文字で壊れないようにする）
 */
function sseEvent(
  encoder: TextEncoder,
  payload: unknown,
  event?: string
): Uint8Array {
  const lines: string[] = [];
  if (event) lines.push(`event: ${event}`);
  // data は1行にする（JSON.stringifyは改行を \n にするのでOK）
  lines.push(`data: ${JSON.stringify(payload)}`);
  lines.push(""); // blank line = event delimiter
  return encoder.encode(lines.join("\n") + "\n");
}

export async function POST(req: NextRequest) {
  // ✅ まず最初に ENV の見え方をログ（ここが一番効く）
  console.log("[ENV CHECK]", {
    QBUSINESS_APP_ID: process.env.QBUSINESS_APP_ID ? "(set)" : "(missing)",
    QBUSINESS_REGION: process.env.QBUSINESS_REGION ?? null,
    AWS_REGION: process.env.AWS_REGION ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
    AMPLIFY_ENV: process.env.AMPLIFY_ENV ?? null,
  });

  try {
    const { prompt } = await req.json();
    const userMessage = String(prompt ?? "").trim();

    if (!userMessage) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // regionは QBUSINESS_REGION → AWS_REGION → us-east-1 の順で採用
    const region =
      process.env.QBUSINESS_REGION || process.env.AWS_REGION || "us-east-1";

    const applicationId = mustEnv("QBUSINESS_APP_ID");

    const client = new QBusinessClient({ region });

    console.log("[QBusiness] ChatSync start", {
      region,
      applicationId,
      messageLength: userMessage.length,
    });

    const result = await client.send(
      new ChatSyncCommand({
        applicationId,
        userMessage,
      })
    );

    const fullText = (result as any)?.systemMessage ?? "";
    const sources = (result as any)?.sourceAttributions ?? [];
    const encoder = new TextEncoder();

    // ✅ SSEストリーム
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const text = String(fullText ?? "");

          if (!text) {
            controller.enqueue(
              sseEvent(encoder, { error: "Empty response (systemMessage is empty)." }, "error")
            );
            controller.enqueue(sseEvent(encoder, { done: true }, "done"));
            return;
          }

          // 調整可能
          const CHUNK_SIZE = 15;
          const DELAY_MS = 18;

          // 開始イベント（任意：クライアントが状態管理しやすい）
          controller.enqueue(sseEvent(encoder, { started: true }, "start"));

          for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            const chunk = text.slice(i, i + CHUNK_SIZE);

            // ✅ chunk は JSON で送る（改行でも壊れない）
            controller.enqueue(
              sseEvent(encoder, { chunk }, "chunk")
            );

            await sleep(DELAY_MS);
          }

          // sources（任意）
          controller.enqueue(sseEvent(encoder, { sources }, "sources"));

          // 完了
          controller.enqueue(sseEvent(encoder, { done: true }, "done"));
        } catch (err: any) {
          controller.enqueue(
            sseEvent(
              encoder,
              { error: err?.message || String(err) },
              "error"
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-From": "app/api/amazonq/route.ts",
      },
    });
  } catch (error: any) {
    console.error("amazonq api error:", error);

    const message =
      error?.name
        ? `${error.name}: ${error.message || ""}`.trim()
        : error?.message || String(error);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
