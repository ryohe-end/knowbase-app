// app/api/store-settings/refund-payment/applications/[id]/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import type { RefundApplication } from "@/types/refundApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_REFUND_APPLICATIONS_TABLE || "yamauchi-RefundApplications";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { applicationId: id } }));
    const app = res.Item as RefundApplication | undefined;
    if (!app) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!isClubInScope(user, app.clubCode)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: true, application: app });
  } catch (e: any) {
    console.error("[refund application get] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    // 既存を取得し、スコープ/所有者/状態を確認 (承認フローに乗った申請は本人でも削除不可)
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { applicationId: id } }));
    const app = res.Item as RefundApplication | undefined;
    if (!app) return NextResponse.json({ ok: true }); // 既に無い = 冪等に成功扱い
    if (!isClubInScope(user, app.clubCode)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const isOwnerDeletable =
      app.createdBy === user.userId && (app.status === "下書き" || app.status === "差戻し");
    if (user.role !== "admin" && !isOwnerDeletable) {
      return NextResponse.json(
        { ok: false, error: "この申請は削除できません（自分の下書き/差戻しのみ削除可）" },
        { status: 403 }
      );
    }
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { applicationId: id } }));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[refund application delete] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
