// app/api/kb-chat/route.ts
//
// Bedrock Knowledge Base (RAG) チャット。Amazon Q Business から移行。
// マニュアルを前処理して S3(knowbie-preprocessed-manuals) → Bedrock マネージドKBが索引。
//
// マネージドKBは RetrieveAndGenerate 非対応のため、
//   1) Retrieve(managedSearchConfiguration) で関連チャンクを取得
//   2) Claude(Bedrock, InvokeModelWithResponseStream) で出典を踏まえた回答をストリーム生成
// する自前RAG。SSE契約は既存フロント(app/page.tsx)互換:
//   event: sources  data: [{title,url,excerpt}]
//   (default)       data: <回答テキストの断片>
//   event: done     data: [DONE]
//   event: error    data: {error}
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.KB_REGION || process.env.AWS_REGION || "us-east-1";
const KB_ID = process.env.KNOWLEDGE_BASE_ID || "3N515PTP3C";
const MODEL_ID = process.env.KB_MODEL_ID || "us.anthropic.claude-sonnet-4-6";
const NUM_RESULTS = Number(process.env.KB_NUM_RESULTS || 12);
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";

const agent = new BedrockAgentRuntimeClient({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const enc = new TextEncoder();
function sse(event: string | null, data: string): Uint8Array {
  let out = "";
  if (event) out += `event: ${event}\n`;
  for (const ln of String(data ?? "").split("\n")) out += `data: ${ln}\n`;
  out += "\n";
  return enc.encode(out);
}

function manualIdFromUri(uri: string): string {
  const m = uri.match(/manuals\/([^/]+)\.md$/i);
  return m ? m[1] : uri.split("/").pop() || uri;
}

// 出典ID → マニュアルタイトルを best-effort で引く
async function titlesFor(ids: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (ids.length === 0) return map;
  try {
    const res = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [MANUALS_TABLE]: {
            Keys: ids.slice(0, 100).map((id) => ({ manualId: id })),
            ProjectionExpression: "manualId, title",
          },
        },
      })
    );
    for (const it of res.Responses?.[MANUALS_TABLE] ?? []) {
      if (it.manualId) map[String(it.manualId)] = String(it.title ?? it.manualId);
    }
  } catch (e) {
    console.warn("[kb-chat] title lookup failed:", (e as Error)?.message);
  }
  return map;
}

async function pickUserId(req: Request): Promise<string | undefined> {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)kb_user=([^;]+)/);
  if (!m?.[1]) return undefined;
  let raw = m[1];
  try { raw = decodeURIComponent(raw); } catch {}
  const v = await verifySignedValue(raw);
  return v || undefined;
}

function buildPrompt(chunks: { id: string; text: string }[], question: string): { system: string; user: string } {
  const context = chunks
    .map((c, i) => `【資料${i + 1}｜${c.id}】\n${c.text}`)
    .join("\n\n---\n\n");
  const system = `あなたはフィットネスクラブ(JOYFIT / FIT365)の運営マニュアルに詳しい社内アシスタントです。
提供された「参考資料」(社内マニュアルの抜粋)だけを根拠に、日本語で簡潔かつ具体的に回答してください。
ルール:
- 参考資料に書かれている内容だけを使う。推測や一般論で補わない。
- 該当情報が無ければ「マニュアルには該当する記載が見つかりませんでした」と正直に答える。
- 手順は番号付きで分かりやすく。専門用語は噛み砕く。
- 箇条書き・見出しを適度に使い、読みやすくする。`;
  const user = `# 参考資料\n${context}\n\n# 質問\n${question}\n\n参考資料に基づいて回答してください。`;
  return { system, user };
}

export async function POST(req: Request) {
  const userId = await pickUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  let body: { prompt?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    return new Response(JSON.stringify({ ok: false, error: "prompt is required" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 1) 関連チャンクを検索 (マネージドKB)
        const ret = await agent.send(
          new RetrieveCommand({
            knowledgeBaseId: KB_ID,
            retrievalQuery: { text: prompt },
            retrievalConfiguration: { managedSearchConfiguration: { numberOfResults: NUM_RESULTS } },
          })
        );
        const results = ret.retrievalResults ?? [];
        const chunks: { id: string; text: string }[] = [];
        const seen = new Set<string>();
        const bestExcerpt: Record<string, string> = {};
        for (const r of results) {
          const uri = (r.location as any)?.s3Location?.uri || "";
          const id = uri ? manualIdFromUri(uri) : "";
          const text = String((r.content as any)?.text ?? "").trim();
          if (!id || !text) continue;
          chunks.push({ id, text });
          if (!seen.has(id)) { seen.add(id); bestExcerpt[id] = text.slice(0, 300); }
        }

        // 該当なし
        if (chunks.length === 0) {
          controller.enqueue(sse(null, "マニュアルには該当する記載が見つかりませんでした。別のキーワードでお試しください。"));
          controller.enqueue(sse("done", "[DONE]"));
          controller.close();
          return;
        }

        // 2) 出典を先に送る (タイトルは best-effort)
        const ids = [...seen];
        const titles = await titlesFor(ids);
        const sources = ids.map((id) => ({
          title: titles[id] || id,
          url: `/?manual=${encodeURIComponent(id)}`,
          excerpt: bestExcerpt[id] || "",
        }));
        controller.enqueue(sse("sources", JSON.stringify(sources)));

        // 3) Claude で回答をストリーム生成
        const { system, user } = buildPrompt(chunks, prompt);
        const payload = {
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: [{ type: "text", text: user }] }],
        };
        const resp = await bedrock.send(
          new InvokeModelWithResponseStreamCommand({
            modelId: MODEL_ID,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(payload),
          })
        );
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
        console.error("[kb-chat] error:", e?.name, e?.message);
        controller.enqueue(sse("error", JSON.stringify({ error: e?.message || "KB 検索に失敗しました" })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
