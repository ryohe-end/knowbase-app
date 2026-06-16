// app/api/store-settings/refund-payment/deposit/applications/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { getRefundUser, canFinance, isClubInScope } from "@/lib/refundAuth";
import type { DepositApplication, DepositStep } from "@/types/depositApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_DEPOSIT_APPLICATIONS_TABLE || "yamauchi-DepositApplications";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

function newApplicationId(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const uuid = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `DP-${yyyy}${mm}${dd}-${uuid}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureSteps(steps: DepositStep[] | undefined): DepositStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.filter((s) => s && typeof s === "object");
}

function computeTotalAmount(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it: any) => sum + (Number(it?.amount) || 0), 0);
}

// 一覧 GET
//   ?queue=mine     → 自分が createdBy のもの
//   ?queue=finance  → 受付中 (経理処理待ち) のもの — finance/admin のみ
//   ?queue=all      → 自スコープ全部
//   ?status=        → status 絞り
//   ?clubCode=      → クラブ絞り
export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const queue = sp.get("queue") || "all";
  const status = sp.get("status");
  const clubCode = sp.get("clubCode");

  if (queue === "finance" && !canFinance(user)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
    let items = (res.Items ?? []) as DepositApplication[];

    items = items.filter((it) => isClubInScope(user, it.clubCode || ""));
    if (clubCode) items = items.filter((it) => it.clubCode === clubCode);
    if (status) items = items.filter((it) => it.status === status);

    if (queue === "mine") {
      items = items.filter((it) => it.createdBy === user.userId);
    } else if (queue === "finance") {
      items = items.filter((it) => {
        const step = it.steps?.find((s) => s.role === "finance");
        return step?.state === "対応中";
      });
    }

    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return NextResponse.json({ ok: true, applications: items });
  } catch (e: any) {
    console.error("[deposit applications] GET error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

// POST: 新規作成 or 上書き保存
export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<DepositApplication>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.clubCode || typeof body.clubCode !== "string") {
    return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  }
  if (!isClubInScope(user, body.clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
  }

  const now = nowIso();
  const isNew = !body.applicationId;

  let existing: DepositApplication | null = null;
  if (!isNew) {
    try {
      const res = await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { applicationId: body.applicationId } })
      );
      existing = (res.Item as DepositApplication | undefined) ?? null;
      if (existing && !isClubInScope(user, existing.clubCode)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      if (existing && existing.createdBy !== user.userId && user.role !== "admin") {
        return NextResponse.json({ ok: false, error: "Forbidden: not owner" }, { status: 403 });
      }
    } catch (e) {
      console.error("[deposit applications] get existing failed", e);
    }
  }

  const items = Array.isArray(body.unpaidItems) ? body.unpaidItems : [];
  // items が指定されていればそこから再計算、なければクライアントが直接入れた金額を採用
  const totalAmount = items.length > 0 ? computeTotalAmount(items) : Number(body.totalAmount) || 0;

  const initialSteps: DepositStep[] = [
    { role: "applicant", userId: user.userId, userName: user.name, dept: user.dept ?? "", email: user.email, state: "未対応" },
    { role: "finance",   userId: "", userName: "", dept: "", email: "", state: "未対応" },
  ];
  const steps = existing
    ? existing.steps
    : (Array.isArray(body.steps) && body.steps.length > 0 ? ensureSteps(body.steps) : initialSteps);

  const application: DepositApplication = {
    applicationId: body.applicationId || newApplicationId(),
    clubCode: body.clubCode,
    status: existing?.status ?? "下書き",

    memberNo: body.memberNo || "",
    memberName: body.memberName || "",
    memberKana: body.memberKana,
    memberPhone: body.memberPhone,
    memberPlan: body.memberPlan,

    unpaidItems: items.length > 0 ? items : undefined,
    totalAmount,
    paymentMethod: body.paymentMethod as DepositApplication["paymentMethod"] | undefined,
    scheduledDate: body.scheduledDate || "",
    memo: body.memo,

    steps,

    closing: existing?.closing,
    failureReason: existing?.failureReason,
    failureDetail: existing?.failureDetail,

    events: existing?.events,

    createdBy: isNew ? user.userId : (existing?.createdBy || user.userId),
    createdByName: isNew ? user.name : (existing?.createdByName || user.name),
    createdAt: isNew ? now : (existing?.createdAt || now),
    updatedAt: now,
  };

  try {
    if (isNew) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: application,
          ConditionExpression: "attribute_not_exists(applicationId)",
        })
      );
    } else {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: application }));
    }
    return NextResponse.json({ ok: true, application });
  } catch (e: any) {
    console.error("[deposit applications] POST error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
