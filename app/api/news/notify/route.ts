// app/api/news/notify/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
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

export async function POST(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.res;

  try {
    const { newsId } = await req.json();
    if (!newsId) {
      return NextResponse.json({ error: "newsIdが指定されていません" }, { status: 400 });
    }

    /** 1) news（PK: newsId） */
    const newsRes = await doc.send(
      new GetCommand({
        TableName: NEWS_TABLE,
        Key: { newsId },
      })
    );
    const news = newsRes.Item as any;
    if (!news) {
      return NextResponse.json({ error: "お知らせが見つかりませんでした" }, { status: 404 });
    }

    const viewScope = normalizeViewScope(news.viewScope);

    /** 2) users */
    const usersRes = await doc.send(new ScanCommand({ TableName: USERS_TABLE }));
    const allUsers = (usersRes.Items || []) as any[];

    /** 3) まず active + email だけ残す */
    const activeUsers = allUsers.filter((u) => u?.isActive !== false && isValidEmail(u?.email));

    /**
     * 4) 「閲覧権限に属するユーザー」絞り込み（あなたの元のロジックを“残す”）
     *    - news.brandId があれば brandId を見る（無い or "ALL" なら全対象）
     *    - news.deptId  があれば deptId  を見る（無い or "ALL" なら全対象）
     *    - news.targetGroupIds があれば groupId を見る（空なら全対象）
     *
     * ※ Users 側は user.groupId を想定（元コード踏襲）
     */
    const targetUsers = activeUsers.filter((user) => {
      const brandId = String(news.brandId ?? "ALL");
      const deptId = String(news.deptId ?? "ALL");
      const targetGroupIds = Array.isArray(news.targetGroupIds) ? news.targetGroupIds : [];

      const matchBrand = brandId === "ALL" || !brandId || user.brandId === brandId;
      const matchDept = deptId === "ALL" || !deptId || user.deptId === deptId;

      const matchGroup =
        !targetGroupIds ||
        targetGroupIds.length === 0 ||
        targetGroupIds.includes(user.groupId);

      return matchBrand && matchDept && matchGroup;
    });

    /** 5) FC/非FCに分ける（FCは groupIds に g002 がある人） */
    const franchiseTargets = targetUsers.filter((u) => isFranchiseUser(u));
    const nonFranchiseTargets = targetUsers.filter((u) => !isFranchiseUser(u));

    /**
     * 6) viewScope 反映
     *    - direct: FCは通知対象外
     *    - all: 非FCは個別送信 / FCは代表へ1通だけ
     */
    const toNonFranchise = uniq(nonFranchiseTargets.map((u) => String(u.email).trim()).filter(Boolean));
    const sendFranchiseRouting =
      viewScope === "all" && franchiseTargets.length > 0 && isValidEmail(FRANCHISE_ROUTING_EMAIL);

    if (toNonFranchise.length === 0 && !sendFranchiseRouting) {
      return NextResponse.json({
        ok: true,
        viewScope,
        count: 0,
        message: "対象ユーザーがいません",
        detail: {
          targetUsers: targetUsers.length,
          nonFranchise: 0,
          franchiseTargets: franchiseTargets.length,
          franchiseRouting: 0,
        },
      });
    }

    /** 7) SendGrid */
    const { from } = initSendGrid();
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
          ※このメールは送信専用です。心当たりがない場合は破棄してください。
        </div>
      </div>
    `;

    /** 8) 非FCへ送信（direct/all共通） */
    let sentNonFranchise = 0;
    if (toNonFranchise.length > 0) {
      await sgMail.sendMultiple({
        to: toNonFranchise,
        from: { email: from, name: "KnowBase運営事務局" },
        subject,
        text,
        html,
      });
      sentNonFranchise = toNonFranchise.length;
    }

    /** 9) FCは代表へ1通だけ（allのときのみ） */
    let sentFranchiseRouting = 0;
    if (sendFranchiseRouting) {
      await sgMail.send({
        to: FRANCHISE_ROUTING_EMAIL,
        from: { email: from, name: "KnowBase運営事務局" },
        subject,
        text: `${text}\n\n（フランチャイズ向け通知は代表アドレスに集約されています）`,
        html:
          html +
          `<div style="margin-top:10px; font-size:12px; color:#94a3b8; text-align:center;">（フランチャイズ向け通知は代表アドレスに集約されています）</div>`,
      });
      sentFranchiseRouting = 1;
    }

    return NextResponse.json({
      ok: true,
      viewScope,
      count: sentNonFranchise + sentFranchiseRouting,
      message: `配信しました（非FC: ${sentNonFranchise} / FC代表: ${sentFranchiseRouting}）`,
      detail: {
        targetUsers: targetUsers.length,
        nonFranchise: sentNonFranchise,
        franchiseTargets: franchiseTargets.length,
        franchiseRouting: sentFranchiseRouting,
      },
    });
  } catch (error: any) {
    console.error("[NOTIFY_ERROR]", error);
    return NextResponse.json({ error: error.message || "notify failed" }, { status: 500 });
  }
}
