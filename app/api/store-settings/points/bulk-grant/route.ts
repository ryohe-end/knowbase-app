// app/api/store-settings/points/bulk-grant/route.ts
//
// ポイント一括付与: フィルタ抽出した複数会員へ、全員同額のポイントを CPSS で付与する。
//   POST { batchId, clubCode, memberCodes:[...], points, reason, note? }
//     → memberCodes を1件ずつ CPSS givePoint + 台帳(PointTransactions)記録。
//       reqid = `${batchId}-${memberCode}` で冪等(同一バッチの再送は二重付与しない)。
//     → { ok, granted, failed, results:[{memberCode, ok, error?}] }
// 大量になるため、1リクエストの上限は CHUNK 件。画面側が分割して進捗表示する。
// 単体付与(transactions route)と同じ安全設計: 担当スコープ・理由必須・監査ログ。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { getClubBusinessType, cpssBrandForBusinessType, resolveHomeClub } from "@/lib/clubScope";
import { cpssCall } from "@/lib/cpssProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";
import { POINT_REASONS, type PointReason, type PointTransaction } from "@/types/pointTransaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_POINT_TRANSACTIONS_TABLE || "yamauchi-PointTransactions";
const CPSS_ENV = (process.env.CPSS_ENV as "stg" | "prod") || "stg";
const cpssShopId = (c: string) => (CPSS_ENV === "prod" ? String(c).replace(/\D/g, "").padStart(6, "0") : String(c));
const CHUNK = 50; // 1リクエストで付与する上限件数(タイムアウト回避。画面が分割送信)

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: {
    batchId?: string;
    clubCode?: string;
    memberCodes?: string[];
    points?: number;
    reason?: PointReason;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const batchId = String(body.batchId || "").trim();
  if (!batchId || !/^[A-Za-z0-9:_-]{6,64}$/.test(batchId)) {
    return NextResponse.json({ ok: false, error: "batchId required" }, { status: 400 });
  }
  if (!body.clubCode) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  const points = Number(body.points);
  if (!Number.isFinite(points) || points <= 0 || !Number.isInteger(points)) {
    return NextResponse.json({ ok: false, error: "points must be a positive integer" }, { status: 400 });
  }
  if (!body.reason || !POINT_REASONS.includes(body.reason)) {
    return NextResponse.json({ ok: false, error: "invalid reason" }, { status: 400 });
  }
  const memberCodes = Array.isArray(body.memberCodes)
    ? [...new Set(body.memberCodes.map((s) => String(s).trim()).filter((s) => /^\d{4,}$/.test(s)))]
    : [];
  if (memberCodes.length === 0) return NextResponse.json({ ok: false, error: "memberCodes required" }, { status: 400 });
  if (memberCodes.length > CHUNK) {
    return NextResponse.json({ ok: false, error: `1リクエストは${CHUNK}件までです`, limit: CHUNK }, { status: 400 });
  }
  if (!isClubInScope(user, body.clubCode)) {
    return NextResponse.json({ ok: false, error: "この店舗は担当クラブ外です" }, { status: 403 });
  }

  const ts = new Date().toISOString();
  const results: { memberCode: string; ok: boolean; error?: string }[] = [];
  let granted = 0;
  let failed = 0;

  for (const memberCode of memberCodes) {
    try {
      // 会員の所属クラブを正として shopid/ブランド/スコープを決める(単体付与と同一)。
      const club = await resolveHomeClub(memberCode);
      if (!isClubInScope(user, club)) {
        results.push({ memberCode, ok: false, error: "担当クラブ外" });
        failed++;
        continue;
      }
      const brand = cpssBrandForBusinessType(await getClubBusinessType(club));
      const transactionId = `${batchId}-${memberCode}`; // 冪等キー(reqid)
      const cp = await cpssCall(brand, CPSS_ENV, "givePoint", {
        aid: memberCode,
        shopid: cpssShopId(club),
        point: points,
        reqid: transactionId,
        scode: "MANUAL",
        svalue: body.reason,
      });
      if (!cp.ok) {
        results.push({ memberCode, ok: false, error: cp.cpssMsg || cp.error });
        failed++;
        continue;
      }
      const tx: PointTransaction = {
        transactionId,
        clubCode: club,
        memberCode,
        type: "earned",
        points,
        reason: body.reason,
        note: body.note,
        occurredAt: ts,
        operatorId: user.userId,
        operatorName: user.name,
        hid: cp.result?.hid,
        cpssBalanceAfter: typeof cp.result?.balance === "number" ? cp.result.balance : undefined,
      };
      try {
        await ddb.send(new PutCommand({ TableName: TABLE, Item: tx }));
      } catch (e) {
        console.error("[points bulk-grant] ledger write failed (CPSS付与は成立):", memberCode, e);
      }
      results.push({ memberCode, ok: true });
      granted++;
    } catch (e: any) {
      results.push({ memberCode, ok: false, error: e?.message || "error" });
      failed++;
    }
  }

  void writeAudit({
    userId: user.email || user.userId,
    userName: user.name,
    action: "points.bulkGrant",
    clubCodes: [body.clubCode],
    targetCount: memberCodes.length,
    result: failed > 0 ? "error" : "ok",
    detail: { batchId, points, reason: body.reason, granted, failed },
    ip: clientIp(req),
  });

  return NextResponse.json({ ok: true, batchId, granted, failed, results });
}
