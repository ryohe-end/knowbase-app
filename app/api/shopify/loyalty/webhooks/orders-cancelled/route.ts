// app/api/shopify/loyalty/webhooks/orders-cancelled/route.ts
// orders/cancelled webhook。当該注文で行ったポイント利用/付与を cancel_point で戻す（補償）。
// orders-paid が台帳へ保存した hid（transactionId=sfy-use-{id} / sfy-order-{id}）を参照。
// 設計: docs/shopify-loyalty-integration.md §4.6
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { verifyWebhookHmac, getLoyaltyMetafields, setLoyaltyMetafields } from "@/lib/shopify";
import { cancelPoint, fetchLoyalty, cpssShopId, isValidMemberId } from "@/lib/loyaltyCpss";
import { resolveHomeClub } from "@/lib/clubScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const PT_TABLE = process.env.DYNAMO_POINT_TRANSACTIONS_TABLE || "yamauchi-PointTransactions";
const EC_CLUBCODE = process.env.CPSS_EC_CLUBCODE || "";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

async function hidOf(transactionId: string): Promise<string | null> {
  const r = await ddb.send(new GetCommand({ TableName: PT_TABLE, Key: { transactionId } }));
  return (r.Item?.hid as string) || null;
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

  let memberId: string | undefined;
  try {
    memberId = (await getLoyaltyMetafields(customerId)).member_id;
  } catch {
    return NextResponse.json({ ok: false, error: "shopify_error" }, { status: 500 });
  }
  if (!memberId || !isValidMemberId(memberId)) {
    return NextResponse.json({ ok: true, skipped: "not linked" });
  }

  const shopid = cpssShopId(EC_CLUBCODE || (await resolveHomeClub(memberId)));

  // 利用の戻し（顧客にポイントを返す）と付与の取消（誤って付いた分を戻す）
  const jobs: { hid: string; reqid: string; label: string }[] = [];
  const useHid = await hidOf(`sfy-use-${orderId}`);
  if (useHid) jobs.push({ hid: useHid, reqid: `sfy-cancel-use-${orderId}`, label: "use" });
  const grantHid = await hidOf(`sfy-order-${orderId}`);
  if (grantHid) jobs.push({ hid: grantHid, reqid: `sfy-cancel-grant-${orderId}`, label: "grant" });

  if (jobs.length === 0) return NextResponse.json({ ok: true, skipped: "no ledger hid" });

  let lastBalance: number | undefined;
  for (const j of jobs) {
    const c = await cancelPoint({ hid: j.hid, shopid, reqid: j.reqid, reason: `order canceled ${order?.name ?? orderId}` });
    if (!c.ok) {
      console.error("[shopify orders-cancelled] cancelPoint failed:", orderId, j.label, c.error);
      return NextResponse.json({ ok: false, error: c.error }, { status: 500 }); // 冪等・再送で回復
    }
  }

  // 残高をメタフィールドへ最新化（best-effort）
  try {
    const info = await fetchLoyalty(memberId);
    if (info.balance !== null) lastBalance = info.balance;
    await setLoyaltyMetafields(customerId, {
      points: lastBalance,
      rank: info.rank ?? undefined,
      rank_name: info.rankName ?? undefined,
      synced_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[shopify orders-cancelled] metafield refresh failed (cancel OK):", orderId, e);
  }

  return NextResponse.json({ ok: true, canceled: jobs.map((j) => j.label) });
}
