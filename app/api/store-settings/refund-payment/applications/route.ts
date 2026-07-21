// app/api/store-settings/refund-payment/applications/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { getRefundUser, canApprove, canFinance, isClubInScope } from "@/lib/refundAuth";
import { isAdminLike } from "@/lib/roles";
import { writeAudit, clientIp } from "@/lib/auditLog";
import type { RefundApplication, ApprovalStep } from "@/types/refundApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_REFUND_APPLICATIONS_TABLE || "yamauchi-RefundApplications";

// removeUndefinedValues を有効化しないと、optional フィールドが undefined のままで
// PutCommand が throw する。
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

// 申請 ID 生成: RF-YYYYMMDD-<uuid8> (衝突しないよう uuid 由来)
function newApplicationId(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const uuid = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `RF-${yyyy}${mm}${dd}-${uuid}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureSteps(steps: ApprovalStep[] | undefined): ApprovalStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.filter((s) => s && typeof s === "object");
}

// items から合計金額を再計算 (クライアント値は信頼しない)
function computeTotalAmount(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it: any) => sum + (Number(it?.amount) || 0), 0);
}

// 一覧 GET
//   ?queue=mine        → 自分が createdBy のもの
//   ?queue=approver    → 承認ステップが対応中のもの (要 approver/admin)
//   ?queue=finance     → 経理ステージ到達済み全件 (経理待ち/手配中/振込完了/経理差戻し) (要 finance)
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
      // 経理ステージに到達した申請すべて (経理待ち=対応中 / 手配中 / 振込完了=完了 / 経理差戻し)。
      // finance step が「未対応」= まだ経理に回っていない (下書き/承認待ち[承認者対応中]/承認者差戻し) は除外。
      items = items.filter((it) => {
        const step = it.steps?.find((s) => s.role === "finance");
        return !!step && step.state !== "未対応";
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
//
// 更新時は status/steps を既存値ベースに維持し、申請者が編集できるフィールド
// (memberNo, items, reason, bankAccount, targetMonth*) だけを差し替える。
// status 遷移は /transition で行う。
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

  // 更新の場合は既存を取得して差分マージ。steps は保護する。
  let existing: RefundApplication | null = null;
  if (!isNew) {
    try {
      const res = await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { applicationId: body.applicationId } })
      );
      existing = (res.Item as RefundApplication | undefined) ?? null;
      if (existing && !isClubInScope(user, existing.clubCode)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      if (existing && existing.createdBy !== user.userId && !isAdminLike(user.role)) {
        return NextResponse.json({ ok: false, error: "Forbidden: not owner" }, { status: 403 });
      }
    } catch (e) {
      console.error("[refund applications] get existing failed", e);
    }
  }

  const items = Array.isArray(body.items) ? body.items : [];
  // 金額検証: 各返金項目は 0 より大きい有限値であること (0/負数/NaN を拒否)。
  for (const it of items) {
    const amt = Number(it?.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json(
        { ok: false, error: `返金額が不正です（各項目は0より大きい必要があります）: ${it?.label ?? ""}` },
        { status: 400 }
      );
    }
  }
  const totalAmount = computeTotalAmount(items);

  // 新規の場合は draft step 3 件を作成。既存は step を保持。
  const initialSteps: ApprovalStep[] = [
    { role: "applicant", userId: user.userId, userName: user.name, dept: user.dept ?? "", email: user.email, state: "未対応" },
    { role: "approver",  userId: "", userName: "", dept: "", email: "", state: "未対応" },
    { role: "finance",   userId: "", userName: "", dept: "", email: "", state: "未対応" },
  ];
  const steps = existing
    ? existing.steps
    : (Array.isArray(body.steps) && body.steps.length > 0 ? ensureSteps(body.steps) : initialSteps);

  const application: RefundApplication = {
    applicationId: body.applicationId || newApplicationId(),
    clubCode: body.clubCode,
    // status 遷移は /transition で行うので、ここでは既存値か "下書き" を維持。
    // 更新時に body.status を採用すると ロール跨ぎで状態を直接書き換えられるため
    // 既存値を優先する。
    status: existing?.status ?? "下書き",

    memberNo: body.memberNo || "",
    memberName: body.memberName || "",
    memberKana: body.memberKana,
    memberPhone: body.memberPhone,
    memberPlan: body.memberPlan,

    targetMonthFrom: body.targetMonthFrom || "",
    targetMonthTo: body.targetMonthTo || "",
    items,
    totalAmount,
    reason: body.reason || "",
    attachments: Array.isArray(body.attachments) ? body.attachments : undefined,

    bankAccount: body.bankAccount,

    steps,

    transferAttemptedAt: existing?.transferAttemptedAt,
    transferResult: existing?.transferResult,
    transferErrorCode: existing?.transferErrorCode,
    transferErrorMessage: existing?.transferErrorMessage,
    transferBatchId: existing?.transferBatchId,
    transferScheduledDate: existing?.transferScheduledDate,
    transferArrangedAt: existing?.transferArrangedAt,
    transferCompletedAt: existing?.transferCompletedAt,
    failureReason: existing?.failureReason,
    failureDetail: existing?.failureDetail,

    createdBy: isNew ? user.userId : (existing?.createdBy || user.userId),
    createdByName: isNew ? user.name : (existing?.createdByName || user.name),
    createdAt: isNew ? now : (existing?.createdAt || now),
    updatedAt: now,
  };

  try {
    if (isNew) {
      // 新規は ID 衝突保護 (uuid なので実質衝突しないが念のため)
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
    void writeAudit({
      userId: (user as any).email || user.userId || "unknown",
      userName: user.name,
      action: isNew ? "refund.create" : "refund.update",
      clubCodes: body.clubCode ? [String(body.clubCode)] : undefined,
      resource: `refundApplication:${application.applicationId}`,
      detail: { memberNo: application.memberNo, amount: totalAmount, status: application.status },
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, application });
  } catch (e: any) {
    console.error("[refund applications] POST error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
