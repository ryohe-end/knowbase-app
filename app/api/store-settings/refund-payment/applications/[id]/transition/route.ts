// app/api/store-settings/refund-payment/applications/[id]/transition/route.ts
//
// 申請ステップの状態遷移を 1 アクション = 1 リクエストで処理する。
//   action=submit         申請者が下書きを提出 (or 差戻し → 再申請)
//   action=approve        承認者 が承認
//   action=reject         承認者/経理が差戻し
//   action=arrange        経理が CSV 出力してバッチに組み入れた (status → 振込手配中)
//   action=transfer       経理が振込結果を記録 (result=成功/失敗)
//
// 状態遷移ルール:
//   下書き --submit--> 承認待ち (applicant step → 完了, approver step → 対応中, finance step → 未対応)
//   承認待ち --approve(approver)-->  承認待ち (approver step → 完了, finance step → 対応中)
//   承認待ち --approve(finance)-->   承認済み (finance step → 完了)
//   承認待ち --reject-->             差戻し  (該当 step → 差戻し)
//   承認待ち --arrange-->           振込手配中 (finance step は対応中のまま)
//   振込手配中 --transfer(成功)-->   承認済み (finance step → 完了)
//   振込手配中 --transfer(失敗)-->   差戻し  (finance step → 差戻し)
//   差戻し  --submit-->              承認待ち (再申請、approver/finance step は再対応中/未対応に巻き戻す)
//
// 同時更新対策: ConditionExpression で updatedAt をチェック (optimistic concurrency)

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, canApprove, canFinance, isClubInScope } from "@/lib/refundAuth";
import { isAdminLike } from "@/lib/roles";
import { writeAudit, clientIp } from "@/lib/auditLog";
import { notifyRefundRejected, notifyRefundSubmitted, notifyRefundReadyForFinance, notifyRefundCompleted } from "@/lib/refundNotify";
import type {
  RefundApplication,
  ApprovalStep,
  StepRole,
  RefundEvent,
} from "@/types/refundApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_REFUND_APPLICATIONS_TABLE || "yamauchi-RefundApplications";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

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

