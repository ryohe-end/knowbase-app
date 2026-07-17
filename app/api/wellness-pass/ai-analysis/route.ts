// app/api/wellness-pass/ai-analysis/route.ts
//
// 法人ウェルネスパスの全社AI分析。lib/wellnessPass(共有キャッシュ)を読み、
// Bedrock(Claude)で 売上トレンド・提供元別動向・商品構成・移動平均・予測・施策提案を生成。
// SSR ~28s対策: 集計はキャッシュ共有(ダッシュボード表示で温まる)、AIはBedrockのみ。
import { NextResponse } from "next/server";
import { getRefundUser } from "@/lib/refundAuth";
import { getWellnessAggregates, isHqUser } from "@/lib/wellnessPass";
import { startAiJob, getAiJob } from "@/lib/aiJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_ID = process.env.OTP_ANALYSIS_MODEL_ID || "us.anthropic.claude-sonnet-4-6";

function addMonths(ym: string, d: number) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}
function thisMonth() { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
function analytics(series: number[]) {
  const n = series.length;
  const ma3 = series.map((_, i) => (i < 2 ? null : Math.round((series[i] + series[i - 1] + series[i - 2]) / 3)));
  const start = series.findIndex((v) => v > 0);
  const xs: number[] = [], ys: number[] = [];
  if (start >= 0) for (let i = start; i < n; i++) { xs.push(i); ys.push(series[i]); }
  const slope = (X: number[], Y: number[]) => { const m = X.length; if (m < 2) return 0; const mx = X.reduce((a, b) => a + b, 0) / m, my = Y.reduce((a, b) => a + b, 0) / m; let nu = 0, de = 0; for (let i = 0; i < m; i++) { nu += (X[i] - mx) * (Y[i] - my); de += (X[i] - mx) ** 2; } return de ? nu / de : 0; };
  const s = slope(xs, ys);
  const level = series.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, n || 1);
  const forecast = [1, 2, 3].map((k) => Math.max(0, Math.round(level + s * k)));
  const trend = s > level * 0.03 ? "上昇" : s < -level * 0.03 ? "下降" : "横ばい";
  return { ma3, forecast, trend };
}

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isHqUser(user)) return NextResponse.json({ ok: false, error: "本部/全社権限が必要です" }, { status: 403 });

  // ポーリング: ジョブ状態を返す
  const poll = new URL(req.url).searchParams.get("poll");
  if (poll) {
    const job = await getAiJob(poll);
    if (!job) return NextResponse.json({ ok: true, status: "pending" });
    return NextResponse.json({ ok: true, ...job });
  }

  const agg = await getWellnessAggregates();
  if (!agg.ok) return NextResponse.json({ ok: false, error: agg.error }, { status: 502 });
  const { monthly: monRaw, provByYm, byProduct } = agg.data;

  const month = thisMonth();
  const byYm = new Map(monRaw.map((r) => [r.ym, r]));
  const monthly: { ym: string; orders: number; sales: number }[] = [];
  for (let i = 11; i >= 0; i--) { const ym = addMonths(month, -i); const it = byYm.get(ym); monthly.push({ ym, orders: it?.orders ?? 0, sales: it?.sales ?? 0 }); }
  const stat = analytics(monthly.map((m) => m.sales));
  const lastYm = monthly[monthly.length - 1].ym;
  const forecast = stat.forecast.map((v, i) => ({ ym: addMonths(lastYm, i + 1), sales: v }));

  const provTrend = monthly.slice(-6).map((m) => {
    const p = provByYm[m.ym] || {};
    const top = Object.entries(p).map(([fs, n]) => ({ fs, n: Number(n) })).sort((a, b) => b.n - a.n).slice(0, 5);
    return { ym: m.ym, top };
  });

  const system = `あなたは法人向け福利厚生「ウェルネスパス」(BenefitOne/ReloClub 等の外部販売サイト経由でジム利用券を販売)の売上アナリストです。全社の月次実績・提供元別動向・商品構成・予測を解釈し、本部担当がすぐ動ける示唆を日本語で簡潔に述べてください。統計予測は参考値なのでAIの見立ても述べること。`;
  const userText = [
    `# 直近6ヶ月(注文数/売上/移動平均):`,
    ...monthly.slice(-6).map((m) => { const i = monthly.indexOf(m); return `- ${m.ym}: ${m.orders}件 / ¥${m.sales.toLocaleString("ja-JP")} / MA¥${stat.ma3[i] != null ? (stat.ma3[i] as number).toLocaleString("ja-JP") : "—"}`; }),
    `# 売上予測(トレンド=${stat.trend}): ${forecast.map((f) => `${f.ym}¥${f.sales.toLocaleString("ja-JP")}`).join(" / ")}`,
    `# 提供元別 注文数の推移(直近6ヶ月):`,
    ...provTrend.map((t) => `- ${t.ym}: ${t.top.map((x) => `${x.fs}${x.n}`).join(" / ") || "—"}`),
    `# 商品構成: ${byProduct.map((r) => `${r.product}${r.count}件`).join(", ")}`,
    ``,
    `以下の3見出しのMarkdownで簡潔に(各2〜3行)。必ず全3見出しを埋めること:`,
    `## 全社サマリーと売上トレンド(移動平均・来月予測の評価)`,
    `## 提供元別の動向と商品構成(伸びている福利厚生プロバイダ・1枚/6枚/11枚)`,
    `## 施策提案(3つ、提供元開拓/商品/販促の具体案)`,
  ].join("\n");

  // 重いBedrock生成は非同期Lambdaへ。即座に jobId + チャートデータ(高速)を返す。
  const jobId = await startAiJob({ system, userText, maxTokens: 1000, modelId: MODEL_ID });
  return NextResponse.json({
    ok: true, pending: true, jobId, month,
    monthly: monthly.map((m, i) => ({ ...m, ma: stat.ma3[i] })), forecast, trend: stat.trend,
  });
}
