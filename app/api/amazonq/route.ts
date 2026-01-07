// app/api/amazonq/route.ts
import { NextRequest } from "next/server";
import { QBusinessClient, ChatSyncCommand } from "@aws-sdk/client-qbusiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    const userMessage = String(prompt ?? "").trim();
    if (!userMessage) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const region = process.env.QBUSINESS_REGION || "us-east-1";
    const applicationId = mustEnv("QBUSINESS_APP_ID");

    const client = new QBusinessClient({ region });

    // ✅ 非ストリーミングで確実に取得（systemMessage が返る）
    const result = await client.send(
      new ChatSyncCommand({
        applicationId,
        userMessage,
      })
    );

    const fullText = (result as any)?.systemMessage ?? "";
    const sources = (result as any)?.sourceAttributions ?? [];
    const encoder = new TextEncoder();

    // ✅ 擬似ストリーミングSSE（全文を小分けで流す）
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const text = String(fullText);

          if (!text) {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({
                  error: "Empty response (systemMessage is empty).",
                })}\n\n`
              )
            );
            controller.close();
            return;
          }

          // お好みで調整
          const CHUNK_SIZE = 15; // 文字数（小さいほど “打ってる感”）
          const DELAY_MS = 18;   // 遅延（小さいほど速い）

          for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            const chunk = text.slice(i, i + CHUNK_SIZE);
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            await sleep(DELAY_MS);
          }
          controller.enqueue(
  encoder.encode(`event: sources\ndata: ${JSON.stringify(sources)}\n\n`)
);
          controller.enqueue(encoder.encode(`event: done\ndata: [DONE]\n\n`));
        } catch (err: any) {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({
                error: err?.message || String(err),
              })}\n\n`
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
      error?.name ? `${error.name}: ${error.message || ""}`.trim() : error?.message || String(error);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

