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

  // ✅ 追加
  mustChangePassword?: boolean;
};

const region = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = "yamauchi-Users";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// ★ パスワードハッシュ生成（モック）
const mockHash = (password: string): string => `hashed_${password}`;

function getCurrentUserEmail(req: NextRequest) {
  const email = req.cookies.get("kb_user")?.value ?? "";
  return email.trim();
}

// email -> user を取得（※ email がキーじゃない前提なので scan）
async function findUserByEmail(email: string): Promise<KbUser | null> {
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

function validatePassword(pw: string) {
  if (!pw || pw.length < 8) return "パスワードは8文字以上で入力してください";
  if (pw.length > 64) return "パスワードは64文字以内にしてください";
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const email = getCurrentUserEmail(req);
    if (!email) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
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

    const existing = await findUserByEmail(email);
    if (!existing) {
      return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
    }
    if (existing.isActive === false) {
      return NextResponse.json(
        { error: "このアカウントは無効に設定されています。管理者に連絡してください。" },
        { status: 400 }
      );
    }

    // 現在パスワード確認（mockHash 前提）
    const currentHash = mockHash(currentPassword);
    if (!existing.passwordHash || existing.passwordHash !== currentHash) {
      return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 400 });
    }

    const now = new Date().toISOString();

    const putItem: KbUser = {
      ...existing,
      passwordHash: mockHash(newPassword),
      updatedAt: now,

      // ✅ ここが重要：変更完了で強制フラグ解除
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
    console.error("POST /api/account/password error:", {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
    return NextResponse.json(
      { error: "Failed to update password", detail: err?.message },
      { status: 500 }
    );
  }
}
