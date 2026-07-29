// app/api/store-settings/refund-payment/my-tasks/route.ts
//
// TOP「対応依頼」欄用: ログインユーザーの返金ワークフロー対応待ちを返す。
//   - approver : 自分が承認できる & 承認ステップ対応中 (承認待ち)
//   - finance  : 自分が経理処理できる & 経理ステップ対応中 (CSV出力待ち/振込手配中)
//   - mine     : 自分の申請で差戻し (要 修正・再申請)
//   GET → { ok, tasks: { approver, finance, mine } }  各 { count, items[] }
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, canApprove, canFinance, isClubInScope } from "@/lib/refundAuth";
import type { RefundApplication } from "@/types/refundApplication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_REFUND_APPLICATIONS_TABLE || "yamauchi-RefundApplications";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const LIMIT = 20;
function brief(it: RefundApplication) {
  return {
    applicationId: it.applicationId,
    clubCode: String(it.clubCode ?? ""),
    memberName: it.memberName ?? "",
    memberNo: it.memberNo ?? "",
    totalAmount: it.totalAmount ?? 0,
    status: it.status,
    createdAt: it.createdAt ?? "",
  };
}

export async function GET() {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let items: RefundApplication[] = [];
  try {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
    items = ((res.Items ?? []) as RefundApplication[]).filter((it) => isClubInScope(user, it.clubCode || ""));
  } catch (e: any) {
    console.error("[refund my-tasks] scan error:", e?.message);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }

  const sortNew = (a: RefundApplication, b: RefundApplication) => (b.createdAt || "").localeCompare(a.createdAt || "");
  const stepState = (it: RefundApplication, role: string) => it.steps?.find((s) => s.role === role)?.state;

  const approverItems = canApprove(user)
    ? items.filter((it) => stepState(it, "approver") === "対応中" && it.createdBy !== user.userId).sort(sortNew)
    : [];
  const financeItems = canFinance(user)
    ? items.filter((it) => stepState(it, "finance") === "対応中").sort(sortNew)
    : [];
  const mineItems = items.filter((it) => it.status === "差戻し" && it.createdBy === user.userId).sort(sortNew);

  return NextResponse.json({
    ok: true,
    tasks: {
      approver: { count: approverItems.length, items: approverItems.slice(0, LIMIT).map(brief) },
      finance: { count: financeItems.length, items: financeItems.slice(0, LIMIT).map(brief) },
      mine: { count: mineItems.length, items: mineItems.slice(0, LIMIT).map(brief) },
    },
  });
}
