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
 * ★ パスワードハッシュ生成（モック）
 * 本番では bcrypt.hash に置き換える
 */
const mockHash = (password: string): string => `hashed_${password}`;

/**
 * ✅ SendGrid を「必要な時だけ」安全に初期化する
 * - 本番 env が空/クォート付き/壊れてても users API 全体が死なない
 */
function initSendGridIfPossible() {
  const raw = process.env.SENDGRID_API_KEY ?? "";
  const key = raw.trim().replace(/^['"]|['"]$/g, ""); // 先頭末尾のクォート除去（'SG...' や "SG..." 対策）

  if (!key) return { ok: false as const, reason: "SENDGRID_API_KEY is empty" };
  if (!key.startsWith("SG.")) return { ok: false as const, reason: "SENDGRID_API_KEY does not start with SG." };

  try {
    sgMail.setApiKey(key);
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, reason: e?.message ?? "setApiKey failed" };
  }
}

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
    console.error("GET /api/users error:", {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
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

    // DELETE
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

    // UPDATE時：既存 passwordHash を保持
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

    // パスワード更新判定
    const isPasswordReset = !!(newPassword && newPassword.trim().length > 0);
    let passwordHashToSave = existingPasswordHash;

    if (isPasswordReset) {
      passwordHashToSave = mockHash(newPassword!.trim());
      console.log(`[Users API] Password set/updated for ${user.userId}`);
    }

    // 保存用データ
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

    // DynamoDBへ保存
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: putItem,
      })
    );

    // ✅ メールは「失敗しても users 登録は成功」にする（ここ重要）
    if ((mode === "create" || (mode === "update" && isPasswordReset)) && putItem.isActive) {
      const sg = initSendGridIfPossible();
      if (!sg.ok) {
        console.warn("[SendGrid] skipped:", sg.reason);
      } else {
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
          from: {
            email: process.env.SENDGRID_FROM_EMAIL!,
            name: "KnowBase運営事務局",
          },
          subject,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <p><b>${putItem.name} 様</b></p>
              <p>${introText}</p>
              <p><a href="${loginUrl}/login">KnowBaseへログインする</a></p>
            </div>
          `,
        };

        sgMail.send(msg).catch((err: any) =>
          console.error("[User Mail Error]", { name: err?.name, message: err?.message })
        );
      }
    }

    // レスポンス（passwordHash除外）
    const responseUser: any = { ...putItem };
    delete responseUser.passwordHash;

    return NextResponse.json({ ok: true, user: responseUser });
  } catch (err: any) {
    console.error("POST /api/users error:", {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
    return NextResponse.json(
      { error: "Failed to save user", detail: err?.message, name: err?.name },
      { status: 500 }
    );
  }
}
