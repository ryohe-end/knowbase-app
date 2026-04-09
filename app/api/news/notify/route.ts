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
    console.error("[NOTIFY_AUTH_ERROR] Missing server env: KB_ADMIN_API_KEY");
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Forbidden", detail: "Missing server env: KB_ADMIN_API_KEY" },
        { status: 403 }
      ),
    };
  }

  if (
    (headerKey && headerKey === serverKey) ||
    (queryToken && queryToken === serverKey)
  ) {
    return { ok: true as const };
  }

  console.error("[NOTIFY_AUTH_ERROR] Invalid admin key or token");
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
  if (!key.startsWith("SG."))
    throw new Error("Invalid SENDGRID_API_KEY (must start with 'SG.')");
  if (!from) throw new Error("Missing env: SENDGRID_FROM_EMAIL");

  sgMail.setApiKey(key);
  return { from };
}

/* ========= util ========= */
function normalizeViewScope(v: any): "all" | "direct" {
  const s = String(v || "")
    .trim()
    .toLowerCase();
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
 * publishAt を ms に変換
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
  const arr = Array.isArray(userVal) ? userVal : userVal ? [userVal] : [];
  return arr.map(String).includes(target);
}

function isFranchiseUser(user: any): boolean {
  const gids = toArray(user?.groupIds ?? user?.groupId);
  return gids.includes(FRANCHISE_GROUP_ID);
}

function summarizeSendGridError(error: any) {
  return {
    message: error?.message || String(error),
    code: error?.code,
    responseBody: error?.response?.body ?? null,
    responseHeaders: error?.response?.headers ?? null,
  };
}

