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
 * Body:
 * {
 *   mode: "create" | "update" | "delete",
 *   user: KbUser,
 *   newPassword?: string
 * }
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

    /**
     * UPDATE時：既存の passwordHash を取得
     */
    let existingPasswordHash: string | undefined;

    if (mode === "update") {
      const existingRes = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: user.userId },
          ProjectionExpression: "passwordHash",
        })
      );

      existingPasswordHash = (existingRes.Item as KbUser | undefined)
        ?.passwordHash;
    }

    /**
     * パスワード処理
     */
    let passwordHashToSave = existingPasswordHash;

    if (newPassword && newPassword.trim().length > 0) {
      passwordHashToSave = mockHash(newPassword.trim());
      console.log(`[Users API] Password updated for ${user.userId}`);
    }

    /**
     * 保存データ
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

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: putItem,
      })
    );

    /**
     * レスポンスでは passwordHash を除外
     */
    const responseUser = { ...putItem };
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
