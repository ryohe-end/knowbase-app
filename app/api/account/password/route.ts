import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

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
 * ★ パスワードハッシュ生成（モック）
 * 実際には bcrypt 等を使用しますが、現在の仕様に合わせています。
 */
const mockHash = (password: string): string => `hashed_${password}`;

/**
 * 管理者判定（合言葉チェック）
 */
function isAdminRequest(req: NextRequest) {
  const KB_ADMIN_API_KEY = (process.env.KB_ADMIN_API_KEY || "").trim();
  if (!KB_ADMIN_API_KEY) return true; // 設定されていなければスルー
  const key = (req.headers.get("x-kb-admin-key") || "").trim();
  return key === KB_ADMIN_API_KEY;
}

/**
 * Cookieから現在のユーザーのメールアドレスを取得
 */
function getCurrentUserEmail(req: NextRequest) {
  const cookieValue = req.cookies.get("kb_user")?.value ?? "";
  // 🔴 メールの @ が %40 などにエンコードされている場合があるためデコードする
  try {
    return decodeURIComponent(cookieValue).trim();
  } catch (e) {
    return cookieValue.trim();
  }
}

/**
 * email を条件に DynamoDB からユーザーを検索
 */
async function findUserByEmail(email: string): Promise<KbUser | null> {
  if (!email) return null;
  const res = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "email = :email",
      ExpressionAttributeValues: { ":email": email },
      Limit: 1,
    })
  );
  const u = (res.Items?.[0] as KbUser | undefined) ?? undefined;
  return u ?? null;
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
    // 1. 管理者キーのチェック（任意）
    if (!isAdminRequest(req)) {
      // 本来は管理画面操作なら必須にしても良いですが、
      // ユーザー自身の変更なら Cookie 重視で OK です
    }

    // 2. Cookieからメール取得
    const email = getCurrentUserEmail(req);
    if (!email) {
      return NextResponse.json({ error: "認証が必要です（セッションが見つかりません）" }, { status: 401 });
    }

    // 3. リクエストボディの解析
    const body = await req.json().catch(() => ({}));
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");
    const newPassword2 = String(body?.newPassword2 ?? "");

    // 4. 入力バリデーション
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

    // 5. ユーザーの特定
    const existing = await findUserByEmail(email);
    if (!existing) {
      // ここでエラーが出る場合は DynamoDB の email と Cookie の値が完全一致しているか確認
      return NextResponse.json({ error: `ユーザーが見つかりません (${email})` }, { status: 404 });
    }

    if (existing.isActive === false) {
      return NextResponse.json(
        { error: "このアカウントは無効に設定されています。管理者に連絡してください。" },
        { status: 400 }
      );
    }

    // 6. 現在のパスワード確認
    const currentHash = mockHash(currentPassword);
    if (!existing.passwordHash || existing.passwordHash !== currentHash) {
      return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 400 });
    }

    // 7. 更新処理
    const now = new Date().toISOString();
    const putItem: KbUser = {
      ...existing,
      passwordHash: mockHash(newPassword),
      updatedAt: now,
      mustChangePassword: false, // 変更完了でフラグをオフにする
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: putItem,
      })
    );

    return NextResponse.json({ ok: true });

  } catch (err: any) {
    console.error("POST /api/account/password error:", {
      name: err?.name,
      message: err?.message,
    });
    return NextResponse.json(
      { error: "Failed to update password", detail: err?.message },
      { status: 500 }
    );
  }
}