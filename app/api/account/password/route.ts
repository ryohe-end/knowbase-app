// app/api/account/password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  mustChangePassword?: boolean;
};

const region = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = "yamauchi-Users";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * ★ パスワードハッシュ生成（現在のシステムの仕様に合わせたモック）
 */
const mockHash = (password: string): string => `hashed_${password}`;

/**
 * Cookieから現在のユーザーIDを取得
 */
function getCurrentUserId(req: NextRequest) {
  // /api/me が kb_userid を補完してくれる想定
  return req.cookies.get("kb_userid")?.value || "";
}

/**
 * Cookieから現在のメールアドレスを取得（ログ用）
 * ※ kb_user は email が入っている前提
 */
function getCurrentUserEmail(req: NextRequest) {
  const cookieValue = req.cookies.get("kb_user")?.value ?? "";
  try {
    return decodeURIComponent(cookieValue).trim();
  } catch {
    return cookieValue.trim();
  }
}

/**
 * userId（主キー）を条件に DynamoDB からユーザーを直接取得
 */
async function findUserById(userId: string): Promise<KbUser | null> {
  if (!userId) return null;
  try {
    const res = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId: userId },
      })
    );
    return (res.Item as KbUser) || null;
  } catch (err) {
    console.error("DynamoDB Get error:", err);
    return null;
  }
}

/**
 * パスワード強度の検証
 */
function validatePassword(pw: string) {
  if (!pw || pw.length < 8) return "パスワードは8文字以上で入力してください";
  if (pw.length > 64) return "パスワードは64文字以内にしてください";
  return "";
}

/**
 * POST: パスワード変更実行
 */
export async function POST(req: NextRequest) {
  try {
    const userId = getCurrentUserId(req);
    const email = getCurrentUserEmail(req);

    console.log(`Password change attempt: userId=[${userId}], email=[${email}]`);

    if (!userId) {
      return NextResponse.json(
        { error: "認証が必要です（kb_userid cookie が見つかりません。/api/me を先に呼ぶ必要があります）" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");
    const newPassword2 = String(body?.newPassword2 ?? "");

    if (!currentPassword) {
      return NextResponse.json({ error: "現在のパスワードを入力してください" }, { status: 400 });
    }
    const v = validatePassword(newPassword);
    if (v) return NextResponse.json({ error: v }, { status: 400 });

    if (newPassword !== newPassword2) {
      return NextResponse.json({ error: "新しいパスワード（確認）が一致しません" }, { status: 400 });
    }
    if (newPassword === currentPassword) {
      return NextResponse.json({ error: "新しいパスワードが現在のパスワードと同じです" }, { status: 400 });
    }

    const existing = await findUserById(userId);
    if (!existing) {
      return NextResponse.json(
        {
          error: `ユーザーが見つかりません (ID: ${userId})`,
          detail: `Email from cookie: ${email}`,
        },
        { status: 404 }
      );
    }

    if (existing.isActive === false) {
      return NextResponse.json({ error: "このアカウントは無効に設定されています。" }, { status: 400 });
    }

    const currentHash = mockHash(currentPassword);
    if (!existing.passwordHash || existing.passwordHash !== currentHash) {
      return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const putItem: KbUser = {
      ...existing,
      passwordHash: mockHash(newPassword),
      updatedAt: now,
      mustChangePassword: false,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: putItem,
      })
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("POST /api/account/password error:", err);
    return NextResponse.json(
      { error: "パスワード更新中にエラーが発生しました", detail: err?.message },
      { status: 500 }
    );
  }
}
