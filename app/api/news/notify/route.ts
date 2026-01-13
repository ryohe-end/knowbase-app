// app/api/news/notify/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import sgMail from "@sendgrid/mail";

/** ========= 設定 ========= */
const region = process.env.AWS_REGION || "us-east-1";
const NEWS_TABLE = process.env.KB_NEWS_TABLE || "yamauchi-News";
const USERS_TABLE = process.env.KB_USERS_TABLE || "yamauchi-Users";

// FCの代表送信先（固定）
const FRANCHISE_ROUTING_EMAIL = "g_O0301006675@okamoto-group.co.jp";
// FC判定：users.groupIds に g002 が含まれる
const FRANCHISE_GROUP_ID = "g002";

const ddb = new DynamoDBClient({ region });
const doc = DynamoDBDocumentClient.from(ddb);

/** ========= admin key（Forbidden対策） ========= */
function requireAdmin(req: Request) {
  const headerKey = (req.headers.get("x-kb-admin-key") || "").trim();
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
  if (!headerKey || headerKey !== serverKey) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Forbidden", detail: "Invalid x-kb-admin-key" },
        { status: 403 }
      ),
    };
  }
  return { ok: true as const };
}

/** ========= SendGrid ========= */
function initSendGrid() {
  const key = process.env.SENDGRID_API_KEY ?? "";
  const from = process.env.SENDGRID_FROM_EMAIL ?? "";
  if (!key) throw new Error("Missing env: SENDGRID_API_KEY");
  if (!key.startsWith("SG.")) throw new Error("Invalid SENDGRID_API_KEY (must start with 'SG.')");
  if (!from) throw new Error("Missing env: SENDGRID_FROM_EMAIL");
  sgMail.setApiKey(key);
  return { from };
}

/** ========= util ========= */
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
function isFranchiseUser(user: any): boolean {
  const gids = toArray(user?.groupIds);
  return gids.includes(FRANCHISE_GROUP_ID);
}
function isValidEmail(s: any) {
  const v = String(s || "").trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

/**
 * 特定のお知らせ1件を配信し、フラグを更新する共通関数
 */
async function processNotification(news: any, allUsers: any[]) {
  const { from } = initSendGrid();
  const viewScope = normalizeViewScope(news.viewScope);

  const activeUsers = allUsers.filter((u) => u?.isActive !== false && isValidEmail(u?.email));

  const targetUsers = activeUsers.filter((user) => {
    const brandId = String(news.brandId ?? "ALL");
    const deptId = String(news.deptId ?? "ALL");
    const targetGroupIds = Array.isArray(news.targetGroupIds) ? news.targetGroupIds : [];

    const matchBrand = brandId === "ALL" || !brandId || user.brandId === brandId;
    const matchDept = deptId === "ALL" || !deptId || user.deptId === deptId;
    const matchGroup = targetGroupIds.length === 0 || targetGroupIds.includes(user.groupId);

    return matchBrand && matchDept && matchGroup;
  });

  const franchiseTargets = targetUsers.filter((u) => isFranchiseUser(u));
  const nonFranchiseTargets = targetUsers.filter((u) => !isFranchiseUser(u));

  const toNonFranchise = uniq(nonFranchiseTargets.map((u) => String(u.email).trim()).filter(Boolean));
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

  // ✅ 送信完了後にフラグを更新
  // テーブル定義に合わせて PK (newsId / news_id) を適宜調整してください
  await doc.send(new UpdateCommand({
    TableName: NEWS_TABLE,
    Key: { newsId: news.newsId },
    UpdateExpression: "SET isNotified = :val",
    ExpressionAttributeValues: { ":val": true }
  }));

  return toNonFranchise.length + (sendFranchiseRouting ? 1 : 0);
}

/**
 * GET: 定期実行（Cron等）用
 * 予約時間を過ぎているが、まだ通知していないお知らせをスキャンして配信
 */
export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const now = new Date().toISOString();

    const newsRes = await doc.send(new ScanCommand({ TableName: NEWS_TABLE }));
    const allNews = (newsRes.Items || []) as any[];

    const usersRes = await doc.send(new ScanCommand({ TableName: USERS_TABLE }));
    const allUsers = (usersRes.Items || []) as any[];

    // 公開予約時刻を過ぎている、かつ通知未済、かつ非表示でない
    const targets = allNews.filter(n => {
      const isHidden = !!n.isHidden || !!n.is_hidden;
      const isNotified = !!n.isNotified;
      const publishAt = n.publishAt || null;
      // publishAtがない（即時）または過ぎている
      return !isHidden && !isNotified && (!publishAt || publishAt <= now);
    });

    let count = 0;
    for (const news of targets) {
      count += await processNotification(news, allUsers);
    }

    return NextResponse.json({ ok: true, processedNews: targets.length, totalEmails: count });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: 即時実行用（管理画面の保存ボタン後の通知などで使用）
 */
export async function POST(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const { newsId } = await req.json();
    if (!newsId) return NextResponse.json({ error: "newsId required" }, { status: 400 });

    const newsRes = await doc.send(new GetCommand({ TableName: NEWS_TABLE, Key: { newsId } }));
    const news = newsRes.Item;
    if (!news) return NextResponse.json({ error: "NotFound" }, { status: 404 });

    // 予約日時が設定されている場合、POSTでも未来のものは送らない（ガード）
    const now = new Date().toISOString();
    if (news.publishAt && news.publishAt > now) {
      return NextResponse.json({ ok: true, message: "予約時刻前のため通知をスキップしました" });
    }

    const usersRes = await doc.send(new ScanCommand({ TableName: USERS_TABLE }));
    const count = await processNotification(news, usersRes.Items || []);

    return NextResponse.json({ ok: true, count });
  } catch (error: any) {
    console.error("[NOTIFY_POST_ERROR]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}