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
import { hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import { makeAdminCookiePayload, signValue } from "@/lib/auth";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KbUser = {
  userId?: string;
  user_id?: string;
  uid?: string;
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

async function authenticateUser(
  email: string,
  isExternalLogin: boolean,
  pass?: string
): Promise<KbUser | null> {
  if (
    !isExternalLogin &&
    email === ADMIN_EMAIL_FALLBACK &&
    pass === ADMIN_PASS_FALLBACK
  ) {
    return {
      userId: "ADMIN_FALLBACK",
      email: ADMIN_EMAIL_FALLBACK,
      name: "Fallback Admin",
      role: "admin",
      isActive: true,
    };
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_USERS,
        IndexName: EMAIL_GSI_NAME,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
      })
    );
    const user = (result.Items?.[0] as KbUser) || null;

    if (!user || user.isActive === false) return null;
    if (isExternalLogin) return user;

    if (pass && verifyPassword(pass, user.passwordHash)) {
      return user;
    }
    return null;
  } catch (error) {
    console.error("[login] DynamoDB error:", (error as Error)?.name);
    return null;
  }
}

function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const email = String((body as any)?.email ?? "").trim();
  const passRaw = (body as any)?.pass;
  const pass = typeof passRaw === "string" ? passRaw : undefined;
  const isExternalLogin = !pass;

  if (!email) {
    return NextResponse.json({ ok: false, error: "メールアドレスは必須です" }, { status: 400 });
  }

  const authenticatedUser = await authenticateUser(email, isExternalLogin, pass);
  if (!authenticatedUser) {
    // 失敗ログインも監査に残す(不正アクセスの兆候検知)。userId=試行メール。
    void writeAudit({
      userId: email,
      action: "auth.login.failed",
      detail: { external: isExternalLogin },
      ip: clientIp(req),
      result: "error",
    });
    return NextResponse.json({ ok: false, error: "認証に失敗しました" }, { status: 401 });
  }

  const uid =
    String(
      authenticatedUser.userId ?? authenticatedUser.user_id ?? authenticatedUser.uid ?? ""
    ).trim() || `EMAIL:${authenticatedUser.email}`;

  const nowIso = new Date().toISOString();

  // Opportunistic rehash to upgrade legacy "hashed_<plain>" entries.
  if (
    !isExternalLogin &&
    pass &&
    uid !== "ADMIN_FALLBACK" &&
    !uid.startsWith("EMAIL:") &&
    needsRehash(authenticatedUser.passwordHash)
  ) {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_USERS,
          Key: { userId: uid },
          UpdateExpression: "set passwordHash = :h, updatedAt = :u",
          ExpressionAttributeValues: {
            ":h": hashPassword(pass),
            ":u": nowIso,
          },
        })
      );
    } catch {
      // Non-fatal: user still logs in with legacy hash.
    }
  }

  if (uid !== "ADMIN_FALLBACK" && !uid.startsWith("EMAIL:")) {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_USERS,
          Key: { userId: uid },
          UpdateExpression: "set lastLoginAt = :now",
          ExpressionAttributeValues: { ":now": nowIso },
        })
      );
    } catch {
      /* non-fatal */
    }
  }

  if (uid !== "ADMIN_FALLBACK") {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_LOGIN_LOGS,
          Item: {
            logId: randomUUID(),
            userId: uid,
            loggedAt: nowIso,
          },
        })
      );
    } catch {
      /* non-fatal */
    }
  }

  // ログイン成功を監査トレイルに統合(以降の操作と同じ knowbie-audit-logs 上で時系列追跡可能に)。
  void writeAudit({
    userId: authenticatedUser.email,
    userName: authenticatedUser.name,
    action: "auth.login",
    detail: { role: authenticatedUser.role, external: isExternalLogin, uid },
    ip: clientIp(req),
    result: "ok",
  });

  const cookieStore = await cookies();
  const isAdmin = authenticatedUser.role === "admin";

  const opts = cookieOptions();

  cookieStore.set("kb_user", await signValue(authenticatedUser.email), opts);
  cookieStore.set("kb_uid", await signValue(uid), opts);

  if (isAdmin) {
    cookieStore.set("kb_admin", await makeAdminCookiePayload(authenticatedUser.email), opts);
  } else {
    cookieStore.delete("kb_admin");
  }

  return NextResponse.json({
    ok: true,
    user: { email: authenticatedUser.email, role: authenticatedUser.role },
  });
}