function appendEvent(app: RefundApplication, ev: RefundEvent) {
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
    result?: "成功" | "失敗" | "保留";
    errorCode?: string;
    errorMessage?: string;
    scheduledDate?: string;
    failureReason?: string;
    failureDetail?: string;
    // optimistic concurrency 用 (UI が保持していた updatedAt)
    expectedUpdatedAt?: string;
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

    const prevStatus = app.status;

    if (action === "submit") {
      // 申請者本人 (もしくは admin) のみ
      if (app.createdBy !== user.userId && !isAdminLike(user.role)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      // 提出できるのは「下書き」または「差戻し」のみ。
      // 承認待ち/振込手配中/承認済みからの再送信は承認・経理の進行を巻き戻すため禁止。
      if (app.status !== "下書き" && app.status !== "差戻し") {
        return NextResponse.json(
          { ok: false, error: `${app.status}の申請は再提出できません` },
          { status: 400 }
        );
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
      // 再申請時は approver/finance step を完全に巻き戻す
      setStep(app, "approver", { state: "対応中", actedAt: undefined, comment: undefined });
      setStep(app, "finance",  { state: "未対応", actedAt: undefined, comment: undefined });
      // 振込関連も差戻し→再申請でリセット
      if (app.status === "差戻し") {
        app.transferResult = undefined;
        app.transferErrorCode = undefined;
        app.transferErrorMessage = undefined;
        app.transferAttemptedAt = undefined;
        app.failureReason = undefined;
        app.failureDetail = undefined;
      }
      app.status = "承認待ち";
      appendEvent(app, {
        at: ts, byUserId: user.userId, byUserName: user.name,
        action: "submit", fromStatus: prevStatus, toStatus: "承認待ち",
        role: "applicant", comment: comment || undefined,
      });
    } else if (action === "approve") {
      const approverStep = findStep(app, "approver");
      const financeStep = findStep(app, "finance");
      if (approverStep?.state === "対応中") {
        if (!canApprove(user)) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
        // 自己承認の禁止: 申請者本人 (admin でも) は自分の申請を承認できない
        if (app.createdBy === user.userId) {
          return NextResponse.json(
            { ok: false, error: "申請者本人は承認できません" },
            { status: 403 }
          );
        }
        setStep(app, "approver", {
          userId: user.userId,
          userName: user.name,
          dept: user.dept ?? "",
          email: user.email,
          state: "完了",
          actedAt,
          comment: comment || "承認しました",
        });
        setStep(app, "finance", { state: "対応中" });
        app.status = "承認待ち";
        appendEvent(app, {
          at: ts, byUserId: user.userId, byUserName: user.name,
          action: "approve", fromStatus: prevStatus, toStatus: "承認待ち",
          role: "approver", comment: comment || undefined,
        });
      } else if (financeStep?.state === "対応中") {
        // 経理段階で "approve" は使わない。振込は arrange→transfer で決着させる。
        // (これにより「承認済み」は必ず「振込完了(transfer成功)」を意味する = 二義を解消)
        return NextResponse.json(
          { ok: false, error: "経理は振込実行(transfer)で決着します" },
          { status: 400 }
        );
      } else {
        return NextResponse.json({ ok: false, error: "対応中ステップがありません" }, { status: 400 });
      }
    } else if (action === "reject") {
      // 差戻しは「承認待ち」段階のみ (承認者差戻し / 経理が手配前に差戻し)。
      // 振込手配中の差戻しはバッチ集計を壊すため禁止 (振込失敗は transfer(失敗) で扱う)。
      if (app.status !== "承認待ち") {
        return NextResponse.json(
          { ok: false, error: `${app.status}の申請は差戻しできません` },
          { status: 400 }
        );
      }
      const approverStep = findStep(app, "approver");
      const financeStep = findStep(app, "finance");
      if (approverStep?.state === "対応中") {
        if (!canApprove(user)) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
        setStep(app, "approver", {
          userId: user.userId,
          userName: user.name,
          dept: user.dept ?? "",
          email: user.email,
          state: "差戻し",
          actedAt,
          comment: comment || "差戻しました",
        });
        appendEvent(app, {
          at: ts, byUserId: user.userId, byUserName: user.name,
          action: "reject", fromStatus: prevStatus, toStatus: "差戻し",
          role: "approver", comment: comment || undefined,
        });
      } else if (financeStep?.state === "対応中") {
        if (!canFinance(user)) {
          return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
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
        appendEvent(app, {
          at: ts, byUserId: user.userId, byUserName: user.name,
          action: "reject", fromStatus: prevStatus, toStatus: "差戻し",
          role: "finance", comment: comment || undefined,
        });
      } else {
        return NextResponse.json({ ok: false, error: "対応中ステップがありません" }, { status: 400 });
      }
      app.status = "差戻し";
    } else if (action === "arrange") {
      if (!canFinance(user)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      // 経理ステップが対応中のものだけ手配可
      const financeStep = findStep(app, "finance");
      if (financeStep?.state !== "対応中") {
        return NextResponse.json({ ok: false, error: "経理対応中のみ手配可能" }, { status: 400 });
      }
      // 同一 CSV バッチに属する複数 application はクライアントから同じ batchId を送る
      // ことで束ねる。形式バリデーションのみ。
      const clientBatchId = (body as any).batchId;
      if (clientBatchId && !/^BATCH-[A-Za-z0-9_-]+$/.test(String(clientBatchId))) {
        return NextResponse.json({ ok: false, error: "Invalid batchId" }, { status: 400 });
      }
      app.transferBatchId = clientBatchId || makeBatchId();
      app.transferScheduledDate = body.scheduledDate;
      app.transferArrangedAt = ts;
      app.status = "振込手配中";
      appendEvent(app, {
        at: ts, byUserId: user.userId, byUserName: user.name,
        action: "arrange", fromStatus: prevStatus, toStatus: "振込手配中",
        role: "finance",
        metadata: { batchId: app.transferBatchId, scheduledDate: body.scheduledDate },
      });
    } else if (action === "transfer") {
      if (!canFinance(user)) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      // 振込手配中のものだけ振込結果反映可
      if (app.status !== "振込手配中") {
        return NextResponse.json({ ok: false, error: "振込手配中のみ更新可能" }, { status: 400 });
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
          dept: user.dept ?? "",
          email: user.email,
          state: "完了",
          actedAt,
          comment: comment || "振込完了",
        });
        app.status = "承認済み";
        appendEvent(app, {
          at: ts, byUserId: user.userId, byUserName: user.name,
          action: "transfer", fromStatus: prevStatus, toStatus: "承認済み",
          role: "finance", comment: comment || undefined,
          metadata: { result: "成功" },
        });
      } else if (body.result === "失敗") {
        app.failureReason = body.failureReason;
        app.failureDetail = body.failureDetail;
        setStep(app, "finance", {
          userId: user.userId,
          userName: user.name,
          dept: user.dept ?? "",
          email: user.email,
          state: "差戻し",
          actedAt,
          comment: comment || `振込失敗: ${body.failureReason || body.errorMessage || ""}`,
        });
        app.status = "差戻し";
        appendEvent(app, {
          at: ts, byUserId: user.userId, byUserName: user.name,
          action: "transfer", fromStatus: prevStatus, toStatus: "差戻し",
          role: "finance", comment: comment || undefined,
          metadata: { result: "失敗", failureReason: body.failureReason, failureDetail: body.failureDetail },
        });
      } else {
        return NextResponse.json({ ok: false, error: "result must be 成功 or 失敗" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }

    // 楽観ロック: クライアントが保持していた版(expectedUpdatedAt)があればそれで照合し、
    // 真の同時更新(UI表示中に他者が更新)を検出する。無ければ取得直後の値 (後方互換)。
    const previousUpdatedAt = body.expectedUpdatedAt ?? app.updatedAt;
    app.updatedAt = ts;
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: app,
          // optimistic concurrency: 取得直後の updatedAt と一致するもののみ更新
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

    // ワークフロー通知メール (役割ベース。送信失敗しても遷移は成功扱い)。
    //   申請/再申請 → 承認者、承認者承認 → 経理、振込完了 → 申請者、差戻し/振込失敗 → 申請者。
    try {
      if (app.status === "差戻し") {
        await notifyRefundRejected(app, comment || app.failureDetail || "");
      } else if (action === "submit") {
        await notifyRefundSubmitted(app);
      } else if (action === "approve" && findStep(app, "finance")?.state === "対応中") {
        await notifyRefundReadyForFinance(app);
      } else if (app.status === "承認済み") {
        await notifyRefundCompleted(app);
      }
    } catch (err) {
      console.error("[refund notify] email failed", err);
    }

    void writeAudit({
      userId: (user as any).email || (user as any).userId || "unknown",
      userName: (user as any).name,
      action: `refund.${action}`,
      clubCodes: app.clubCode ? [String(app.clubCode)] : undefined,
      resource: `refundApplication:${app.applicationId ?? id}`,
      detail: {
        toStatus: app.status,
        memberNo: app.memberNo,
        amount: app.totalAmount ?? (app as any).amount,
        batchId: (app as any).transferBatchId ?? undefined,
        transferResult: (app as any).transferResult ?? undefined,
        failureReason: (app as any).failureReason ?? undefined,
      },
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, application: app });
  } catch (e: any) {
    console.error("[refund transition] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

// バッチ ID 生成 (CSV 出力単位)
// サーバレス(複数インスタンス/コールドスタート)でも衝突しないよう乱数サフィックスを使う。
function makeBatchId(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `BATCH-${yyyy}${mm}${dd}-${hh}${mi}-${rand}`;
}
