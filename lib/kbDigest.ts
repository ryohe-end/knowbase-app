// lib/kbDigest.ts
// KB通信: KnowBase の魅力を全社に届ける定期メールニュースレター。
// - 管理画面で頻度と「次回の内容(ざっくり)」を設定
// - 内容が空なら AI がアクセス動向(人気検索/よく見られたマニュアル/新着/みんなの質問)から自動生成
// - 全ユーザーへ SendGrid で配信
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import sgMail from "@sendgrid/mail";

const REGION = process.env.AWS_REGION || "us-east-1";
const DIGEST_TABLE = process.env.KB_DIGEST_TABLE || "knowbie-kb-digest";
const USERS_TABLE = "yamauchi-Users";
const MANUALS_TABLE = "yamauchi-Manuals";
const SEARCH_LOGS_TABLE = "yamauchi-SearchLogs";
const MANUAL_VIEW_LOGS_TABLE = "yamauchi-ManualViewLogs";
const CHAT_LOGS_TABLE = process.env.KB_CHAT_LOG_TABLE || "knowbie-chat-logs";
const MODEL_ID = process.env.KB_MODEL_ID || "us.anthropic.claude-sonnet-4-6";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://main.d5z4bnw4wyrxn.amplifyapp.com";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const bedrock = new BedrockRuntimeClient({ region: REGION });

export type DigestFrequency = "weekly" | "biweekly" | "monthly";

// KB通信のコンテンツ・セクション (小出しにトグルで選ぶ)
export type SectionId =
  | "update" | "usageReport" | "popularSearches" | "staffIntro"
  | "seminarVideo" | "newManuals" | "senryu" | "fortune" | "funNews";
export const SECTION_DEFS: { id: SectionId; label: string; kind: "auto" | "input" | "creative"; note?: string }[] = [
  { id: "update", label: "アップデート情報", kind: "input", note: "新機能や変更点(手入力)" },
  { id: "usageReport", label: "こんな使われ方しましたレポート", kind: "auto", note: "アクセス動向から自動" },
  { id: "popularSearches", label: "人気の検索ワード", kind: "auto" },
  { id: "newManuals", label: "新着マニュアルのお知らせ", kind: "auto" },
  { id: "staffIntro", label: "部署紹介（担当業務）", kind: "input", note: "部署と担当業務(手入力)" },
  { id: "seminarVideo", label: "説明会動画（毎回必須）", kind: "input", note: "動画URL(手入力)" },
  { id: "senryu", label: "川柳", kind: "creative", note: "お楽しみ枠(どれか1つ)" },
  { id: "fortune", label: "占い", kind: "creative", note: "お楽しみ枠(どれか1つ)" },
  { id: "funNews", label: "おもしろニュース／小ネタ", kind: "creative", note: "お楽しみ枠(どれか1つ)" },
];

export type DigestConfig = {
  enabled: boolean; // 配信ON/OFF
  frequency: DigestFrequency;
  dayOfWeek: number; // 0=日..6=土 (weekly/biweekly)
  dayOfMonth: number; // 1..28 (monthly)
  sendHour: number; // 0..23 JST
  nextDraft: string; // 次回の内容(ざっくり)。空なら AI 自動生成
  targetType: "all" | "groups"; // 配信対象
  targetGroupIds: string[]; // targetType=groups のとき対象グループ
  sections: Record<SectionId, boolean>; // 掲載するセクション
  updateInfo: string; // アップデート情報の中身(手入力)
  staffIntroText: string; // 担当者紹介の中身(手入力)
  seminarVideoUrl: string; // 説明会動画URL
  lastSentAt?: string;
  lastSubject?: string;
};

const DEFAULT_SECTIONS: Record<SectionId, boolean> = {
  update: true, usageReport: true, popularSearches: true, newManuals: true,
  staffIntro: false, seminarVideo: true, senryu: true, fortune: true, funNews: true,
};

