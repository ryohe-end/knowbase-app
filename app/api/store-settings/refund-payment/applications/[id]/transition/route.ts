// app/api/store-settings/refund-payment/applications/[id]/transition/route.ts
//
// 申請ステップの状態遷移を 1 アクション = 1 リクエストで処理する。
//   action=submit         申請者が下書きを提出
//   action=approve        承認者 が承認
//   action=reject         承認者/経理が差戻し
//   action=arrange        経理が CSV 出力してバッチに組み入れた (status → 振込手配中)
//   action=transfer       経理が振込結果を記録 (result=成功/失敗)
//
// 状態遷移ルール:
//   下書き --submit--> 承認待ち (applicant step → 完了, approver step → 対応中)
//   承認待ち --approve(approver)-->  承認待ち (approver step → 完了, finance step → 対応中)
//   承認待ち --approve(finance)-->   承認済み (finance step → 完了)
//   承認待ち --reject-->             差戻し  (該当 step → 差戻し)
//   差戻し  --submit-->              承認待ち (resubmit、ステップは再対応中に)

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, canApprove, canFinance, isClubInScope } from "@/lib/refundAuth";
import type { RefundApplication, ApprovalStep, StepRole } from "@/types/refundApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_REFUND_APPLICATIONS_TABLE || "yamauchi-RefundApplications";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function nowIso(): string {
  return new Date().toISOString();
}

function findStep(app: RefundApplication, role: StepRole): ApprovalStep | undefined {
  return app.steps?.find((s) => s.role === role);
}

function setStep(app: RefundApplication, role: StepRole, patch: Partial<ApprovalStep>) {
  const i = app.steps.findIndex((s) => s.role === role);
  if (i < 0) return;
  app.steps[i] = { ...app.steps[i], ...patch };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: {
    action?: string;
    comment?: string;
    result?: "成功" | "失敗" | "保留";
    errorCode?: string;
    errorMessage?: string;
    batchId?: string;
    scheduledDate?: string;
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
    const app = res.Item as RefundApplication | undefined;
    if (!app) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!isClubInScope(user, app.clubCode)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    if (action === "submit") {
      // 申請者本人 (もしくは admin) のみ
      if (app.createdBy !== user.userId && user.role !== "admin") {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      setStep(app, "applicant", {
        userId: user.userId,
        userName: user.name,
        state: "完了",
        actedAt,
        comment: comment || "申請しました",
      });
      setStep(app, "approver", { state: "対応中" });
      setStep(app, "finance", { state: "未対応" });
      app.status = "承認待ち";
    } else if (action === "approve") {
      // 承認者なら承認 step を進める
      const approverStep = findStep(app, "approver");
      const financeStep = findStep(app, "finance");
      if (approverStep?.state === "対応中") {
        if (!canApprove(user)) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
        setStep(app, "approver", {
          userId: user.userId,
          userName: user.name,
          state: "完了",
          actedAt,
          comment: comment || "承認しました",
        });
        setStep(app, "finance", { state: "対応中" });
        app.status = "承認待ち";
      } else if (financeStep?.state === "対応中") {
        if (!canFinance(user)) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
        setStep(app, "finance", {
          userId: user.userId,
          userName: user.name,
          state: "完了",
          actedAt,
          comment: comment || "経理確認しました",
        });
        app.status = "承認済み";
      } else {
        return NextResponse.json({ ok: false, error: "対応中ステップがありません" }, { status: 400 });
      }
    } else if (action === "reject") {
      // 承認 or 経理 のうち対応中の段階を差戻し
      const approverStep = findStep(app, "approver");
      const financeStep = findStep(app, "finance");
      if (approverStep?.state === "対応中") {
        if (!canApprove(user)) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
        setStep(app, "approver", {
          userId: user.userId,
          userName: user.name,
          state: "差戻し",
          actedAt,
          comment: comment || "差戻しました",
        });
      } else if (financeStep?.state === "対応中") {
        if (!canFinance(user)) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
        setStep(app, "finance", {
          userId: user.userId,
          userName: user.name,
          state: "差戻し",
          actedAt,
          comment: comment || "差戻しました",
        });
      } else {
        return NextResponse.json({ ok: false, error: "対応中ステップがありません" }, { status: 400 });
      }
      app.status = "差戻し";
    } else if (action === "arrange") {
      if (!canFinance(user)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      app.transferBatchId = body.batchId;
      app.transferScheduledDate = body.scheduledDate;
      app.transferArrangedAt = ts;
      app.status = "振込手配中";
      // finance step は対応中のまま (CSV を出しただけ)
    } else if (action === "transfer") {
      if (!canFinance(user)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      app.transferAttemptedAt = ts;
      app.transferResult = body.result;
      app.transferErrorCode = body.errorCode;
      app.transferErrorMessage = body.errorMessage;
      if (body.result === "成功") {
        app.transferCompletedAt = ts;
        setStep(app, "finance", {
          userId: user.userId,
          userName: user.name,
          state: "完了",
          actedAt,
          comment: comment || "振込完了",
        });
        app.status = "承認済み";
      } else if (body.result === "失敗") {
        app.failureReason = body.failureReason;
        app.failureDetail = body.failureDetail;
        setStep(app, "finance", {
          userId: user.userId,
          userName: user.name,
          state: "差戻し",
          actedAt,
          comment: comment || `振込失敗: ${body.failureReason || body.errorMessage || ""}`,
        });
        app.status = "差戻し";
      }
    } else {
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }

    app.updatedAt = ts;
    await ddb.send(new PutCommand({ TableName: TABLE, Item: app }));
    return NextResponse.json({ ok: true, application: app });
  } catch (e: any) {
    console.error("[refund transition] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
