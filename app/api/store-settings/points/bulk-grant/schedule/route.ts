// app/api/store-settings/points/bulk-grant/schedule/route.ts
//
// ポイント一括付与の「予約付与」ジョブ管理。
//   POST   { clubCode, memberCodes[], points, reason, note?, scheduledAt(ISO) } → ジョブ作成(status=pending)
//   GET    ?clubCode= → 自分のスコープ内の予約/実行済みジョブ一覧
//   DELETE ?jobId=    → 未実行(pending)ジョブの取消
// 実行は定期Lambda knowbie-points-grant-scheduler が scheduledAt 到来時に CPSS 付与する。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { getClubBusinessType, cpssBrandForBusinessType } from "@/lib/clubScope";
import { writeAudit, clientIp } from "@/lib/auditLog";
import { POINT_REASONS, type PointReason } from "@/types/pointTransaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_POINT_GRANT_JOBS_TABLE || "yamauchi-PointGrantJobs";
const CPSS_ENV = (process.env.CPSS_ENV as "stg" | "prod") || "stg";
const MAX_MEMBERS = 20000;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { clubCode?: string; memberCodes?: string[]; points?: number; reason?: PointReason; note?: string; scheduledAt?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  if (!body.clubCode || !isClubInScope(user, body.clubCode)) {
    return NextResponse.json({ ok: false, error: "この店舗は担当クラブ外です" }, { status: 403 });
  }
  const points = Number(body.points);
  if (!Number.isInteger(points) || points <= 0) return NextResponse.json({ ok: false, error: "points must be a positive integer" }, { status: 400 });
  if (!body.reason || !POINT_REASONS.includes(body.reason)) return NextResponse.json({ ok: false, error: "invalid reason" }, { status: 400 });
  const memberCodes = Array.isArray(body.memberCodes) ? [...new Set(body.memberCodes.map((s) => String(s).trim()).filter((s) => /^\d{4,}$/.test(s)))] : [];
  if (memberCodes.length === 0) return NextResponse.json({ ok: false, error: "memberCodes required" }, { status: 400 });
  if (memberCodes.length > MAX_MEMBERS) return NextResponse.json({ ok: false, error: `対象は${MAX_MEMBERS}件までです` }, { status: 400 });

  const scheduledAt = String(body.scheduledAt || "");
  const t = Date.parse(scheduledAt);
  if (!t || Number.isNaN(t)) return NextResponse.json({ ok: false, error: "scheduledAt(ISO) required" }, { status: 400 });
  if (t < Date.now() - 60_000) return NextResponse.json({ ok: false, error: "予約日時は未来を指定してください" }, { status: 400 });

  const brand = cpssBrandForBusinessType(await getClubBusinessType(body.clubCode));
  const jobId = `PGJ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const item = {
    jobId, status: "pending",
    clubCode: String(body.clubCode), brand, env: CPSS_ENV,
    memberCodes, memberCount: memberCodes.length,
    points, reason: body.reason, note: body.note,
    scheduledAt: new Date(t).toISOString(),
    createdBy: user.userId, createdByName: user.name, createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

  void writeAudit({
    userId: user.email || user.userId, userName: user.name,
    action: "points.bulkGrant.schedule", clubCodes: [String(body.clubCode)],
    targetCount: memberCodes.length, result: "ok",
    detail: { jobId, points, reason: body.reason, scheduledAt: item.scheduledAt }, ip: clientIp(req),
  });

  return NextResponse.json({ ok: true, jobId, scheduledAt: item.scheduledAt, memberCount: memberCodes.length });
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const clubCode = new URL(req.url).searchParams.get("clubCode") || "";

  const jobs: any[] = [];
  let lastKey: any;
  do {
    const r: any = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
    for (const it of r.Items || []) jobs.push(it);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  // 担当スコープ内 + (指定時は)対象店舗のみ。memberCodes 本体は返さない(軽量化)。
  const visible = jobs
    .filter((j) => isClubInScope(user, String(j.clubCode)))
    .filter((j) => !clubCode || String(j.clubCode) === clubCode)
    .map((j) => ({
      jobId: j.jobId, status: j.status, clubCode: j.clubCode, points: j.points, reason: j.reason, note: j.note,
      memberCount: j.memberCount ?? (Array.isArray(j.memberCodes) ? j.memberCodes.length : 0),
      scheduledAt: j.scheduledAt, createdByName: j.createdByName, createdAt: j.createdAt,
      granted: j.granted, failed: j.failed, finishedAt: j.finishedAt,
    }))
    .sort((a, b) => (b.scheduledAt || "").localeCompare(a.scheduledAt || ""));

  return NextResponse.json({ ok: true, jobs: visible });
}

export async function DELETE(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const jobId = new URL(req.url).searchParams.get("jobId") || "";
  if (!jobId) return NextResponse.json({ ok: false, error: "jobId required" }, { status: 400 });

  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: { jobId },
      UpdateExpression: "SET #s = :c, canceledAt = :t, canceledBy = :u",
      ConditionExpression: "#s = :p",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":c": "canceled", ":t": new Date().toISOString(), ":u": user.userId, ":p": "pending" },
    }));
  } catch (e: any) {
    if (e?.name === "ConditionalCheckFailedException") return NextResponse.json({ ok: false, error: "実行済み/取消済みのため取り消せません" }, { status: 409 });
    throw e;
  }
  return NextResponse.json({ ok: true, jobId });
}