const DEFAULT_CONFIG: DigestConfig = {
  enabled: false,
  frequency: "weekly",
  dayOfWeek: 1, // 月曜
  dayOfMonth: 1,
  sendHour: 9,
  nextDraft: "",
  targetType: "all",
  targetGroupIds: [],
  sections: { ...DEFAULT_SECTIONS },
  updateInfo: "",
  staffIntroText: "",
  seminarVideoUrl: "",
};

// 配信対象グループの候補 (本部/直営/FC)。env のグループIDに紐づく。
export function availableGroups(): { id: string; name: string }[] {
  const g: { id: string; name: string }[] = [];
  if (process.env.KB_HQ_GROUP_ID) g.push({ id: process.env.KB_HQ_GROUP_ID, name: "本部" });
  if (process.env.KB_DIRECT_GROUP_ID) g.push({ id: process.env.KB_DIRECT_GROUP_ID, name: "直営" });
  if (process.env.KB_FC_GROUP_ID) g.push({ id: process.env.KB_FC_GROUP_ID, name: "FC" });
  return g;
}

export async function getConfig(): Promise<DigestConfig> {
  try {
    const res = await ddb.send(new GetCommand({ TableName: DIGEST_TABLE, Key: { id: "config" } }));
    if (res.Item) {
      const it = res.Item as any;
      return {
        ...DEFAULT_CONFIG,
        ...it,
        sections: { ...DEFAULT_SECTIONS, ...(it.sections || {}) },
        id: undefined,
      } as DigestConfig;
    }
  } catch (e) {
    console.error("[kbDigest] getConfig failed:", (e as Error)?.message);
  }
  return { ...DEFAULT_CONFIG };
}

export async function saveConfig(patch: Partial<DigestConfig>): Promise<DigestConfig> {
  const cur = await getConfig();
  const next = { ...cur, ...patch };
  await ddb.send(new PutCommand({ TableName: DIGEST_TABLE, Item: { id: "config", ...next } }));
  return next;
}

