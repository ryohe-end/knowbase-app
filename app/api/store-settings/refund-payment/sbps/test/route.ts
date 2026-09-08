// app/api/store-settings/refund-payment/sbps/test/route.ts
// SBPS 返金API 疎通テスト経路。
//   GET  → 設定状況(env登録有無) + 全額/部分返金のドライランXML/ハッシュ見本
//   POST → 返金要求。既定は dryRun=true(送信しない)。実送信は dryRun:false を明示 + 実行者承認前提。
// 認証は既存の返金機能と同じ getRefundUser。実送信は監査ログに記録。
import { NextResponse } from "next/server";
import { getRefundUser } from "@/lib/refundAuth";
import { writeAudit, clientIp } from "@/lib/auditLog";
import {
  loadSbpsConfig, isSbpsConfigured, sbpsRefundFull, sbpsRefundPartial,
  SBPS_ID_REFUND_FULL, SBPS_ID_REFUND_PARTIAL, type SbpsEnv,
} from "@/lib/sbps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const env = ((new URL(req.url).searchParams.get("env") as SbpsEnv) || "stg");
  const cfg = loadSbpsConfig(env);
  const configured = isSbpsConfigured(cfg);

  // ダミー識別子でドライランXML/ハッシュを生成(送信しないので安全)。実関数を dryRun で通し、
  // サンプルが実際の返金リクエスト組み立てと常に一致するようにする。
  const sample = { trackingId: "00005837727386", custCode: "SAMPLE_CUST_0001" };
  const cfgOrDummy: any = configured ? cfg : { ...cfg, merchantId: cfg.merchantId || "00000", serviceId: cfg.serviceId || "000", hashKey: cfg.hashKey || "DUMMY_HASHKEY" };
  const sampleFull = await sbpsRefundFull(cfgOrDummy, sample, { dryRun: true });
  const samplePartial = await sbpsRefundPartial(cfgOrDummy, sample, 500, { dryRun: true });

  return NextResponse.json({
    ok: true,
    env,
    configured,
    missing: configured ? [] : ["endpoint", "merchantId", "serviceId", "hashKey", "basicId", "basicPass"]
      .filter((k) => !(cfg as any)[k]),
    note: "実送信は POST {op, trackingId, amount?, custCode?, orderId?, spsTransactionId?, env, dryRun:false}。既定は dryRun。返金は tracking_id 主キー。フィールド順は公式IF仕様(PDF)と要照合。",
    sample: {
      full: { id: SBPS_ID_REFUND_FULL, xml: sampleFull.requestXml },
      partial: { id: SBPS_ID_REFUND_PARTIAL, xml: samplePartial.requestXml },
    },
  });
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 }); }

  const env: SbpsEnv = body?.env === "prod" ? "prod" : "stg";
  const op = String(body?.op ?? "full");
  const spsTransactionId = String(body?.spsTransactionId ?? "").trim();
  const trackingId = String(body?.trackingId ?? "").trim();
  const custCode = String(body?.custCode ?? "").trim();
  const orderId = String(body?.orderId ?? "").trim();
  const amount = Number(body?.amount);
  const dryRun = body?.dryRun !== false; // 既定 true。実送信は明示 false のみ。

  if (!trackingId) {
    return NextResponse.json({ ok: false, error: "trackingId(元決済の res_tracking_id) は必須です" }, { status: 400 });
  }
  if (op === "partial" && !(Number.isFinite(amount) && amount > 0)) {
    return NextResponse.json({ ok: false, error: "部分返金には正の amount が必要です" }, { status: 400 });
  }

  const cfg = loadSbpsConfig(env);
  if (!dryRun && !isSbpsConfigured(cfg)) {
    return NextResponse.json({ ok: false, error: `SBPS(${env}) の設定(env変数)が未登録です` }, { status: 400 });
  }

  const target = {
    trackingId,
    ...(spsTransactionId ? { spsTransactionId } : {}),
    ...(custCode ? { custCode } : {}),
    ...(orderId ? { orderId } : {}),
  };
  const result = op === "partial"
    ? await sbpsRefundPartial(cfg, target, amount, { dryRun })
    : await sbpsRefundFull(cfg, target, { dryRun });

  // 実送信のみ監査記録(dryRunは記録しない)。
  if (!dryRun) {
    await writeAudit({
      userId: user.email, userName: user.name,
      action: `sbps.refund.${op}`,
      resource: `sbps:${env}:${trackingId}`,
      clubCodes: [],
      detail: { env, op, spsTransactionId, trackingId, amount: op === "partial" ? amount : undefined, result: result.result, errCode: result.errCode },
      ip: clientIp(req),
      result: result.ok ? "ok" : "error",
    });
  }

  return NextResponse.json({
    ok: result.ok,
    dryRun,
    env,
    op,
    result: result.result,
    errCode: result.errCode,
    status: result.status,
    requestXml: result.requestXml,
    response: dryRun ? undefined : result.fields,
  });
}
