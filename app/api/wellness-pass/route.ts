// app/api/wellness-pass/route.ts
//
// 法人ウェルネスパス(福利厚生の外部販売)の全社ダッシュボード(読み取り専用)。
// 外部販売Sys(outsite)を SSHトンネル(knowbie-ssh-db-proxy)経由で読む。
// 集計は lib/wellnessPass(バッチ1トンネル+10分キャッシュ)で共有。
import { NextResponse } from "next/server";
import { getRefundUser } from "@/lib/refundAuth";
import { getWellnessAggregates, isHqUser } from "@/lib/wellnessPass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isHqUser(user)) return NextResponse.json({ ok: false, error: "この機能は本部/全社権限が必要です" }, { status: 403 });

  const agg = await getWellnessAggregates();
  if (!agg.ok) return NextResponse.json({ ok: false, error: `取得に失敗しました: ${agg.error}` }, { status: 502 });
  const d = agg.data;
  return NextResponse.json({
    ok: true,
    monthly: d.monthly,
    totalOrders: d.monthly.reduce((s, m) => s + m.orders, 0),
    totalSales: d.monthly.reduce((s, m) => s + m.sales, 0),
    byProvider: d.byProvider,
    byProduct: d.byProduct,
    byBrand: d.byBrand,
    source: "外部販売Sys (outsite)",
    cached: agg.cached,
  });
}