/* ========= Scan All ========= */
async function scanAll(TableName: string) {
  let items: any[] = [];
  let ExclusiveStartKey: any = undefined;

  do {
    const res = await doc.send(
      new ScanCommand({
        TableName,
        ExclusiveStartKey,
      })
    );
    items = items.concat(res.Items || []);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

/* ========= 配信本体 ========= */
async function processNotification(news: any, allUsers: any[]) {
  const { from } = initSendGrid();
  const viewScope = normalizeViewScope(news.viewScope);

  const activeUsers = allUsers.filter(
    (u) => u?.isActive !== false && isValidEmail(u?.email)
  );

  const brandId = String(news.brandId ?? "ALL").trim();

const targetGroupIds = Array.isArray(news.targetGroupIds)
  ? news.targetGroupIds.map(String)
  : [];

const targetUsers = activeUsers.filter((user) => {
  const matchBrand = hasId(user.brandIds ?? user.brandId, brandId);

  const userGroups = toArray(user.groupIds ?? user.groupId);
  const matchGroup =
    targetGroupIds.length === 0 ||
    targetGroupIds.some((g) => userGroups.includes(String(g)));

  return matchBrand && matchGroup;
});

  const franchiseTargets = targetUsers.filter((u) => isFranchiseUser(u));
  const nonFranchiseTargets = targetUsers.filter((u) => !isFranchiseUser(u));

  const toNonFranchise = uniq(
    nonFranchiseTargets.map((u) => String(u.email).trim()).filter(Boolean)
  );

  const sendFranchiseRouting =
    viewScope === "all" &&
    franchiseTargets.length > 0 &&
    isValidEmail(FRANCHISE_ROUTING_EMAIL);

  console.log("[NOTIFY_DEBUG] processNotification:start", {
    newsId: news.newsId,
    title: news.title,
    viewScope,
    brandId,
    deptId,
    targetGroupIds,
    allUsers: allUsers.length,
    activeUsers: activeUsers.length,
    targetUsers: targetUsers.length,
    franchiseTargets: franchiseTargets.length,
    nonFranchiseTargets: nonFranchiseTargets.length,
    toNonFranchiseCount: toNonFranchise.length,
    toNonFranchise,
    sendFranchiseRouting,
    franchiseRoutingEmail: FRANCHISE_ROUTING_EMAIL,
    fromEmail: from,
    publishAt: news.publishAt ?? null,
    isHidden: !!news.isHidden || !!news.is_hidden,
    isNotified: !!news.isNotified,
  });

  if (toNonFranchise.length === 0 && !sendFranchiseRouting) {
    console.warn("[NOTIFY_DEBUG] no recipients matched", {
      newsId: news.newsId,
      title: news.title,
      brandId,
      deptId,
      targetGroupIds,
    });
    return {
      sentCount: 0,
      skipped: true,
      reason: "no_recipients",
    };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const subject = `【KnowBase】お知らせ：${news.title || ""}`;
  const text = `${news.body || ""}\n\n詳細はKnowBaseにログインして確認してください。\n${appUrl}`;
  const safeTitle = String(news.title || "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeBody = String(news.body || "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0ea5e9; padding: 20px; color: white; text-align: center;">
        <h1 style="margin: 0; font-size: 20px;">KnowBase お知らせ通知</h1>
      </div>
      <div style="padding: 24px; color: #1e293b;">
        <h2 style="margin-top: 0; color: #0f172a;">${safeTitle}</h2>
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

  try {
    if (toNonFranchise.length > 0) {
      console.log("[NOTIFY_DEBUG] sendMultiple:before", {
        newsId: news.newsId,
        recipients: toNonFranchise,
        count: toNonFranchise.length,
      });

      const res = await sgMail.sendMultiple({
        to: toNonFranchise,
        from: { email: from, name: "KnowBase運営事務局" },
        subject,
        text,
        html,
      });

      console.log("[NOTIFY_DEBUG] sendMultiple:success", {
        newsId: news.newsId,
        responseCount: Array.isArray(res) ? res.length : 0,
      });
    }

    if (sendFranchiseRouting) {
      console.log("[NOTIFY_DEBUG] sendFranchiseRouting:before", {
        newsId: news.newsId,
        to: FRANCHISE_ROUTING_EMAIL,
      });

      const res = await sgMail.send({
        to: FRANCHISE_ROUTING_EMAIL,
        from: { email: from, name: "KnowBase運営事務局" },
        subject,
        text: `${text}\n\n（フランチャイズ向け通知）`,
        html:
          html +
          `<div style="text-align:center;font-size:12px;color:#94a3b8;">（フランチャイズ向け通知）</div>`,
      });

      console.log("[NOTIFY_DEBUG] sendFranchiseRouting:success", {
        newsId: news.newsId,
        responseCount: Array.isArray(res) ? res.length : 0,
      });
    }
  } catch (error: any) {
    const detail = summarizeSendGridError(error);
    console.error("[NOTIFY_SENDGRID_ERROR]", {
      newsId: news.newsId,
      title: news.title,
      detail,
    });
    throw new Error(
      `SendGrid send failed: ${JSON.stringify(detail)}`
    );
  }

  try {
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

    console.log("[NOTIFY_DEBUG] marked notified", {
      newsId: news.newsId,
    });
  } catch (error: any) {
    console.error("[NOTIFY_DDB_UPDATE_ERROR]", {
      newsId: news.newsId,
      message: error?.message || String(error),
    });
    throw error;
  }

  return {
    sentCount: toNonFranchise.length + (sendFranchiseRouting ? 1 : 0),
    skipped: false,
    reason: null,
  };
}

/**
 * GET: cron実行用
 * - publishAt が未来なら送らない
 * - publishAt が過去、または未設定なら送る
 */
export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const nowMs = Date.now();

    console.log("[NOTIFY_GET] start", {
      now: new Date(nowMs).toISOString(),
      region,
      NEWS_TABLE,
      USERS_TABLE,
      hasSendGridKey: !!process.env.SENDGRID_API_KEY,
      fromEmail: process.env.SENDGRID_FROM_EMAIL || null,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
    });

    const allNews = await scanAll(NEWS_TABLE);
    const allUsers = await scanAll(USERS_TABLE);

    console.log("[NOTIFY_GET] scan results", {
      newsCount: allNews.length,
      userCount: allUsers.length,
    });

    const targets = allNews.filter((n) => {
      const isHidden = !!n.isHidden || !!n.is_hidden;
      const isNotified = !!n.isNotified;
      const publishMs = toMs(n.publishAt);

      const shouldSend =
        !isHidden &&
        !isNotified &&
        (publishMs === null || publishMs <= nowMs);

      console.log("[NOTIFY_GET] evaluate news", {
        newsId: n.newsId,
        title: n.title,
        isHidden,
        isNotified,
        publishAt: n.publishAt ?? null,
        publishMs,
        nowMs,
        shouldSend,
      });

      return shouldSend;
    });

    let totalEmails = 0;
    let processedNews = 0;
    const details: any[] = [];

    for (const news of targets) {
      try {
        const result = await processNotification(news, allUsers);
        totalEmails += result.sentCount;
        processedNews += result.skipped ? 0 : 1;
        details.push({
          newsId: news.newsId,
          title: news.title,
          ok: true,
          ...result,
        });
      } catch (error: any) {
        console.error("[NOTIFY_GET_PROCESS_ERROR]", {
          newsId: news.newsId,
          title: news.title,
          message: error?.message || String(error),
        });

        details.push({
          newsId: news.newsId,
          title: news.title,
          ok: false,
          error: error?.message || String(error),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      checkedAt: new Date(nowMs).toISOString(),
      processedNews,
      totalEmails,
      targetNewsCount: targets.length,
      details,
    });
  } catch (error: any) {
    console.error("[NOTIFY_GET_ERROR]", {
      message: error?.message || String(error),
      stack: error?.stack || null,
    });

    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST: 即時配信（手動ボタン専用）
 * - force=1 のときだけ送る（誤爆防止）
 * - publishAt が未来なら送らない
 * - publishAt が過去、または未設定なら送る
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
    console.log("[NOTIFY_POST] start", {
      region,
      NEWS_TABLE,
      USERS_TABLE,
      hasSendGridKey: !!process.env.SENDGRID_API_KEY,
      fromEmail: process.env.SENDGRID_FROM_EMAIL || null,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
    });

    const body = await req.json().catch(() => ({}));
    const newsId = String(body?.newsId || "").trim();

    console.log("[NOTIFY_POST] request body", { newsId });

    if (!newsId) {
      return NextResponse.json({ error: "newsId required" }, { status: 400 });
    }

    const newsRes = await doc.send(
      new GetCommand({
        TableName: NEWS_TABLE,
        Key: { newsId },
      })
    );

    const news = newsRes.Item;

    if (!news) {
      return NextResponse.json({ error: "NotFound" }, { status: 404 });
    }

    const isHidden = !!news.isHidden || !!news.is_hidden;
    const isNotified = !!news.isNotified;
    const nowMs = Date.now();
    const publishMs = toMs(news.publishAt);

    console.log("[NOTIFY_POST] loaded news", {
      newsId: news.newsId,
      title: news.title,
      isHidden,
      isNotified,
      publishAt: news.publishAt ?? null,
      publishMs,
      now: new Date(nowMs).toISOString(),
      nowMs,
    });

    if (isHidden) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: "非表示ニュースのため通知をスキップしました",
      });
    }

    if (isNotified) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: "すでに通知済みです",
      });
    }

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

    console.log("[NOTIFY_POST] users loaded", {
      userCount: allUsers.length,
    });

    const result = await processNotification(news, allUsers);

    return NextResponse.json({
      ok: true,
      newsId,
      ...result,
    });
  } catch (error: any) {
    console.error("[NOTIFY_POST_ERROR]", {
      message: error?.message || String(error),
      stack: error?.stack || null,
    });

    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}