// app/api/store-settings/refund-payment/applications/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, canApprove, canFinance, isClubInScope } from "@/lib/refundAuth";
import type { RefundApplication, ApprovalStep } from "@/types/refundApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_REFUND_APPLICATIONS_TABLE || "yamauchi-RefundApplications";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// 申請 ID 生成: RF-YYYYMMDD-XXX (XXX は乱数)
function newApplicationId(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `RF-${yyyy}${mm}${dd}-${rand}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureSteps(steps: ApprovalStep[] | undefined): ApprovalStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.filter((s) => s && typeof s === "object");
}

// 一覧 GET
//   ?queue=mine        → 自分が createdBy のもの
//   ?queue=approver    → 承認ステップが対応中のもの (要 approver/admin)
//   ?queue=finance     → 経理ステップが対応中のもの (要 finance/admin)
//   ?queue=all         → 自スコープ内すべて
//   ?status=承認待ち    → status 絞り
//   ?clubCode=xxx      → クラブ絞り
export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const queue = sp.get("queue") || "all";
  const status = sp.get("status");
  const clubCode = sp.get("clubCode");

  if (queue === "approver" && !canApprove(user)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (queue === "finance" && !canFinance(user)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
    let items = (res.Items ?? []) as RefundApplication[];

    // クラブスコープでフィルタ
    items = items.filter((it) => isClubInScope(user, it.clubCode || ""));

    if (clubCode) items = items.filter((it) => it.clubCode === clubCode);
    if (status) items = items.filter((it) => it.status === status);

    if (queue === "mine") {
      items = items.filter((it) => it.createdBy === user.userId);
    } else if (queue === "approver") {
      items = items.filter((it) => {
        const step = it.steps?.find((s) => s.role === "approver");
        return step?.state === "対応中";
      });
    } else if (queue === "finance") {
      items = items.filter((it) => {
        const step = it.steps?.find((s) => s.role === "finance");
        return step?.state === "対応中";
      });
    }

    // 新しい順
    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    return NextResponse.json({ ok: true, applications: items });
  } catch (e: any) {
    console.error("[refund applications] GET error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

// POST: 新規作成 or 上書き保存
// body: Partial<RefundApplication> (applicationId なし=新規、あり=更新)
export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<RefundApplication>;
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

  const application: RefundApplication = {
    applicationId: body.applicationId || newApplicationId(),
    clubCode: body.clubCode,
    status: (body.status as any) || "下書き",

    memberNo: body.memberNo || "",
    memberName: body.memberName || "",
    memberKana: body.memberKana,
    memberPhone: body.memberPhone,
    memberPlan: body.memberPlan,

    targetMonthFrom: body.targetMonthFrom || "",
    targetMonthTo: body.targetMonthTo || "",
    items: Array.isArray(body.items) ? body.items : [],
    totalAmount: Number(body.totalAmount || 0),
    reason: body.reason || "",
    attachments: Array.isArray(body.attachments) ? body.attachments : undefined,

    bankAccount: body.bankAccount,

    steps: ensureSteps(body.steps),

    transferAttemptedAt: body.transferAttemptedAt,
    transferResult: body.transferResult,
    transferErrorCode: body.transferErrorCode,
    transferErrorMessage: body.transferErrorMessage,

    createdBy: isNew ? user.userId : (body.createdBy || user.userId),
    createdByName: isNew ? user.name : (body.createdByName || user.name),
    createdAt: isNew ? now : (body.createdAt || now),
    updatedAt: now,
  };

  try {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: application }));
    return NextResponse.json({ ok: true, application });
  } catch (e: any) {
    console.error("[refund applications] POST error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
