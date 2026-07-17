// app/api/store-settings/onetime-pass/ai-analysis/route.ts
//
// 1day/OneTimePass の「AI売上分析」(店舗単位)。夜間事前集計(yamauchi-OneTimePassSummary)を
// 読み、Bedrock(Claude)で売上傾向・需要パターン・客層・施策提案を生成する。
// あちらの本番DBには一切アクセスしない(自前集計のみ)。
//   GET ?clubCode=365
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { startAiJob, getAiJob } from "@/lib/aiJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const SUMMARY_TABLE = process.env.OTP_SUMMARY_TABLE || "yamauchi-OneTimePassSummary";
const MODEL_ID = process.env.OTP_ANALYSIS_MODEL_ID || "us.anthropic.claude-sonnet-4-6";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const DUR_LABEL = (m: string) => `${m}分`;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const AGE_LABEL = (b: string) => (b === "-1" ? "不明" : b === "70" ? "70代以上" : `${b}代`);

function addMonths(ym: string, d: number) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}
function thisMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// 集計items → LLM向けの簡潔なダイジェスト
function buildDigest(items: any[]) {
  const byYm = new Map(items.map((it) => [it.yyyymm, it]));
  const month = thisMonth();
  const cur = byYm.get(month) || byYm.get(addMonths(month, -1)) || items[items.length - 1];
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const ym = addMonths(month, -i);
    const it = byYm.get(ym);
    monthly.push({ ym, count: it?.count ?? 0, sales: it?.sales ?? 0, uniq: it?.uniqueCustomers ?? 0, new: it?.newCustomers ?? 0 });
  }
  const sumOf = (obj: Record<string, any>, pick: (v: any) => number) =>
    Object.entries(obj || {}).map(([k, v]) => ({ k, n: pick(v) })).sort((a, b) => b.n - a.n);

  const dur = sumOf(cur?.byDuration || {}, (v) => v.count).map((x) => `${DUR_LABEL(x.k)}:${x.n}件`);
  const hour = Object.entries(cur?.byHour || {}).map(([h, n]) => ({ h: Number(h), n: Number(n) })).sort((a, b) => b.n - a.n).slice(0, 5).map((x) => `${x.h}時:${x.n}件`);
  const dow = Object.entries(cur?.byDayOfWeek || {}).map(([d, n]) => ({ d: Number(d), n: Number(n) })).sort((a, b) => b.n - a.n).map((x) => `${DOW[x.d]}:${x.n}件`);
  const gender = Object.entries(cur?.byGender || {}).map(([g, v]: any) => `${g === "male" ? "男" : g === "female" ? "女" : "不明"}:${v.count}件`);
  const age = sumOf(cur?.byAge || {}, (v) => v).map((x) => `${AGE_LABEL(x.k)}:${x.n}件`);

  return {
    month: cur?.yyyymm,
    monthly,
    current: {
      count: cur?.count ?? 0, sales: cur?.sales ?? 0, uniq: cur?.uniqueCustomers ?? 0, new: cur?.newCustomers ?? 0,
      byDuration: dur, topHours: hour, byDayOfWeek: dow, byGender: gender, byAge: age,
    },
  };
}

