export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import sgMail from "@sendgrid/mail";
import { hashPassword, validateNewPassword } from "@/lib/password";
import { verifySignedValue, isAdminRequest } from "@/lib/auth";

export type KbUserRole = "admin" | "sv" | "editor" | "viewer" | "store" | "finance";

// permissions は機能単位の特殊権限。
// role: admin と独立しており、admin でも明示付与が必要。
export type KbPermission = "member_search" | "public_pdf" | "accounting";

export type KbUser = {
  userId: string;
  name: string;
  email: string;
  role: KbUserRole;
  title?: string;   // 役職 (CL/CMG/CF 等)。無い場合は空。
  brandIds?: string[];
  deptIds?: string[];
  groupIds?: string[];
  clubCodes?: string[];
  areas?: string[]; // 担当エリア (companyGroup)。実効スコープ = clubCodes ∪ areasの店舗
  permissions?: KbPermission[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
  passwordHash?: string;
  mustChangePassword?: boolean;
};

const region = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = "yamauchi-Users";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * 一時パスワード自動生成（英字+数字を少なくとも1文字ずつ含む）
 */
function generateTempPassword(len = 12) {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%";
  const all = letters + digits + symbols;
  const picks: string[] = [
    letters[Math.floor(Math.random() * letters.length)],
    digits[Math.floor(Math.random() * digits.length)],
  ];
  for (let i = picks.length; i < len; i++) picks.push(all[Math.floor(Math.random() * all.length)]);
  // shuffle
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.join("");
}

/**
 * ✅ SendGrid を「必要な時だけ」安全に初期化する
 */
function initSendGridIfPossible() {
  const raw = process.env.SENDGRID_API_KEY ?? "";
  const key = raw.trim().replace(/^['"]|['"]$/g, "");

  if (!key) return { ok: false as const, reason: "SENDGRID_API_KEY is empty" };
  if (!key.startsWith("SG."))
    return { ok: false as const, reason: "SENDGRID_API_KEY does not start with SG." };

  const fromEmailRaw = process.env.SENDGRID_FROM_EMAIL ?? "";
  const fromEmail = fromEmailRaw.trim().replace(/^['"]|['"]$/g, "");
  if (!fromEmail) return { ok: false as const, reason: "SENDGRID_FROM_EMAIL is empty" };

  try {
    sgMail.setApiKey(key);
    return { ok: true as const, fromEmail };
  } catch (e: any) {
    return { ok: false as const, reason: e?.message ?? "setApiKey failed" };
  }
}

function getLoginUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * メール送信 — 成否を返す
 * - includePassword=true の場合だけ plainPassword を本文に含める
 */
async function sendAccountMail(opts: {
  type: "create" | "resend" | "password_reset";
  to: string;
  name: string;
  includePassword: boolean;
  plainPassword?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const sg = initSendGridIfPossible();
  if (!sg.ok) {
    console.warn("[SendGrid] skipped:", sg.reason);
    return { sent: false, reason: sg.reason };
  }

  const loginUrl = getLoginUrl();

  const subject =
    opts.type === "create"
      ? "【KnowBase】アカウント登録完了のお知らせ"
      : opts.type === "resend"
      ? "【KnowBase】ログイン案内 再送のお知らせ"
      : "【KnowBase】パスワード再発行のお知らせ";

  const introText =
    opts.type === "create"
      ? "KnowBaseへのアカウント登録が完了しました。下記よりログインしてください。"
      : opts.type === "resend"
      ? "KnowBaseのログイン案内を再送します。下記よりログインしてください。"
      : "管理者によりパスワードが再発行されました。下記の情報でログインしてください。";

  const passwordBlock =
    opts.includePassword && opts.plainPassword
      ? `
        <div style="margin: 14px 0; padding: 12px; background:#fff7ed; border:1px solid #fed7aa; border-radius: 10px;">
          <div style="font-weight:700; margin-bottom:6px;">一時パスワード</div>
          <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 14px;">
            ${escapeHtml(opts.plainPassword)}
          </div>
          <div style="margin-top:8px; font-size:12px; color:#7c2d12;">
            ※ セキュリティのため、ログイン後はパスワード変更を推奨します
          </div>
        </div>
      `
      : "";

  const msg = {
    to: opts.to,
    from: { email: sg.fromEmail, name: "KnowBase運営事務局" },
    subject,
    html: `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Noto Sans JP'; max-width: 640px; margin: 0 auto; padding: 8px;">
        <div style="padding: 18px; border: 1px solid #e5e7eb; border-radius: 14px; background: #ffffff;">
          <p style="margin: 0 0 10px;"><b>${escapeHtml(opts.name)} 様</b></p>
          <p style="margin: 0 0 10px; color:#374151; line-height:1.6;">${escapeHtml(introText)}</p>
          ${passwordBlock}
          <a href="${loginUrl}/login"
             style="display:inline-block; background:#2563eb; color:#fff; text-decoration:none; padding:10px 14px; border-radius: 999px; font-weight:700;">
            KnowBaseへログインする
          </a>
          <div style="margin-top: 14px; font-size: 12px; color:#6b7280;">
            ログインURL: ${loginUrl}/login
          </div>
        </div>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    return { sent: true };
  } catch (err: any) {
    console.error("[User Mail Error]", { name: err?.name, message: err?.message, body: err?.response?.body });
    return { sent: false, reason: err?.message ?? "SendGrid send failed" };
  }
}

/**
 * GET /api/users
 * 全ユーザー取得（passwordHashは除外）
 */
export async function GET(req: NextRequest) {
  // 全ユーザー一覧(メール/権限/担当クラブ等)は管理者のみ。
  // 一覧GETを呼ぶのは admin 画面(/admin/users, /admin/analytics)のみ。
  // 一般ユーザー向けのパスワード再設定等は POST(mode別)で本人確認する。
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const res = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression:
           "userId, #n, email, #r, title, brandIds, deptIds, groupIds, clubCodes, areas, #p, isActive, mustChangePassword, createdAt, updatedAt, lastLoginAt",
        ExpressionAttributeNames: {
          "#n": "name",
          "#r": "role",
          "#p": "permissions",
        },
      })
    );

    const users = (res.Items || []) as KbUser[];
    users.sort((a, b) => a.userId.localeCompare(b.userId));

    return NextResponse.json({ users });
  } catch (err) {
    console.error("GET /api/users error:", (err as Error)?.name);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

/**
 * POST /api/users
 * Body: { mode, user, includePassword?, resetPassword?, newPassword? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const mode = body.mode as "create" | "update" | "delete" | "resend" | "update-password";
    const user = body.user as KbUser | undefined;

    const includePassword = body.includePassword === true;
    const resetPassword = body.resetPassword === true;

    if (!mode || !user) {
      return NextResponse.json(
        { error: "mode と user は必須です" },
        { status: 400 }
      );
    }

    // --- DELETE ---
    if (mode === "delete") {
      if (!user.userId) return NextResponse.json({ error: "userIdが必要です" }, { status: 400 });
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { userId: user.userId },
        })
      );
      return NextResponse.json({ ok: true });
    }

    // --- RESEND (パスワード忘れ & 管理画面再送) ---
    if (mode === "resend") {
      let existing: KbUser | undefined;

      if (user.userId) {
        const res = await docClient.send(
          new GetCommand({ TableName: TABLE_NAME, Key: { userId: user.userId } })
        );
        existing = res.Item as KbUser | undefined;
      } else if (user.email) {
        const res = await docClient.send(
          new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: "email = :email",
            ExpressionAttributeValues: { ":email": user.email },
          })
        );
        existing = res.Items?.[0] as KbUser | undefined;
      }

      if (!existing) {
        return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
      }
      if (existing.isActive === false) {
        return NextResponse.json(
          { error: "このアカウントは無効に設定されています。管理者に連絡してください。" },
          { status: 400 }
        );
      }

      if (resetPassword) {
        const temp = generateTempPassword(12);
        const now = new Date().toISOString();

        const putItem: KbUser = {
          ...existing,
          updatedAt: now,
          passwordHash: hashPassword(temp),
          mustChangePassword: true,
        };

        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: putItem }));

        const mailResult = await sendAccountMail({
          type: "resend",
          to: putItem.email,
          name: putItem.name,
          includePassword: includePassword,
          plainPassword: includePassword ? temp : undefined,
        });

        const responseUser: any = { ...putItem };
        delete responseUser.passwordHash;
        return NextResponse.json({ ok: true, user: responseUser, emailSent: mailResult.sent, emailError: mailResult.reason });
      }

      const mailResult = await sendAccountMail({
        type: "resend",
        to: existing.email,
        name: existing.name,
        includePassword: false,
      });

      const responseUser: any = { ...existing };
      delete responseUser.passwordHash;
      return NextResponse.json({ ok: true, user: responseUser, emailSent: mailResult.sent, emailError: mailResult.reason });
    }

    // --- UPDATE-PASSWORD (一般ユーザー自らの変更) ---
    if (mode === "update-password") {
      const rawCookie = req.cookies.get("kb_user")?.value;
      const currentUserEmail = await verifySignedValue(rawCookie);
      if (!currentUserEmail) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

      if (!user.userId) return NextResponse.json({ error: "userIdが必要です" }, { status: 400 });

      const res = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { userId: user.userId } })
      );
      const existing = res.Item as KbUser | undefined;

      if (!existing || existing.email !== currentUserEmail) {
        return NextResponse.json({ error: "権限がありません" }, { status: 403 });
      }

      const newPass = body.newPassword;
      const pwError = validateNewPassword(newPass);
      if (pwError) {
        return NextResponse.json({ error: pwError }, { status: 400 });
      }

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            ...existing,
            passwordHash: hashPassword(newPass),
            mustChangePassword: false,
            updatedAt: new Date().toISOString(),
          },
        })
      );
      return NextResponse.json({ ok: true });
    }

    // --- CREATE / UPDATE (管理画面保存) ---
    if (!user.userId) return NextResponse.json({ error: "userIdが必要です" }, { status: 400 });
    const now = new Date().toISOString();

    let existing: KbUser | undefined;
    if (mode === "update") {
      const existingRes = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: user.userId },
        })
      );
      existing = existingRes.Item as KbUser | undefined;
      if (!existing) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
    }

    let plainTempPassword: string | undefined;
    let passwordHashToSave: string | undefined =
      mode === "update" ? existing?.passwordHash : undefined;

    const shouldIssuePassword =
      (mode === "create") || (mode === "update" && resetPassword);

    if (shouldIssuePassword) {
      plainTempPassword = generateTempPassword(12);
      passwordHashToSave = hashPassword(plainTempPassword);
    }

   const mustChangePassword =
  mode === "create" ? true :
  resetPassword ? true :
  (existing?.mustChangePassword ?? false);

const KNOWN_PERMISSIONS: KbPermission[] = ["member_search", "public_pdf", "accounting"];
const requestedPermissions = Array.isArray(user.permissions) ? user.permissions : [];
const sanitizedPermissions = KNOWN_PERMISSIONS.filter((p) =>
  requestedPermissions.includes(p)
);

const requestedClubCodes = Array.isArray(user.clubCodes) ? user.clubCodes : [];
const sanitizedClubCodes = Array.from(
  new Set(requestedClubCodes.map((c) => String(c).trim()).filter(Boolean))
);
const requestedAreas: any[] = Array.isArray((user as any).areas) ? (user as any).areas : [];
const sanitizedAreas: string[] = Array.from(
  new Set(requestedAreas.map((a) => String(a).trim()).filter(Boolean))
);

const putItem: KbUser = {
  userId: user.userId,
  name: user.name ?? "",
  email: user.email ?? "",
  role: user.role ?? "viewer",
  brandIds: user.brandIds ?? [],
  deptIds: user.deptIds ?? [],
  groupIds: user.groupIds ?? [],
  clubCodes: sanitizedClubCodes,
  areas: sanitizedAreas,
  permissions: sanitizedPermissions,
  isActive: user.isActive ?? true,
  createdAt: mode === "update" ? (existing?.createdAt ?? now) : (user.createdAt ?? now),
  updatedAt: now,
  passwordHash: passwordHashToSave,
  mustChangePassword,
};

// 役職(title): 指定があれば採用、無ければ既存を保持。空/未設定は属性ごと付けない。
const keepTitle = (typeof user.title === "string" ? user.title.trim() : undefined) ?? existing?.title;
if (keepTitle) putItem.title = keepTitle;

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: putItem,
      })
    );

    let mailResult: { sent: boolean; reason?: string } | undefined;
    if (putItem.isActive) {
      if (mode === "create") {
        mailResult = await sendAccountMail({
          type: "create",
          to: putItem.email,
          name: putItem.name,
          includePassword: includePassword,
          plainPassword: includePassword ? plainTempPassword : undefined,
        });
      } else if (mode === "update" && resetPassword) {
        mailResult = await sendAccountMail({
          type: "password_reset",
          to: putItem.email,
          name: putItem.name,
          includePassword: includePassword,
          plainPassword: includePassword ? plainTempPassword : undefined,
        });
      }
    }

    const responseUser: any = { ...putItem };
    delete responseUser.passwordHash;

    return NextResponse.json({
      ok: true,
      user: responseUser,
      ...(mailResult ? { emailSent: mailResult.sent, emailError: mailResult.reason } : {}),
    });
  } catch (err) {
    console.error("POST /api/users error:", (err as Error)?.name);
    return NextResponse.json({ error: "Failed to save user" }, { status: 500 });
  }
}