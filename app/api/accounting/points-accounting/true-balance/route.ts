// app/api/accounting/points-accounting/true-balance/route.ts
// オンデマンド真残高(D): 1店だけ、会員ごとの実残高(get_member_for_app.balance)を合算し退会者を除外した
// 「現在の真残高」を計算する。全店一斉はやらない(他社CPSS本番への高負荷回避)。
//   POST { clubCode }  … knowbie-points-summary を非同期(trueBalance)invoke → 即 {started:true}
//   GET  ?clubCode=    … 現在月の balanceTrue/at/members を返す(未計算は null)。UIはPOST後これをポーリング。
import { NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { requireAccounting } from "@/lib/accountingAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.POINTS_SUMMARY_FUNCTION || "knowbie-points-summary";
const SUMMARY_TABLE = process.env.SUMMARY_TABLE || "yamauchi-PointSummary";
const CPSS_ENV = (process.env.CPSS_ENV as "stg" | "prod") || "prod";
const lambda = new LambdaClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function thisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: Request) {
  if (!(await requireAccounting())) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: { clubCode?: string } = {};
  try { body = await req.json(); } catch {}
  const clubCode = String(body.clubCode || "").replace(/\D/g, "");
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  try {
    // 非同期(Event)で計算開始。会員数が多い店は数分かかるため、UIはGETでポーリングする。
    await lambda.send(new InvokeCommand({
      FunctionName: FN, InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ trueBalance: true, clubCode, env: CPSS_ENV })),
    }));
    return NextResponse.json({ ok: true, started: true, clubCode, month: thisMonth() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "計算の開始に失敗しました" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!(await requireAccounting())) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const clubCode = (new URL(req.url).searchParams.get("clubCode") || "").replace(/\D/g, "");
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  const month = thisMonth();
  try {
    const r = await ddb.send(new GetCommand({
      TableName: SUMMARY_TABLE, Key: { clubCode, yyyymm: month },
      ProjectionExpression: "balanceTrue, balanceTrueAt, balanceTrueMembers, balanceTrueFailed",
    }));
    const it: any = r.Item || {};
    const has = it.balanceTrue != null;
    return NextResponse.json({
      ok: true, clubCode, month,
      ready: has,
      balanceTrue: has ? Number(it.balanceTrue) : null,
      at: it.balanceTrueAt ?? null,
      members: it.balanceTrueMembers != null ? Number(it.balanceTrueMembers) : null,
      failed: it.balanceTrueFailed != null ? Number(it.balanceTrueFailed) : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