// ===== トレンド収集 =====
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}
async function scanAll(TableName: string): Promise<any[]> {
  const items: any[] = [];
  let ExclusiveStartKey: any;
  do {
    const res: any = await ddb.send(new ScanCommand({ TableName, ExclusiveStartKey }));
    if (Array.isArray(res.Items)) items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export type Trends = {
  periodDays: number;
  topSearches: { keyword: string; count: number }[];
  topManuals: { title: string; count: number }[];
  newManuals: { title: string }[];
  topQuestions: string[];
  stats: { activeUsers: number; totalManuals: number };
};

export async function gatherTrends(periodDays = 7): Promise<Trends> {
  const since = daysAgoIso(periodDays);
  const sinceDate = since.slice(0, 10);
  const [users, manuals, searchLogs, viewLogs, chatLogs] = await Promise.all([
    scanAll(USERS_TABLE).catch(() => []),
    scanAll(MANUALS_TABLE).catch(() => []),
    scanAll(SEARCH_LOGS_TABLE).catch(() => []),
    scanAll(MANUAL_VIEW_LOGS_TABLE).catch(() => []),
    scanAll(CHAT_LOGS_TABLE).catch(() => []),
  ]);

  // 人気検索ワード
  const kw = new Map<string, number>();
  for (const l of searchLogs) {
    const d = String(l.searchedDate ?? l.searchedAt ?? "").slice(0, 10);
    if (d && d < sinceDate) continue;
    const k = String(l.keyword ?? "").trim();
    if (k) kw.set(k, (kw.get(k) ?? 0) + 1);
  }
  const topSearches = [...kw.entries()].map(([keyword, count]) => ({ keyword, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  // よく見られたマニュアル (view logs → title)
  const titleById = new Map<string, string>();
  for (const m of manuals) if (m.manualId) titleById.set(String(m.manualId), String(m.title ?? m.manualId));
  const mv = new Map<string, number>();
  for (const v of viewLogs) {
    const ts = String(v.viewedAt ?? v.ts ?? v.createdAt ?? "");
    if (ts && ts < since) continue;
    const id = String(v.manualId ?? "");
    if (id) mv.set(id, (mv.get(id) ?? 0) + 1);
  }
  const topManuals = [...mv.entries()]
    .map(([id, count]) => ({ title: titleById.get(id) || id, count }))
    .sort((a, b) => b.count - a.count).slice(0, 6);

  // 新着マニュアル
  const newManuals = manuals
    .filter((m) => String(m.createdAt ?? m.publishedAt ?? "") >= since)
    .map((m) => ({ title: String(m.title ?? m.manualId) }))
    .slice(0, 8);

  // みんなの質問 (chat logs)
  const seenQ = new Set<string>();
  const topQuestions: string[] = [];
  for (const c of chatLogs.sort((a, b) => String(b.ts).localeCompare(String(a.ts)))) {
    const q = String(c.query ?? "").trim();
    if (q && !seenQ.has(q) && String(c.ts ?? "") >= since) { seenQ.add(q); topQuestions.push(q); }
    if (topQuestions.length >= 6) break;
  }

  const activeUsers = users.filter((u: any) => u?.isActive !== false).length;
  return { periodDays, topSearches, topManuals, newManuals, topQuestions, stats: { activeUsers, totalManuals: manuals.length } };
}

// ===== AI生成 =====
function brandBlock(): string {
  return `KnowBase(ノウビー) は社内マニュアル・ナレッジの検索/閲覧/AIチャットができる社内ポータルです。`;
}

export const DIGEST_MODEL_ID = MODEL_ID;

// 生成用の system/user プロンプトを組み立てる (ストリーミング/非ストリーミング共通)
export function buildDigestMessages(input: { cfg?: Partial<DigestConfig>; draft?: string; trends: Trends }): { system: string; user: string } {
  const { trends } = input;
  const cfg = input.cfg || {};
  const sections = (cfg.sections || DEFAULT_SECTIONS) as Record<SectionId, boolean>;
  const draft = (input.draft ?? cfg.nextDraft ?? "").trim();
  const trendsText = [
    `期間: 直近${trends.periodDays}日 / 稼働ユーザー ${trends.stats.activeUsers} / マニュアル総数 ${trends.stats.totalManuals}`,
    trends.topSearches.length ? `人気検索ワード: ${trends.topSearches.map((s) => `${s.keyword}(${s.count})`).join("、")}` : "",
    trends.topManuals.length ? `よく見られたマニュアル: ${trends.topManuals.map((m) => m.title).join("、")}` : "",
    trends.newManuals.length ? `新着マニュアル: ${trends.newManuals.map((m) => m.title).join("、")}` : "",
    trends.topQuestions.length ? `みんながAIに聞いた質問: ${trends.topQuestions.join(" / ")}` : "",
  ].filter(Boolean).join("\n");

  // 掲載するセクションの組み立て指示 (小出し: ONのものだけ)
  const secLines: string[] = [];
  if (sections.update) secLines.push(`■ アップデート情報: ${cfg.updateInfo?.trim() || "(担当メモ無し。動向や新着から今回の変更/おすすめを軽く)"}`);
  if (sections.usageReport) secLines.push(`■ こんな使われ方しましたレポート: 上記アクセス動向から、実際の使われ方を1〜2個ストーリー仕立てで(数字はデータに忠実)。`);
  if (sections.popularSearches && trends.topSearches.length) secLines.push(`■ 人気の検索ワード: ランキングを軽快に紹介。`);
  if (sections.newManuals && trends.newManuals.length) secLines.push(`■ 新着マニュアルのお知らせ: 新しく増えたマニュアルを紹介。`);
  if (sections.staffIntro && cfg.staffIntroText?.trim()) secLines.push(`■ 部署紹介: 次の部署とその担当業務を、親しみやすく紹介(何をしている部署か・どんな時に頼れるか) → ${cfg.staffIntroText.trim()}`);
  if (sections.seminarVideo && cfg.seminarVideoUrl?.trim()) secLines.push(`■ 説明会動画(毎回必須): 「まずはこれを見て！」と動画リンクを目立つボタンで。URL: ${cfg.seminarVideoUrl.trim()}`);
  // お楽しみ枠(川柳/占い/おもしろ)は "どれか1つだけ"。有効なものからローテーションで選ぶ。
  const funEnabled: { id: string; instr: string }[] = [];
  if (sections.senryu) funEnabled.push({ id: "senryu", instr: "■ 川柳: KnowBaseや社内あるあるをネタに、クスッとくる川柳を一句(5-7-5)。" });
  if (sections.fortune) funEnabled.push({ id: "fortune", instr: "■ 今週の占い: 部署や職種を絡めた軽い運勢を2〜3個、ラッキーマニュアル付きで楽しく。" });
  if (sections.funNews) funEnabled.push({ id: "funNews", instr: "■ おもしろニュース／小ネタ: KnowBaseの使い方Tipsやちょっとした小ネタを1つ。" });
  if (funEnabled.length > 0) {
    const weekIdx = Math.floor(Date.now() / (7 * 86400_000));
    secLines.push(funEnabled[weekIdx % funEnabled.length].instr);
  }
  const sectionsText = secLines.length ? secLines.join("\n") : "(セクション指定なし。動向からおまかせで構成)";

  const system = `あなたは社内ポータル「KnowBase」の名物広報担当です。全社員が思わず読みたくなるメールマガジン「KB通信」を作ります。
目的: KnowBaseの便利さ・活用法を、クスッと笑える親しみやすいトーンで伝え、利用を促す。
トーン(重要):
- 興味を引くユーモアを効かせる。堅い社内報にしない。軽い冗談・気の利いた比喩・親しみやすい語りかけはOK(下品・内輪すぎ・特定個人いじりはNG)。
- 件名は思わず開きたくなるキャッチーなもの(絵文字は1〜2個までOK)。
- 読み手が「へぇ、使ってみよ」と思う具体例を必ず入れる。
制約:
- 出力は「1通の完結したHTMLメール」のみ。説明・前置き・コードフェンス(\`\`\`)は付けない。
- 1行目に "SUBJECT: <件名>" を必ず入れ、2行目以降にHTML本文。件名は40文字以内。
- メールクライアント互換: table + インラインCSS。幅600px中央寄せ、max-width:100%。<script>/外部CSS/webフォント禁止。
- アクセント色 #4f46e5。見出し・箇条書きで読みやすく。数字は誇張しない(データに忠実)。
- 「今週のハイライト」「よく見られたマニュアル」「みんなの質問(AIチャット)」「今週の小ネタ/使い方のヒント(例: Knowbieに〜と聞いてみよう)」等を、データがある範囲でユーモラスに構成する。
- CTA: 「KnowBaseを開く」ボタン(${APP_URL})を必ず目立つ形で入れる。`;

  const userText = `${brandBlock()}

# 今回のKB通信に載せるセクション(この順で、指定されたものだけを掲載する)
${sectionsText}
${draft ? `\n# 担当者メモ(全体の主旨・これも反映)\n${draft}\n` : ""}
# 参考データ(アクセス動向)
${trendsText}

上記の「載せるセクション」だけで、ユーモアの効いたKB通信のHTMLメールを構成してください。指定に無いセクションは作らない。1行目はSUBJECT:。`;

  return { system, user: userText };
}

// Claude 出力(先頭 SUBJECT: 付き)を {subject, html} に分解する
export function parseDigestOutput(raw: string): { subject: string; html: string } {
  let text = (raw || "").trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let subject = "KB通信";
  const m = text.match(/^\s*SUBJECT:\s*(.+)\s*[\r\n]+/i);
  if (m) { subject = m[1].trim(); text = text.slice(m[0].length); }
  return { subject, html: text };
}

export async function generateDigest(input: { cfg?: Partial<DigestConfig>; draft?: string; trends: Trends }): Promise<{ subject: string; html: string }> {
  const { system, user } = buildDigestMessages(input);
  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
  };
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID, contentType: "application/json", accept: "application/json", body: JSON.stringify(payload),
  }));
  const raw = JSON.parse(new TextDecoder().decode(res.body)).content?.map((b: any) => b.text).join("") || "";
  const out = parseDigestOutput(raw);
  if (!out.html) throw new Error("empty_generation");
  return out;
}

// ===== 全員へ配信 =====
function isValidEmail(e: any): boolean {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}
function userInTarget(u: any, targetType: string, groupIds: string[]): boolean {
  if (targetType !== "groups" || groupIds.length === 0) return true;
  const ug = (Array.isArray(u.groupIds) ? u.groupIds : u.groupId ? [u.groupId] : []).map((x: any) => String(x));
  return groupIds.some((g) => ug.includes(String(g)));
}

export async function sendToAll(input: { subject: string; html: string; targetType?: string; targetGroupIds?: string[] }): Promise<{ sent: number; failed: number }> {
  const key = (process.env.SENDGRID_API_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");
  const from = (process.env.SENDGRID_FROM_EMAIL ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!key.startsWith("SG.") || !from) throw new Error("SendGrid 未設定");
  sgMail.setApiKey(key);

  const targetType = input.targetType || "all";
  const groupIds = input.targetGroupIds || [];
  const users = await scanAll(USERS_TABLE);
  const emails = [...new Set(
    users
      .filter((u: any) => u?.isActive !== false && isValidEmail(u?.email) && userInTarget(u, targetType, groupIds))
      .map((u: any) => String(u.email).trim())
  )];
  let sent = 0, failed = 0;
  for (let i = 0; i < emails.length; i += 900) {
    const batch = emails.slice(i, i + 900);
    try {
      await sgMail.sendMultiple({
        to: batch,
        from: { email: from, name: "KnowBase運営事務局" },
        subject: input.subject,
        html: input.html,
        trackingSettings: { openTracking: { enable: true }, clickTracking: { enable: true, enableText: false } },
        categories: ["kb-digest"],
      });
      sent += batch.length;
    } catch (e) {
      console.error("[kbDigest] send batch failed:", (e as Error)?.message);
      failed += batch.length;
    }
  }
  return { sent, failed };
}

export async function recordIssue(entry: { subject: string; html: string; sent: number; auto: boolean }): Promise<void> {
  const nowIso = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: DIGEST_TABLE,
    Item: { id: `issue#${nowIso}`, ts: nowIso, subject: entry.subject, html: entry.html.slice(0, 40000), sent: entry.sent, auto: entry.auto },
  }));
}

// ===== スケジュール判定 (JST) =====
export function isDue(cfg: DigestConfig, now: Date): boolean {
  if (!cfg.enabled) return false;
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const hour = jst.getUTCHours();
  if (hour !== cfg.sendHour) return false;
  // 同日二重送信ガード
  const today = jst.toISOString().slice(0, 10);
  if (cfg.lastSentAt) {
    const lastJstDay = new Date(new Date(cfg.lastSentAt).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    if (lastJstDay === today) return false;
  }
  if (cfg.frequency === "monthly") return jst.getUTCDate() === cfg.dayOfMonth;
  if (jst.getUTCDay() !== cfg.dayOfWeek) return false;
  if (cfg.frequency === "weekly") return true;
  // biweekly: エポック週の偶奇で隔週判定
  const week = Math.floor(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) / (7 * 86400_000));
  return week % 2 === 0;
}
