// app/api/users/route.ts
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

// SendGrid（使う直前に初期化する）
let sendgridInitialized = false;

function initSendGrid() {
  if (sendgridInitialized) return;

  const key = process.env.SENDGRID_API_KEY ?? "";
  const from = process.env.SENDGRID_FROM_EMAIL ?? "";

  console.log("[SendGrid key check]", {
    hasKey: !!key,
    prefix: key.slice(0, 3),
    len: key.length,
    hasFrom: !!from,
  });

  if (!key) throw new Error("Missing env: SENDGRID_API_KEY");
  if (!key.startsWith("SG.")) throw new Error("Invalid SENDGRID_API_KEY (must start with 'SG.')");
  if (!from) throw new Error("Missing env: SENDGRID_FROM_EMAIL");

  sgMail.setApiKey(key);
  sendgridInitialized = true;
}

function getSendGridFrom() {
  const from = process.env.SENDGRID_FROM_EMAIL ?? "";
  if (!from) throw new Error("Missing env: SENDGRID_FROM_EMAIL");
  return from;
}

/**
 * ★ パスワードハッシュ生成（モック）
 * 本番では bcrypt.hash に置き換える
 */
const mockHash = (password: string): string => {
  return `hashed_${password}`;
};

export type KbUserRole = "admin" | "editor" | "viewer";

export type KbUser = {
  userId: string;
  name: string;
  email: string;
  role: KbUserRole;
  brandIds?: string[];
  deptIds?: string[];
  groupIds?: string[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  passwordHash?: string;
};

const region = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = "yamauchi-Users";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * GET /api/users
 * 全ユーザー取得（passwordHashは除外）
 */
export async function GET() {
  try {
    const res = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression:
          "userId, #n, email, #r, brandIds, deptIds, groupIds, isActive, createdAt, updatedAt",
        ExpressionAttributeNames: {
          "#n": "name",
          "#r": "role",
        },
      })
    );

    const users = (res.Items || []) as KbUser[];
    users.sort((a, b) => a.userId.localeCompare(b.userId));

    return NextResponse.json({ users });
  } catch (err: any) {
    console.error("GET /api/users error:", err);
    return NextResponse.json(
      { error: "Failed to fetch users", detail: err?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/users
 * Body: { mode, user, newPassword }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = body.mode as "create" | "update" | "delete";
    const user = body.user as KbUser | undefined;
    const newPassword = body.newPassword as string | undefined;

    if (!mode || !user || !user.userId) {
      return NextResponse.json(
        { error: "mode と user.userId は必須です" },
        { status: 400 }
      );
    }

    /**
     * DELETE
     */
    if (mode === "delete") {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { userId: user.userId },
        })
      );
      return NextResponse.json({ ok: true });
    }

    const now = new Date().toISOString();
    let existingPasswordHash: string | undefined;

    /**
     * UPDATE時：既存の passwordHash を保持させる
     */
    if (mode === "update") {
      const existingRes = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: user.userId },
          ProjectionExpression: "passwordHash",
        })
      );
      existingPasswordHash = (existingRes.Item as KbUser | undefined)?.passwordHash;
    }

    /**
     * パスワード更新判定
     */
    const isPasswordReset = !!(newPassword && newPassword.trim().length > 0);
    let passwordHashToSave = existingPasswordHash;

    if (isPasswordReset) {
      passwordHashToSave = mockHash(newPassword!.trim());
      console.log(`[Users API] Password set/updated for ${user.userId}`);
    }

    /**
     * 保存用データオブジェクトの作成
     */
    const putItem: KbUser = {
      userId: user.userId,
      name: user.name ?? "",
      email: user.email ?? "",
      role: user.role ?? "viewer",
      brandIds: user.brandIds ?? [],
      deptIds: user.deptIds ?? [],
      groupIds: user.groupIds ?? [],
      isActive: user.isActive ?? true,
      createdAt: user.createdAt ?? now,
      updatedAt: now,
      passwordHash: passwordHashToSave,
    };

    /**
     * DynamoDBへ保存
     */
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: putItem,
      })
    );

    /**
     * ★ メール再送信ロジック ★
     * 条件: 有効(isActive) 且つ (新規作成 OR パスワード入力あり)
     */
    if ((mode === "create" || (mode === "update" && isPasswordReset)) && putItem.isActive) {
      // ✅ 送信する直前に初期化
      initSendGrid();
      const from = getSendGridFrom();

      const loginUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

      const subject =
        mode === "create"
          ? "【KnowBase】アカウント登録完了のお知らせ"
          : "【KnowBase】ログイン情報更新のお知らせ";

      const introText =
        mode === "create"
          ? "KnowBaseへのアカウント登録が完了しました。本システムでは社内のマニュアルや最新のお知らせをいつでも確認いただけます。"
          : "管理者によってアカウント情報、またはパスワードが更新されました。最新の情報でログインしてご利用ください。";

      const msg = {
        to: putItem.email,
        from: { email: from, name: "KnowBase運営事務局" },
        subject,
        html: `
          <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #334155; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #0f172a; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">KnowBase Notice</h1>
            </div>
            <div style="padding: 30px; background-color: #ffffff;">
              <p style="font-size: 16px; font-weight: bold;">${putItem.name} 様</p>
              <p>${introText}</p>

              <div style="background-color: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; font-weight: bold; color: #0369a1;">💡 KnowBaseでできること</p>
                <ul style="margin: 10px 0 0 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
                  <li>AIアシスタント「Knowbie」への質問（チャット形式）</li>
                  <li>最新マニュアルの検索・閲覧</li>
                  <li>本部や部署からの重要通知の確認</li>
                </ul>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${loginUrl}/login" style="background-color: #0ea5e9; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                  KnowBaseへログインする
                </a>
              </div>

              <p style="font-size: 13px; color: #64748b;">
                ※初期パスワードは管理者より案内されたもの、またはご自身で設定したものをご使用ください。<br>
                ※このメールは送信専用です。お心当たりがない場合は破棄してください。
              </p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
              &copy; KnowBase All Rights Reserved.
            </div>
          </div>
        `,
      };

      // 送信（失敗しても API 全体は落とさない）
      sgMail.send(msg).catch((err) => console.error("[User Mail Error]", err));
    }

    /**
     * レスポンス返却（パスワードハッシュは隠す）
     */
    const responseUser: any = { ...putItem };
    delete responseUser.passwordHash;

    return NextResponse.json({ ok: true, user: responseUser });
  } catch (err: any) {
    console.error("POST /api/users error:", err);
    return NextResponse.json(
      { error: "Failed to save user", detail: err?.message },
      { status: 500 }
    );
  }
}
