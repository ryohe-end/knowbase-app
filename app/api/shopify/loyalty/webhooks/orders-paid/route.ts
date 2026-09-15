// app/api/shopify/loyalty/webhooks/orders-paid/route.ts
// orders/paid webhook。注文の顧客が会員番号連携済みなら CPSS でポイント付与し、
// 台帳(PointTransactions)へ記録する。reqid=sfy-order-{orderId} で冪等。
// 設計: docs/shopify-loyalty-integration.md §4.5
//
// 付与ルール/付与先(shopid)は運用確認事項(Q2/Q3)。環境変数で調整可能にしてある:
//   LOYALTY_POINT_RATE   … 対象額に対する付与率 (既定 0.01 = 1%)
//   CPSS_EC_CLUBCODE     … EC専用clubCode。未設定なら会員の所属クラブ(resolveHomeClub)に付与
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { PointTransaction } from "@/types/pointTransaction";
import { verifyWebhookHmac, getLoyaltyMetafields, setLoyaltyMetafields } from "@/lib/shopify";
import { grantPoint, usePoint, cpssShopId, isValidMemberId } from "@/lib/loyaltyCpss";
import { resolveHomeClub } from "@/lib/clubScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const PT_TABLE = process.env.DYNAMO_POINT_TRANSACTIONS_TABLE || "yamauchi-PointTransactions";
const POINT_RATE = Number(process.env.LOYALTY_POINT_RATE || "0.01");
const EC_CLUBCODE = process.env.CPSS_EC_CLUBCODE || "";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

// 付与対象額: 税・送料を除いた小計。JPY は小数なしなので floor で確定。
function eligibleAmount(order: any): number {
  const sub = Number(order?.subtotal_price ?? order?.current_subtotal_price ?? 0);
  return Number.isFinite(sub) && sub > 0 ? sub : 0;
}

// カート属性 loyalty_points_used は注文の note_attributes に入る。利用ポイント(=円)を取り出す。
function usedPointsFromOrder(order: any): number {
  const attrs = Array.isArray(order?.note_attributes) ? order.note_attributes : [];
  const hit = attrs.find((a: any) => a?.name === "loyalty_points_used");
  const n = Math.floor(Number(hit?.value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookHmac(raw, req.headers.get("x-shopify-hmac-sha256"))) {
    return NextResponse.json({ ok: false, error: "invalid hmac" }, { status: 401 });
  }

  let order: any;
  try {
    order = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const customerId = order?.customer?.id;
  const orderId = order?.id;
  if (!customerId || !orderId) return NextResponse.json({ ok: true, skipped: "no customer/order" });

  // 会員番号連携済みか
  let memberId: string | undefined;
  try {
    memberId = (await getLoyaltyMetafields(customerId)).member_id;
  } catch {
    return NextResponse.json({ ok: false, error: "shopify_error" }, { status: 500 }); // 再送で回復
  }
  if (!memberId || !isValidMemberId(memberId)) {
    return NextResponse.json({ ok: true, skipped: "not linked" });
  }

  const club = EC_CLUBCODE || (await resolveHomeClub(memberId));
  const shopid = cpssShopId(club);
  const ts = new Date().toISOString();
  let latestBalance: number | undefined;

  // --- (1) ポイント利用（減算）: カートで指定された分を決済後に確定 ---
  const usedPoints = usedPointsFromOrder(order);
  if (usedPoints > 0) {
    const useReqid = `sfy-use-${orderId}`; // 冪等キー
    const u = await usePoint({
      memberId,
      shopid,
      point: usedPoints,
      reqid: useReqid,
      scode: "EC",
      svalue: `EC redeem ${order?.name ?? orderId}`,
    });
    if (!u.ok) {
      // 冪等なので再送で回復（残高不足等の恒久エラーは Shopify リトライ満了＋ログで検知）
      console.error("[shopify orders-paid] usePoint failed:", orderId, u.error);
      return NextResponse.json({ ok: false, error: u.error }, { status: 500 });
    }
    if (typeof u.balance === "number") latestBalance = u.balance;
    try {
      const useTx: PointTransaction = {
        transactionId: useReqid,
        clubCode: club,
        memberCode: memberId,
        type: "used",
        points: -usedPoints,
        note: `EC利用 ${order?.name ?? orderId}`,
        occurredAt: ts,
        operatorId: "system:shopify",
        operatorName: "Shopify EC",
        hid: u.hid, // cancel_point 用
        cpssBalanceAfter: u.balance,
      };
      await ddb.send(new PutCommand({ TableName: PT_TABLE, Item: useTx }));
    } catch (e) {
      console.error("[shopify orders-paid] ledger(use) write failed (usePoint OK):", orderId, e);
    }
  }

  // --- (2) ポイント付与 ---
  const amount = eligibleAmount(order);
  const point = Math.floor(amount * POINT_RATE);
  if (point <= 0) {
    if (latestBalance !== undefined) {
      try { await setLoyaltyMetafields(customerId, { points: latestBalance, synced_at: ts }); } catch {}
    }
    return NextResponse.json({ ok: true, used: usedPoints, granted: 0, balance: latestBalance });
  }

  const reqid = `sfy-order-${orderId}`; // 冪等キー（再送・二重付与防止）

  const g = await grantPoint({
    memberId,
    shopid,
    point,
    reqid,
    scode: "EC",
    svalue: `EC purchase ${order?.name ?? orderId}`,
  });
  if (!g.ok) {
    // CPSS一時障害は再送に委ねる（冪等なので二重付与にならない）
    console.error("[shopify orders-paid] givePoint failed:", orderId, g.error);
    return NextResponse.json({ ok: false, error: g.error }, { status: 500 });
  }

  if (typeof g.balance === "number") latestBalance = g.balance;

  // 残高をメタフィールドへ反映（失敗しても付与は成立。次回 /status で回復）
  try {
    await setLoyaltyMetafields(customerId, {
      points: latestBalance,
      synced_at: ts,
    });
  } catch (e) {
    console.error("[shopify orders-paid] metafield update failed (grant OK):", orderId, e);
  }

  // 台帳記録（best-effort。既存 bulk-grant と同じ扱い）
  const tx: PointTransaction = {
    transactionId: reqid,
    clubCode: club,
    memberCode: memberId,
    type: "earned",
    points: point,
    reason: "その他",
    note: `EC購入 ${order?.name ?? orderId}`,
    occurredAt: ts,
    operatorId: "system:shopify",
    operatorName: "Shopify EC",
    hid: g.hid,
    cpssBalanceAfter: g.balance,
  };
  try {
    await ddb.send(new PutCommand({ TableName: PT_TABLE, Item: tx }));
  } catch (e) {
    console.error("[shopify orders-paid] ledger write failed (grant OK):", orderId, e);
  }

  return NextResponse.json({ ok: true, used: usedPoints, granted: point, balance: latestBalance });
}
