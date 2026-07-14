// app/api/admin/kb-sync/route.ts
// Bedrock KB のデータソースを再Sync (取り込みジョブ開始) する。
// 前処理Lambdaが新しい Markdown を S3 に増やすので、定期的にこれを叩いて索引へ反映する。
// 認可: isAdminRequest (?token=KB_ADMIN_API_KEY / x-kb-admin-key / 管理Cookie)
import { NextResponse } from "next/server";
import { BedrockAgentClient, StartIngestionJobCommand, ListIngestionJobsCommand } from "@aws-sdk/client-bedrock-agent";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.KB_REGION || process.env.AWS_REGION || "us-east-1";
const KB_ID = process.env.KNOWLEDGE_BASE_ID || "3N515PTP3C";
const DS_ID = process.env.KB_DATA_SOURCE_ID || "JF7IVILG3U";

const client = new BedrockAgentClient({ region: REGION });

async function run(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    // 既に実行中なら二重起動しない
    const running = await client.send(new ListIngestionJobsCommand({
      knowledgeBaseId: KB_ID, dataSourceId: DS_ID,
      filters: [{ attribute: "STATUS", operator: "EQ", values: ["IN_PROGRESS"] }],
      maxResults: 1,
    }));
    if ((running.ingestionJobSummaries?.length ?? 0) > 0) {
      return NextResponse.json({ ok: true, skipped: "already_in_progress" });
    }
    const res = await client.send(new StartIngestionJobCommand({ knowledgeBaseId: KB_ID, dataSourceId: DS_ID }));
    return NextResponse.json({ ok: true, ingestionJobId: res.ingestionJob?.ingestionJobId, status: res.ingestionJob?.status });
  } catch (e: any) {
    // ConflictException(実行中) は正常系扱い
    if (e?.name === "ConflictException") return NextResponse.json({ ok: true, skipped: "conflict" });
    console.error("[kb-sync] error:", e?.name, e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "sync failed" }, { status: 500 });
  }
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
