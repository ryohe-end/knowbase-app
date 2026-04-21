// app/api/account/password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { hashPassword, validateNewPassword, verifyPassword } from "@/lib/password";
import { verifySignedValue } from "@/lib/auth";

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

async function findUserById(userId: string): Promise<KbUser | null> {
  if (!userId) return null;
  try {
    const res = await docClient.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { userId } })
    );
    return (res.Item as KbUser) || null;
  } catch (err) {
    console.error("DynamoDB Get error:", (err as Error)?.name);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // 署名済み Cookie からユーザーを特定
    const userId =
      (await verifySignedValue(req.cookies.get("kb_uid")?.value)) || "";
    const email =
      (await verifySignedValue(req.cookies.get("kb_user")?.value)) || "";

    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");
    const newPassword2 = String(body?.newPassword2 ?? "");

    if (!currentPassword) {
      return NextResponse.json({ error: "現在のパスワードを入力してください" }, { status: 400 });
    }
    const pwError = validateNewPassword(newPassword);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    if (newPassword !== newPassword2) {
      return NextResponse.json({ error: "新しいパスワード（確認）が一致しません" }, { status: 400 });
    }
    if (newPassword === currentPassword) {
      return NextResponse.json({ error: "新しいパスワードが現在のパスワードと同じです" }, { status: 400 });
    }

    const existing = await findUserById(userId);
    if (!existing) {
      return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
    }
    if (existing.isActive === false) {
      return NextResponse.json({ error: "このアカウントは無効に設定されています。" }, { status: 400 });
    }
    // Cookie の email と DB の email が一致することを確認（cookie 改ざん対策の二重防御）
    if (email && existing.email && existing.email !== email) {
      return NextResponse.json({ error: "認証エラー" }, { status: 403 });
    }

    if (!verifyPassword(currentPassword, existing.passwordHash)) {
      return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const putItem: KbUser = {
      ...existing,
      passwordHash: hashPassword(newPassword),
      updatedAt: now,
      mustChangePassword: false,
    };

    await docClient.send(
      new PutCommand({ TableName: TABLE_NAME, Item: putItem })
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/account/password error:", (err as Error)?.name);
    return NextResponse.json({ error: "パスワード更新中にエラーが発生しました" }, { status: 500 });
  }
}
