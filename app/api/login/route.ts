import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ====================================================================
// ★ 重要: パスワード検証のモック関数
// ====================================================================
const mockCompare = (password: string, hash: string): boolean => {
  const result = hash === `hashed_${password}`;
  console.log(
    `[AUTH-LOG] Mock Compare Check: Input Pass='${password}', DB Hash='${hash}'. Result: ${result}`
  );
  return result;
};

// DynamoDBのユーザー型定義
type KbUser = {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  isActive?: boolean;
  passwordHash?: string;
};

const ADMIN_EMAIL_FALLBACK = "admin@example.com";
const ADMIN_PASS_FALLBACK = "admin123";

const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const TABLE_LOGIN_LOGS = "yamauchi-LoginLogs";

const region = process.env.AWS_REGION || "us-east-1";
const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * ユーザー認証
 */
async function authenticateUser(
  email: string,
  isExternalLogin: boolean,
  pass?: string
): Promise<KbUser | null> {
  if (!isExternalLogin && email === ADMIN_EMAIL_FALLBACK && pass === ADMIN_PASS_FALLBACK) {
    return {
      userId: "ADMIN_FALLBACK",
      email: ADMIN_EMAIL_FALLBACK,
      name: "Fallback Admin",
      role: "admin",
      isActive: true,
    };
  }

  try {
    const params = {
      TableName: TABLE_USERS,
      IndexName: EMAIL_GSI_NAME,
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: { ":email": email },
      Limit: 1,
    };
    const result = await docClient.send(new QueryCommand(params));
    const user = (result.Items?.[0] as KbUser) || null;

    if (!user || user.isActive === false) return null;
    if (isExternalLogin) return user;

    if (pass && user.passwordHash && mockCompare(pass, user.passwordHash)) {
      return user;
    }
    return null;
  } catch (error) {
    console.error("[AUTH-LOG] DynamoDB Error", error);
    return null;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const email = String(body?.email ?? "").trim();
  const passRaw = body?.pass;
  const pass = typeof passRaw === "string" ? passRaw : undefined;
  const isExternalLogin = !pass;

  if (!email) {
    return NextResponse.json({ ok: false, error: "メールアドレスは必須です" }, { status: 400 });
  }

  const authenticatedUser = await authenticateUser(email, isExternalLogin, pass);

  if (!authenticatedUser) {
    return NextResponse.json({ ok: false, error: "認証に失敗しました" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  // ✅ 1) lastLoginAt 更新（フォールバック管理者はDBにいないのでスキップ）
  if (authenticatedUser.userId !== "ADMIN_FALLBACK") {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_USERS,
          Key: { userId: authenticatedUser.userId },
          UpdateExpression: "set lastLoginAt = :now",
          ExpressionAttributeValues: { ":now": nowIso },
        })
      );
    } catch (err) {
      console.error("Failed to update lastLoginAt", err);
      // ログイン自体は成功させる
    }

    // ✅ 2) ログインログを1件記録（これが “ログイン成功直後”）
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_LOGIN_LOGS,
          Item: {
            logId: randomUUID(),
            userId: authenticatedUser.userId,
            loggedAt: nowIso,
          },
        })
      );
    } catch (err) {
      console.error("Failed to write login log", err);
      // ログイン自体は成功させる
    }
  }

  const cookieStore = await cookies();
  const isAdmin = authenticatedUser.role === "admin";

  // ✅ 超重要：kb_user は “userId” を入れる（ログ/集計と一致させる）
  cookieStore.set("kb_user", authenticatedUser.userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  // （任意）emailも必要なら別cookieに
  cookieStore.set("kb_email", authenticatedUser.email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  if (isAdmin) {
    cookieStore.set("kb_admin", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  } else {
    cookieStore.delete("kb_admin");
  }

  return NextResponse.json({
    ok: true,
    user: { email: authenticatedUser.email, role: authenticatedUser.role },
  });
}