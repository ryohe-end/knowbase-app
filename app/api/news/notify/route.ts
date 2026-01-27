// app/api/news/notify/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import sgMail from "@sendgrid/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const region = process.env.AWS_REGION || "us-east-1";
const NEWS_TABLE = process.env.KB_NEWS_TABLE || "yamauchi-News";
const USERS_TABLE = process.env.KB_USERS_TABLE || "yamauchi-Users";

const FRANCHISE_ROUTING_EMAIL = "g_O0301006675@okamoto-group.co.jp";
const FRANCHISE_GROUP_ID = "g002";

const ddb = new DynamoDBClient({ region });
const doc = DynamoDBDocumentClient.from(ddb);

/* ========= 認証 ========= */
function requireAdmin(req: Request) {
  const url = new URL(req.url);
  const headerKey = (req.headers.get("x-kb-admin-key") || "").trim();
  const queryToken = (url.searchParams.get("token") || "").trim();

  const serverKey =
    (process.env.KB_ADMIN_API_KEY || "").trim() ||
    (process.env.NEXT_PUBLIC_KB_ADMIN_API_KEY || "").trim();

  if (!serverKey) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Forbidden", detail: "Missing server env: KB_ADMIN_API_KEY" },
        { status: 403 }
      ),
    };
  }

  if ((headerKey && headerKey === serverKey) || (queryToken && queryToken === serverKey)) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    res: NextResponse.json(
      { error: "Forbidden", detail: "Invalid admin key or token" },
      { status: 403 }
    ),
  };
}

/* ========= SendGrid ========= */
function initSendGrid() {
  const key = process.env.SENDGRID_API_KEY ?? "";
  const from = process.env.SENDGRID_FROM_EMAIL ?? "";
  if (!key) throw new Error("Missing env: SENDGRID_API_KEY");
  if (!key.startsWith("SG.")) throw new Error("Invalid SENDGRID_API_KEY (must start with 'SG.')");
  if (!from) throw new Error("Missing env: SENDGRID_FROM_EMAIL");
  sgMail.setApiKey(key);
  return { from };
}

/* ========= util ========= */
function normalizeViewScope(v: any): "all" | "direct" {
  const s = String(v || "").trim().toLowerCase();
  return s === "direct" ? "direct" : "all";
}

function toArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string") return [v];
  return [];
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function isValidEmail(s: any) {
  const v = String(s || "").trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * publishAt を「確実に」ms化する
 * - null/undefined/"" は null
 * - number(ms) はそのまま
 * - ISO / Z / "+09:00" などは Date.parse
 * - "YYYY-MM-DDTHH:mm"（timezone無し）も Date.parse（※ローカル扱いになるので、保存はISO推奨）
 */
function toMs(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s = String(v).trim();
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function hasId(userVal: any, id: string) {
  const target = String(id || "").trim();
  if (!target || target === "ALL") return true;
  const arr = Array.isArray(userVal) ? userVal : (userVal ? [userVal] : []);
  return arr.map(String).includes(target);
}

function isFranchiseUser(user: any): boolean {
  const gids = toArray(user?.groupIds ?? user?.groupId);
  return gids.includes(FRANCHISE_GROUP_ID);
}

/* ========= Scan All ========= */
async function scanAll(TableName: string) {
  let items: any[] = [];
  let ExclusiveStartKey: any = undefined;

  do {
    const res = await doc.send(new ScanCommand({ TableName, ExclusiveStartKey }));
    items = items.concat(res.Items || []);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

/* ========= 配信本体 ========= */
async function processNotification(news: any, allUsers: any[]) {
  const { from } = initSendGrid();
  const viewScope = normalizeViewScope(news.viewScope);

  // isActive !== false かつ email valid
  const activeUsers = allUsers.filter((u) => u?.isActive !== false && isValidEmail(u?.email));

  // ターゲット条件（無ければALL扱い）
  const brandId = String(news.brandId ?? "ALL").trim();
  const deptId = String(news.deptId ?? "ALL").trim();
  const targetGroupIds = Array.isArray(news.targetGroupIds) ? news.targetGroupIds.map(String) : [];

  const targetUsers = activeUsers.filter((user) => {
    const matchBrand = hasId(user.brandIds ?? user.brandId, brandId);
    const matchDept = hasId(user.deptIds ?? user.deptId, deptId);

    const userGroups = toArray(user.groupIds ?? user.groupId);
    const matchGroup =
      targetGroupIds.length === 0 || targetGroupIds.some((g) => userGroups.includes(String(g)));

    return matchBrand && matchDept && matchGroup;
  });

  const franchiseTargets = targetUsers.filter((u) => isFranchiseUser(u));
  const nonFranchiseTargets = targetUsers.filter((u) => !isFranchiseUser(u));

  const toNonFranchise = uniq(
    nonFranchiseTargets.map((u) => String(u.email).trim()).filter(Boolean)
  );

  const sendFranchiseRouting =
    viewScope === "all" && franchiseTargets.length > 0 && isValidEmail(FRANCHISE_ROUTING_EMAIL);

  if (toNonFranchise.length === 0 && !sendFranchiseRouting) return 0;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const subject = `【KnowBase】お知らせ：${news.title || ""}`;
  const text = `${news.body || ""}\n\n詳細はKnowBaseにログインして確認してください。\n${appUrl}`;
  const safeBody = String(news.body || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0ea5e9; padding: 20px; color: white; text-align: center;">
        <h1 style="margin: 0; font-size: 20px;">KnowBase お知らせ通知</h1>
      </div>
      <div style="padding: 24px; color: #1e293b;">
        <h2 style="margin-top: 0; color: #0f172a;">${news.title || ""}</h2>
        <div style="white-space: pre-wrap; line-height: 1.6; color: #475569;">${safeBody}</div>
        <div style="margin-top: 32px; text-align: center;">
          <a href="${appUrl}"
             style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
            KnowBaseで詳細を見る
          </a>
        </div>
      </div>
      <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
        ※このメールは送信専用です。
      </div>
    </div>
  `;

  if (toNonFranchise.length > 0) {
    await sgMail.sendMultiple({
      to: toNonFranchise,
      from: { email: from, name: "KnowBase運営事務局" },
      subject,
      text,
      html,
    });
  }

  if (sendFranchiseRouting) {
    await sgMail.send({
      to: FRANCHISE_ROUTING_EMAIL,
      from: { email: from, name: "KnowBase運営事務局" },
      subject,
      text: `${text}\n\n（フランチャイズ向け通知）`,
      html: html + `<div style="text-align:center;font-size:12px;color:#94a3b8;">（フランチャイズ向け通知）</div>`,
    });
  }

  // ✅ 配信済みフラグ
  await doc.send(
    new UpdateCommand({
      TableName: NEWS_TABLE,
      Key: { newsId: news.newsId },
      UpdateExpression: "SET isNotified = :val, notifiedAt = :at",
      ExpressionAttributeValues: {
        ":val": true,
        ":at": new Date().toISOString(),
      },
    })
  );

  return toNonFranchise.length + (sendFranchiseRouting ? 1 : 0);
}

/**
 * GET: cron専用（予約配信のみ）
 * ✅ publishAt が「ある」ものだけ送る（null/"" は送らない）
 */
export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const nowMs = Date.now();

    const allNews = await scanAll(NEWS_TABLE);
    const allUsers = await scanAll(USERS_TABLE);

    const targets = allNews.filter((n) => {
      const isHidden = !!n.isHidden || !!n.is_hidden;
      const isNotified = !!n.isNotified;

      const publishMs = toMs(n.publishAt);

      // ✅ 予約が無いなら cron は送らない
      if (publishMs === null) return false;

      // ✅ 予約時刻到来
      const isDue = publishMs <= nowMs;
      return !isHidden && !isNotified && isDue;
    });

    let totalEmails = 0;
    let processedNews = 0;

    for (const news of targets) {
      totalEmails += await processNotification(news, allUsers);
      processedNews += 1;
    }

    return NextResponse.json({
      ok: true,
      checkedAt: new Date(nowMs).toISOString(),
      processedNews,
      totalEmails,
    });
  } catch (error: any) {
    console.error("[NOTIFY_GET_ERROR]", error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

/**
 * POST: 即時配信（手動ボタン専用）
 * ✅ force=1 のときだけ送る（誤爆防止）
 * ✅ publishAt が未来なら送らない（手動でもスキップ）
 */
export async function POST(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  if (!force) {
    return NextResponse.json({
      ok: true,
      message: "即時配信は force=1 のときだけ実行します（誤爆防止）",
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const newsId = String(body?.newsId || "").trim();
    if (!newsId) return NextResponse.json({ error: "newsId required" }, { status: 400 });

    const newsRes = await doc.send(new GetCommand({ TableName: NEWS_TABLE, Key: { newsId } }));
    const news = newsRes.Item;
    if (!news) return NextResponse.json({ error: "NotFound" }, { status: 404 });

    const nowMs = Date.now();
    const publishMs = toMs(news.publishAt);

    // ✅ 予約が未来なら送らない（即時ボタンでもスキップ）
    if (publishMs !== null && publishMs > nowMs) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: "予約時刻前のため通知をスキップしました",
        now: new Date(nowMs).toISOString(),
        publishAt: news.publishAt,
      });
    }

    const allUsers = await scanAll(USERS_TABLE);
    const count = await processNotification(news, allUsers);

    return NextResponse.json({ ok: true, count });
  } catch (error: any) {
    console.error("[NOTIFY_POST_ERROR]", error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}