// 移動平均(3ヶ月) + 線形トレンド×季節性による売上予測(次3ヶ月)
function analytics(monthly: { ym: string; count: number; sales: number }[]) {
  const n = monthly.length;
  const sales = monthly.map((m) => m.sales);
  const count = monthly.map((m) => m.count);
  const ma3 = sales.map((_, i) => (i < 2 ? null : Math.round((sales[i] + sales[i - 1] + sales[i - 2]) / 3)));
  const cma3 = count.map((_, i) => (i < 2 ? null : Math.round((count[i] + count[i - 1] + count[i - 2]) / 3)));

  // 直近で実績のある区間で回帰(先頭のゼロ埋めを除外)
  const start = sales.findIndex((v) => v > 0);
  const xs: number[] = [], ys: number[] = [], yc: number[] = [];
  if (start >= 0) for (let i = start; i < n; i++) { xs.push(i); ys.push(sales[i]); yc.push(count[i]); }
  const slope = (X: number[], Y: number[]) => {
    const m = X.length; if (m < 2) return 0;
    const mx = X.reduce((a, b) => a + b, 0) / m, my = Y.reduce((a, b) => a + b, 0) / m;
    let num = 0, den = 0;
    for (let i = 0; i < m; i++) { num += (X[i] - mx) * (Y[i] - my); den += (X[i] - mx) ** 2; }
    return den ? num / den : 0;
  };
  const sSlope = slope(xs, ys), cSlope = slope(xs, yc);
  const last3 = (a: number[]) => { const t = a.slice(-3); return t.reduce((x, y) => x + y, 0) / t.length; };
  const levelS = last3(sales), levelC = last3(count);
  // 直近の変動(標準偏差)を±バンドに
  const recent = ys.slice(-6);
  const std = recent.length > 1 ? Math.sqrt(recent.map((v) => (v - recent.reduce((a, b) => a + b, 0) / recent.length) ** 2).reduce((a, b) => a + b, 0) / recent.length) : levelS * 0.2;

  const lastYm = monthly[n - 1].ym;
  const forecast = [1, 2, 3].map((k) => {
    const fi = n - 1 + k;
    // 季節性: 12ヶ月前の実績/移動平均比
    const si = fi - 12;
    let seas = 1;
    if (si >= 0 && ma3[si] && sales[si]) seas = Math.min(1.8, Math.max(0.5, sales[si] / (ma3[si] as number)));
    const s = Math.max(0, Math.round((levelS + sSlope * k) * seas));
    const c = Math.max(0, Math.round((levelC + cSlope * k) * seas));
    const band = Math.round(std * (1 + 0.3 * k));
    return { ym: addMonths(lastYm, k), sales: s, count: c, low: Math.max(0, s - band), high: s + band };
  });
  const trend = sSlope > levelS * 0.03 ? "上昇" : sSlope < -levelS * 0.03 ? "下降" : "横ばい";
  return { ma3, cma3, forecast, trend, slopePerMonth: Math.round(sSlope) };
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
    const r = await ddb.send(new QueryCommand({
      TableName: SUMMARY_TABLE,
      KeyConditionExpression: "clubCode = :c AND yyyymm >= :from",
      ExpressionAttributeValues: { ":c": clubCode, ":from": from },
    }));
    items = r.Items || [];
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "集計データの取得に失敗しました" }, { status: 500 });
  }
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "この店舗の集計データがまだありません（夜間集計後に利用できます）" }, { status: 404 });
  }

  const digest = buildDigest(items);
  const stat = analytics(digest.monthly);
  const fc = stat.forecast;

  // 利用時間別(何分のチケットが売れているか)の推移: 直近6ヶ月 × 分数別件数
  const byYm = new Map(items.map((it) => [it.yyyymm, it]));
  const durTrend = digest.monthly.slice(-6).map((m) => {
    const bd = (byYm.get(m.ym)?.byDuration || {}) as Record<string, { count: number }>;
    const mix = Object.entries(bd).map(([k, v]) => ({ min: Number(k), c: v.count })).sort((a, b) => a.min - b.min);
    return { ym: m.ym, mix, total: mix.reduce((s, x) => s + x.c, 0) };
  });
  // 直近月の構成比
  const curDur = durTrend[durTrend.length - 1];
  const curShare = curDur && curDur.total > 0
    ? curDur.mix.map((x) => `${x.min}分:${x.c}件(${Math.round((x.c / curDur.total) * 100)}%)`)
    : [];
  const system = `あなたはフィットネスクラブの1day/都度利用パス(EnjoyTimePass)の売上アナリストです。与えられた1店舗の月次実績・移動平均・統計予測・内訳データを解釈し、店長がすぐ動ける示唆を日本語で簡潔に述べてください。統計予測は機械的な参考値なので、内訳や季節性を踏まえてAIとしての見立て(上振れ/下振れ要因)も述べること。`;
  const userText = [
    `# 対象店舗: クラブコード ${clubCode}`,
    `# 直近12ヶ月の月次(件数/売上/3ヶ月移動平均):`,
    ...digest.monthly.map((m, i) => `- ${m.ym}: ${m.count}件 / ¥${m.sales.toLocaleString("ja-JP")} / MA¥${stat.ma3[i] != null ? (stat.ma3[i] as number).toLocaleString("ja-JP") : "—"} / 新規${m.new}`),
    ``,
    `# 統計予測(移動平均+トレンド×季節性、参考値): トレンド=${stat.trend}(月あたり${stat.slopePerMonth >= 0 ? "+" : ""}¥${stat.slopePerMonth.toLocaleString("ja-JP")})`,
    ...fc.map((f) => `- ${f.ym}: 予測 ${f.count}件 / ¥${f.sales.toLocaleString("ja-JP")} (範囲 ¥${f.low.toLocaleString("ja-JP")}〜¥${f.high.toLocaleString("ja-JP")})`),
    ``,
    `# 利用時間別チケット(何分が売れているか)の推移(直近6ヶ月・件数):`,
    ...durTrend.map((d) => `- ${d.ym}: ${d.mix.map((x) => `${x.min}分${x.c}件`).join(" / ") || "—"}`),
    `# 直近月の利用時間構成比: ${curShare.join(", ") || "—"}`,
    ``,
    `# 直近月(${digest.month})のその他内訳:`,
    `- 時間帯TOP: ${digest.current.topHours.join(", ") || "—"}`,
    `- 曜日別: ${digest.current.byDayOfWeek.join(", ") || "—"}`,
    `- 男女別: ${digest.current.byGender.join(", ") || "—"}`,
    `- 年代別: ${digest.current.byAge.join(", ") || "—"}`,
    ``,
    `以下の4見出しのMarkdownで、簡潔に(各2〜3行)出力してください。冗長にせず必ず全4見出しを埋めること:`,
    `## 売上サマリー・移動平均・来月予測（統計予測への評価＋上振れ/下振れ要因も）`,
    `## 売れ筋の利用時間（何分が人気か・構成比の推移・伸びている時間）`,
    `## 需要パターンと客層（時間帯・曜日・男女・年代）`,
    `## 施策提案（3つ、利用時間の品揃え/価格/販促の具体案）`,
  ].join("\n");

  // 重いBedrock生成は非同期Lambdaへ。即座に jobId + チャートデータ(高速)を返す。
  const jobId = await startAiJob({ system, userText, maxTokens: 1150, modelId: MODEL_ID });
  return NextResponse.json({
    ok: true, pending: true, jobId, clubCode, month: digest.month,
    monthly: digest.monthly.map((m, i) => ({ ...m, ma: stat.ma3[i] })),
    forecast: stat.forecast, trend: stat.trend, slopePerMonth: stat.slopePerMonth,
    durationTrend: durTrend,
    durationShareNow: curDur ? curDur.mix.map((x) => ({ min: x.min, count: x.c, pct: curDur.total ? Math.round((x.c / curDur.total) * 100) : 0 })) : [],
    updatedAt: items[0]?.updatedAt ?? null,
  });
}
