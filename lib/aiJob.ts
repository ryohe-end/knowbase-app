// lib/aiJob.ts
// AI分析(Bedrock)の非同期実行ヘルパー。SSR(~28s制限)から重いBedrock生成を切り離す。
//   startAiJob(): knowbie-bedrock-async を async invoke し jobId を返す(即時)。
//   getAiJob():   knowbie-ai-jobs(DDB) からジョブ状態を読む(ポーリング用)。
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.BEDROCK_ASYNC_FUNCTION || "knowbie-bedrock-async";
const TABLE = process.env.AI_JOBS_TABLE || "knowbie-ai-jobs";
const lambda = new LambdaClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export async function startAiJob(args: { system: string; userText: string; maxTokens?: number; modelId?: string }): Promise<string> {
  const jobId = randomUUID();
  await lambda.send(new InvokeCommand({
    FunctionName: FN,
    InvocationType: "Event", // 非同期(投げっぱなし)
    Payload: Buffer.from(JSON.stringify({ jobId, ...args })),
  }));
  return jobId;
}

export type AiJob = { status: "pending" | "done" | "error"; analysis?: string; error?: string };
export async function getAiJob(jobId: string): Promise<AiJob | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { jobId } }));
  if (!r.Item) return null;
  return { status: r.Item.status, analysis: r.Item.analysis, error: r.Item.error };
}
