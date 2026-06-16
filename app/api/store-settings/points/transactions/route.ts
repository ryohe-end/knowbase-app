// app/api/store-settings/points/transactions/route.ts
//
// ポイント付与 / 取り消しを 1 リクエストで処理。
//   POST {action:"grant",  clubCode, memberCode, points, reason, note?}
//   POST {action:"cancel", clubCode, memberCode, sourceTransactionId, note?}
//
// 取り消しは元 earned トランザクションへの逆方向の adjusted トランザクションを作る。
// 元 tx には cancelledBy / cancelledAt を書き戻し、UI で「取消済」表示できるようにする。

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { POINT_REASONS, type PointReason, type PointTransaction } from "@/types/pointTransaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_POINT_TRANSACTIONS_TABLE || "yamauchi-PointTransactions";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

function nowIso(): string {
  return new Date().toISOString();
}

function newTransactionId(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const uuid = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `PT-${yyyy}${mm}${dd}-${uuid}`;
}

// 一覧取得 (会員別) — GET ?clubCode=&memberCode=
export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const clubCode = sp.get("clubCode") || "";
  const memberCode = sp.get("memberCode") || "";
  if (!clubCode || !memberCode) {
    return NextResponse.json({ ok: false, error: "clubCode and memberCode required" }, { status: 400 });
  }
  if (!isClubInScope(user, clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    // GSI が無い前提なので Scan + filter で取得 (小規模を想定)
    const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
    const items = ((res.Items ?? []) as PointTransaction[]).filter(
      (t) => t.clubCode === clubCode && t.memberCode === memberCode
    );
    items.sort((a, b) => (b.occurredAt || "").localeCompare(a.occurredAt || ""));
    return NextResponse.json({ ok: true, transactions: items });
  } catch (e: any) {
    console.error("[points transactions] GET error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: {
    action?: "grant" | "cancel";
    clubCode?: string;
    memberCode?: string;
    points?: number;
    reason?: PointReason;
    note?: string;
    sourceTransactionId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.clubCode || !body.memberCode) {
    return NextResponse.json({ ok: false, error: "clubCode and memberCode required" }, { status: 400 });
  }
  if (!isClubInScope(user, body.clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const ts = nowIso();
  const action = body.action;

  try {
    if (action === "grant") {
      const points = Number(body.points);
      if (!Number.isFinite(points) || points <= 0) {
        return NextResponse.json({ ok: false, error: "points must be a positive number" }, { status: 400 });
      }
      if (!body.reason || !POINT_REASONS.includes(body.reason)) {
        return NextResponse.json({ ok: false, error: "invalid reason" }, { status: 400 });
      }
      const tx: PointTransaction = {
        transactionId: newTransactionId(),
        clubCode: body.clubCode,
        memberCode: body.memberCode,
        type: "earned",
        points,
        reason: body.reason,
        note: body.note,
        occurredAt: ts,
        operatorId: user.userId,
        operatorName: user.name,
      };
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: tx,
          ConditionExpression: "attribute_not_exists(transactionId)",
        })
      );
      return NextResponse.json({ ok: true, transaction: tx });
    }

    if (action === "cancel") {
      if (!body.sourceTransactionId) {
        return NextResponse.json({ ok: false, error: "sourceTransactionId required" }, { status: 400 });
      }
      // 元トランザクションを取得
      const orig = await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { transactionId: body.sourceTransactionId } })
      );
      const source = orig.Item as PointTransaction | undefined;
      if (!source) {
        return NextResponse.json({ ok: false, error: "source transaction not found" }, { status: 404 });
      }
      if (source.clubCode !== body.clubCode || source.memberCode !== body.memberCode) {
        return NextResponse.json({ ok: false, error: "source mismatch" }, { status: 400 });
      }
      if (source.type !== "earned") {
        return NextResponse.json({ ok: false, error: "earned 以外は取り消せません" }, { status: 400 });
      }
      if (source.cancelledBy) {
        return NextResponse.json({ ok: false, error: "既に取り消されています" }, { status: 400 });
      }

      // 逆方向の adjusted トランザクション
      const tx: PointTransaction = {
        transactionId: newTransactionId(),
        clubCode: body.clubCode,
        memberCode: body.memberCode,
        type: "adjusted",
        points: -source.points,
        reason: source.reason,
        note: body.note ? `取り消し: ${body.note}` : `取り消し (元 ${source.transactionId})`,
        occurredAt: ts,
        operatorId: user.userId,
        operatorName: user.name,
        cancelledOf: source.transactionId,
      };
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: tx,
          ConditionExpression: "attribute_not_exists(transactionId)",
        })
      );

      // 元 tx に cancelledBy / cancelledAt を書き戻す
      const updated: PointTransaction = {
        ...source,
        cancelledBy: tx.transactionId,
        cancelledAt: ts,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: updated }));

      return NextResponse.json({ ok: true, transaction: tx, source: updated });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[points transactions] POST error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
