// app/api/login/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ====================================================================
// ★ 重要: パスワード検証のモック関数 (app/api/users/route.ts と一致させる)
// 本番では bcrypt.compare などに置換してください。
// ====================================================================
const mockCompare = (password: string, hash: string): boolean => {
  const result = hash === `hashed_${password}`;
  console.log(
    `[AUTH-LOG] Mock Compare Check: Input Pass='${password}', DB Hash='${hash}'. Result: ${result}`
  );
  return result;
};
// ====================================================================

// DynamoDBのユーザー型定義
type KbUser = {
  user_id: string; // PK
  name: string;
  email: string; // GSIのPK
  role: "admin" | "editor" | "viewer";
  isActive?: boolean;
  passwordHash?: string;
};

// フォールバック管理者情報
const ADMIN_EMAIL_FALLBACK = "admin@example.com";
const ADMIN_PASS_FALLBACK = "admin123";

// DynamoDBテーブル名とGSI名
const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";

// AWSクライアント設定
const region = process.env.AWS_REGION || "us-east-1";
const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * ユーザー認証（外部ログイン/パスワードログイン対応）
 */
async function authenticateUser(
  email: string,
  isExternalLogin: boolean,
  pass?: string
): Promise<KbUser | null> {
  console.log(
    `[AUTH-LOG] Starting authentication for: ${email}. External: ${isExternalLogin}`
  );

  // 1) フォールバック管理者認証
  if (!isExternalLogin && email === ADMIN_EMAIL_FALLBACK && pass === ADMIN_PASS_FALLBACK) {
    console.log(`[AUTH-LOG] Success: Fallback Admin logged in.`);
    return {
      user_id: "ADMIN_FALLBACK",
      email: ADMIN_EMAIL_FALLBACK,
      name: "Fallback Admin",
      role: "admin",
      isActive: true,
    };
  }

  // 2) DynamoDB認証（GSI: email-index）
  try {
    const params = {
      TableName: TABLE_USERS,
      IndexName: EMAIL_GSI_NAME,
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email,
      },
      Limit: 1,
    };

    const result = await docClient.send(new QueryCommand(params));
    const user = (result.Items?.[0] as KbUser) || null;

    if (!user) {
      console.log(`[AUTH-LOG] Failure: User not found in DB with email: ${email}`);
      return null;
    }

    if (user.isActive === false) {
      console.log(`[AUTH-LOG] Failure: User found but is inactive: ${email}`);
      return null;
    }

    // 2a) 外部ログイン（Google等）：DBに存在＆activeならOK
    if (isExternalLogin) {
      console.log(`[AUTH-LOG] Success: External Auth OK for: ${email}`);
      return user;
    }

    // 2b) パスワードログイン
    if (pass && user.passwordHash) {
      if (mockCompare(pass, user.passwordHash)) {
        console.log(`[AUTH-LOG] Success: Password Auth OK for: ${email}`);
        return user;
      }
      console.log(`[AUTH-LOG] Failure: Password mismatch for: ${email}`);
      return null;
    }

    if (pass && !user.passwordHash) {
      console.log(
        `[AUTH-LOG] Failure: Password provided, but DB is missing passwordHash for: ${email}`
      );
      return null;
    }

    return null;
  } catch (error) {
    console.error(
      "[AUTH-LOG] CRITICAL: DynamoDB Query Failed! Check credentials/region/table name.",
      error
    );
    return null;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const email = String(body?.email ?? "").trim();
  const passRaw = body?.pass;
  const pass = typeof passRaw === "string" ? passRaw : undefined;

  // pass が無い = 外部ログイン扱い
  const isExternalLogin = !pass;

  if (!email) {
    return NextResponse.json({ ok: false, error: "メールアドレスは必須です" }, { status: 400 });
  }

  const authenticatedUser = await authenticateUser(email, isExternalLogin, pass);

  if (!authenticatedUser) {
    return NextResponse.json(
      {
        ok: false,
        error: isExternalLogin
          ? "このメールアドレスのユーザーは登録されていないか、アクティブではありません。"
          : "メールまたはパスワードが違います",
      },
      { status: 401 }
    );
  }

  // ✅ Next.js 15: cookies() は Promise なので await が必要（Amplifyの型チェックも通る）
  const cookieStore = await cookies();

  const isAdmin = authenticatedUser.role === "admin";
  const maxAge = 60 * 60 * 24 * 7; // 7日

  cookieStore.set("kb_user", authenticatedUser.email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  if (isAdmin) {
    cookieStore.set("kb_admin", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });
  } else {
    // cookieStore.delete も Next.js 15 でOK
    cookieStore.delete("kb_admin");
  }

  return NextResponse.json({
    ok: true,
    user: { email: authenticatedUser.email, role: authenticatedUser.role },
  });
}
