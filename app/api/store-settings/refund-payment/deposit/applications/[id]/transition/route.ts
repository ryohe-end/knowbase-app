// app/api/store-settings/refund-payment/deposit/applications/[id]/transition/route.ts
//
// 入金フローの状態遷移 (2 ステップ):
//   action=submit  申請者(店舗)が下書きを提出 → 受付中
//   action=close   経理が消込実行 → 消込完了
//   action=reject  経理が差戻し
//
// 状態遷移:
//   下書き --submit--> 受付中  (applicant→完了, finance→対応中)
//   受付中 --close-->  消込完了 (finance→完了)
//   受付中 --reject--> 差戻し  (finance→差戻し)
//   差戻し --submit--> 受付中  (再申請)

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, canFinance, isClubInScope } from "@/lib/refundAuth";
import { writeAudit, clientIp } from "@/lib/auditLog";
import type {
  DepositApplication,
  DepositStep,
  DepositStepRole,
  DepositEvent,
} from "@/types/depositApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_DEPOSIT_APPLICATIONS_TABLE || "yamauchi-DepositApplications";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

function nowIso(): string {
  return new Date().toISOString();
}

function setStep(app: DepositApplication, role: DepositStepRole, patch: Partial<DepositStep>) {
  const i = app.steps.findIndex((s) => s.role === role);
  if (i < 0) return;
  app.steps[i] = { ...app.steps[i], ...patch };
}

function appendEvent(app: DepositApplication, ev: DepositEvent) {
  if (!Array.isArray(app.events)) app.events = [];
  app.events.push(ev);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: {
    action?: string;
    comment?: string;
    receiptDate?: string;
    oracleBatchId?: string;
    note?: string;
    failureReason?: string;
    failureDetail?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  const comment = (body.comment ?? "").toString();
  const ts = nowIso();
  const actedAt = ts.slice(0, 16).replace("T", " ");

  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { applicationId: id } }));
    const app = res.Item as DepositApplication | undefined;
    if (!app) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!isClubInScope(user, app.clubCode)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const prevStatus = app.status;

    if (action === "submit") {
      if (app.createdBy !== user.userId && user.role !== "admin") {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      if (app.status === "消込完了") {
        return NextResponse.json({ ok: false, error: "消込完了は再申請できません" }, { status: 400 });
      }
      setStep(app, "applicant", {
        userId: user.userId,
        userName: user.name,
        dept: user.dept ?? "",
        email: user.email,
        state: "完了",
        actedAt,
        comment: comment || "申請しました",
      });
      setStep(app, "finance", { state: "対応中", actedAt: undefined, comment: undefined });
      if (app.status === "差戻し") {
        app.failureReason = undefined;
        app.failureDetail = undefined;
      }
      app.status = "受付中";
      appendEvent(app, {
        at: ts, byUserId: user.userId, byUserName: user.name,
        action: "submit", fromStatus: prevStatus, toStatus: "受付中",
        role: "applicant", comment: comment || undefined,
      });
    } else if (action === "close") {
      if (!canFinance(user)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      if (app.status !== "受付中") {
        return NextResponse.json({ ok: false, error: "受付中のみ消込可能" }, { status: 400 });
      }
      if (!body.receiptDate) {
        return NextResponse.json({ ok: false, error: "receiptDate required" }, { status: 400 });
      }
      setStep(app, "finance", {
        userId: user.userId,
        userName: user.name,
        dept: user.dept ?? "",
        email: user.email,
        state: "完了",
        actedAt,
        comment: comment || "消込完了",
      });
      app.closing = {
        closedAt: ts,
        receiptDate: body.receiptDate,
        oracleBatchId: body.oracleBatchId || "",
        operator: user.name,
        note: body.note,
      };
      app.status = "消込完了";
      appendEvent(app, {
        at: ts, byUserId: user.userId, byUserName: user.name,
        action: "close", fromStatus: prevStatus, toStatus: "消込完了",
        role: "finance", comment: comment || undefined,
        metadata: { receiptDate: body.receiptDate, oracleBatchId: body.oracleBatchId },
      });
    } else if (action === "reject") {
      if (!canFinance(user)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      if (app.status !== "受付中") {
        return NextResponse.json({ ok: false, error: "受付中のみ差戻し可能" }, { status: 400 });
      }
      setStep(app, "finance", {
        userId: user.userId,
        userName: user.name,
        dept: user.dept ?? "",
        email: user.email,
        state: "差戻し",
        actedAt,
        comment: comment || "差戻しました",
      });
      app.failureReason = body.failureReason;
      app.failureDetail = body.failureDetail;
      app.status = "差戻し";
      appendEvent(app, {
        at: ts, byUserId: user.userId, byUserName: user.name,
        action: "reject", fromStatus: prevStatus, toStatus: "差戻し",
        role: "finance", comment: comment || undefined,
      });
    } else {
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }

    const previousUpdatedAt = app.updatedAt;
    app.updatedAt = ts;
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: app,
          ConditionExpression: "updatedAt = :prev",
          ExpressionAttributeValues: { ":prev": previousUpdatedAt },
        })
      );
    } catch (e: any) {
      if (e?.name === "ConditionalCheckFailedException") {
        return NextResponse.json(
          { ok: false, error: "他のユーザにより更新されています。再読込してください" },
          { status: 409 }
        );
      }
      throw e;
    }
    void writeAudit({
      userId: (user as any).email || (user as any).userId || "unknown",
      userName: (user as any).name,
      action: `deposit.${action}`,
      clubCodes: app.clubCode ? [String(app.clubCode)] : undefined,
      resource: `depositApplication:${(app as any).applicationId ?? id}`,
      detail: { toStatus: app.status, memberNo: (app as any).memberNo, amount: (app as any).totalAmount ?? (app as any).amount },
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, application: app });
  } catch (e: any) {
    console.error("[deposit transition] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
