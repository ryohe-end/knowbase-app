// knowbie-bedrock-async
// 汎用の Bedrock 非同期生成。SSR(~28s制限)からは async invoke し、結果を DDB(knowbie-ai-jobs)へ。
// input: { jobId, modelId, system, userText, maxTokens }
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.JOBS_TABLE || "knowbie-ai-jobs";
const bedrock = new BedrockRuntimeClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });

async function save(item) {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...item, ttl: Math.floor(Date.now() / 1000) + 3600 } }));
}

export const handler = async (event) => {
  const { jobId, modelId, system, userText, maxTokens } = event || {};
  if (!jobId) return { ok: false, error: "jobId required" };
  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: modelId || "us.anthropic.claude-sonnet-4-6",
      contentType: "application/json", accept: "application/json",
      body: JSON.stringify({ anthropic_version: "bedrock-2023-05-31", max_tokens: maxTokens || 1100, system, messages: [{ role: "user", content: [{ type: "text", text: userText }] }] }),
    }));
    const decoded = JSON.parse(new TextDecoder().decode(res.body));
    const analysis = (decoded.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text).join("").trim();
    await save({ jobId, status: "done", analysis });
    return { ok: true, jobId };
  } catch (e) {
    console.error("[bedrock-async]", e?.message);
    await save({ jobId, status: "error", error: "AI分析の生成に失敗しました" });
    return { ok: false, error: e?.message };
  }
};
