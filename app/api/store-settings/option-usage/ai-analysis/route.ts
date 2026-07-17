// app/api/store-settings/option-usage/ai-analysis/route.ts
//
// オプション都度利用の「AI分析」(店舗単位)。夜間事前集計(yamauchi-OptionUsageSummary)を
// 読み、Bedrock(Claude)で 売れ筋オプション・収入トレンド・移動平均・予測・施策提案を生成。
// 相手DBには一切アクセスしない(自前集計のみ)。
//   GET ?clubCode=905
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { startAiJob, getAiJob } from "@/lib/aiJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const SUMMARY_TABLE = process.env.OPTION_SUMMARY_TABLE || "yamauchi-OptionUsageSummary";
const MODEL_ID = process.env.OTP_ANALYSIS_MODEL_ID || "us.anthropic.claude-sonnet-4-6";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function addMonths(ym: string, d: number) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}
function thisMonth() { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }

// 移動平均(3ヶ月) + 線形トレンド予測(次3ヶ月) on income
function analytics(monthly: { ym: string; income: number }[]) {
  const n = monthly.length;
  const inc = monthly.map((m) => m.income);
  const ma3 = inc.map((_, i) => (i < 2 ? null : Math.round((inc[i] + inc[i - 1] + inc[i - 2]) / 3)));
  const start = inc.findIndex((v) => v > 0);
  const xs: number[] = [], ys: number[] = [];
  if (start >= 0) for (let i = start; i < n; i++) { xs.push(i); ys.push(inc[i]); }
  const slope = (X: number[], Y: number[]) => { const m = X.length; if (m < 2) return 0; const mx = X.reduce((a, b) => a + b, 0) / m, my = Y.reduce((a, b) => a + b, 0) / m; let nu = 0, de = 0; for (let i = 0; i < m; i++) { nu += (X[i] - mx) * (Y[i] - my); de += (X[i] - mx) ** 2; } return de ? nu / de : 0; };
  const s = slope(xs, ys);
  const level = inc.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, n);
  const lastYm = monthly[n - 1].ym;
  const forecast = [1, 2, 3].map((k) => {
    const si = n - 1 + k - 12; let seas = 1;
    if (si >= 0 && ma3[si] && inc[si]) seas = Math.min(1.8, Math.max(0.5, inc[si] / (ma3[si] as number)));
    return { ym: addMonths(lastYm, k), income: Math.max(0, Math.round((level + s * k) * seas)) };
  });
  const trend = s > level * 0.03 ? "上昇" : s < -level * 0.03 ? "下降" : "横ばい";
  return { ma3, forecast, trend, slopePerMonth: Math.round(s) };
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const poll = new URL(req.url).searchParams.get("poll");
  if (poll) {
    const job = await getAiJob(poll);
    if (!job) return NextResponse.json({ ok: true, status: "pending" });
    return NextResponse.json({ ok: true, ...job });
  }

  const clubCode = (new URL(req.url).searchParams.get("clubCode") || "").trim();
  if (!/^\d+$/.test(clubCode)) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) return NextResponse.json({ ok: false, error: "この店舗は担当外です" }, { status: 403 });

  const from = addMonths(thisMonth(), -13);
  let items: any[] = [];
  try {
    const r = await ddb.send(new QueryCommand({ TableName: SUMMARY_TABLE, KeyConditionExpression: "clubCode = :c AND yyyymm >= :from", ExpressionAttributeValues: { ":c": clubCode, ":from": from } }));
    items = r.Items || [];
  } catch { return NextResponse.json({ ok: false, error: "集計データの取得に失敗しました" }, { status: 500 }); }
  if (items.length === 0) return NextResponse.json({ ok: false, error: "この店舗の集計データがまだありません（夜間集計後に利用できます）" }, { status: 404 });

  const byYm = new Map(items.map((it) => [it.yyyymm, it]));
  const month = thisMonth();
  const monthly = [];
  for (let i = 11; i >= 0; i--) { const ym = addMonths(month, -i); const it = byYm.get(ym); monthly.push({ ym, count: it?.count ?? 0, income: it?.income ?? 0 }); }
  const stat = analytics(monthly);
  const curMonth = monthly[monthly.length - 1].income > 0 ? monthly[monthly.length - 1].ym : (byYm.has(month) ? month : addMonths(month, -1));
  const cur = byYm.get(curMonth) || items[items.length - 1];

  // 売れ筋オプション: 直近月ランキング + 直近6ヶ月推移(件数)
  const curOpt = Object.entries((cur?.byOption || {}) as Record<string, { count: number; income: number }>)
    .map(([k, v]) => ({ name: k, count: v.count, income: v.income })).sort((a, b) => b.count - a.count);
  const optTrend = monthly.slice(-6).map((m) => {
    const bo = (byYm.get(m.ym)?.byOption || {}) as Record<string, { count: number }>;
    const top = Object.entries(bo).map(([k, v]) => ({ name: k, c: v.count })).sort((a, b) => b.c - a.c).slice(0, 4);
    return { ym: m.ym, top };
  });

  const system = `あなたはフィットネスクラブの「オプション都度利用」(タンニング/プロテイン/水素水/体組成計 等の1回販売)の売上アナリストです。1店舗の月次実績・売れ筋オプション・移動平均・予測を解釈し、店長がすぐ動ける示唆を日本語で簡潔に述べてください。統計予測は参考値なのでAIとしての見立ても述べること。`;
  const userText = [
    `# 対象店舗: クラブコード ${clubCode}`,
    `# 直近12ヶ月(件数/店舗収入/3ヶ月移動平均):`,
    ...monthly.map((m, i) => `- ${m.ym}: ${m.count}件 / ¥${m.income.toLocaleString("ja-JP")} / MA¥${stat.ma3[i] != null ? (stat.ma3[i] as number).toLocaleString("ja-JP") : "—"}`),
    `# 収入予測(移動平均+トレンド, 参考): トレンド=${stat.trend}`,
    ...stat.forecast.map((f) => `- ${f.ym}: 予測 ¥${f.income.toLocaleString("ja-JP")}`),
    `# 直近月(${curMonth})の売れ筋オプション: ${curOpt.map((o) => `${o.name}${o.count}件`).join(", ") || "—"}`,
    `# 売れ筋オプションの推移(直近6ヶ月):`,
    ...optTrend.map((t) => `- ${t.ym}: ${t.top.map((x) => `${x.name}${x.c}`).join(" / ") || "—"}`),
    ``,
    `以下の4見出しのMarkdownで簡潔に(各2〜3行)。必ず全4見出しを埋めること:`,
    `## 実績サマリーと収入トレンド(移動平均・来月予測の評価)`,
    `## 売れ筋オプション(何が売れているか・構成比・伸びている品目)`,
    `## 客単価・機会損失(伸ばせる余地のあるオプション)`,
    `## 施策提案(3つ、推しオプション/価格/販促の具体案)`,
  ].join("\n");

  const jobId = await startAiJob({ system, userText, maxTokens: 1150, modelId: MODEL_ID });
  return NextResponse.json({
    ok: true, pending: true, jobId, clubCode, month: curMonth,
    monthly: monthly.map((m, i) => ({ ...m, ma: stat.ma3[i] })),
    forecast: stat.forecast, trend: stat.trend,
    topOptions: curOpt.slice(0, 8),
    updatedAt: items[0]?.updatedAt ?? null,
  });
}
