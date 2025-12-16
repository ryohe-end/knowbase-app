// /app/api/users/route.ts

import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

// ★★★ パスワードハッシュ生成のモック関数を定義 ★★★
// 実際の環境では 'bcrypt' などのライブラリを使用し、
// 'await bcrypt.hash(password, saltRounds)' の結果を返してください。
const mockHash = (password: string): string => {
    // 【MOCKロジック】: デモのため、ハッシュは 'hashed_' + パスワード とします。
    return `hashed_${password}`; 
};
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★


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
  // DBからの取得時には存在し得る
  passwordHash?: string; 
};


const region = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = "yamauchi-Users";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * GET /api/users
 * → 全ユーザー一覧
 */
export async function GET() {
  try {
    const res = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        // パスワードハッシュはセキュリティのため、管理画面であっても除外することが推奨されます
        ProjectionExpression: "userId, #n, email, #r, brandIds, deptIds, groupIds, isActive, createdAt, updatedAt",
        ExpressionAttributeNames: {
            "#n": "name",
            "#r": "role",
        }
      })
    );

    const users = (res.Items || []) as KbUser[];
    users.sort((a, b) => a.userId.localeCompare(b.userId));
    return NextResponse.json({ users });
  } catch (err: any) {
    console.error("GET /api/users error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch users",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/users
 * Body: { mode: "create" | "update" | "delete", user: KbUser, newPassword?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = body.mode as "create" | "update" | "delete";
    const user = body.user as KbUser | undefined;
    const newPassword = body.newPassword as string | undefined; // ★ 追加: 平文パスワード

    if (!mode || !user || !user.userId) {
      return NextResponse.json(
        { error: "mode と user.userId は必須です。" },
        { status: 400 }
      );
    }

    if (mode === "delete") {
      // 削除処理
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { userId: user.userId },
        })
      );
      return NextResponse.json({ ok: true });
    }

    // create / update 共通
    const now = new Date().toISOString();

    // 既存のユーザー情報を取得してハッシュを維持する（更新モードの場合）
    let existingPasswordHash: string | undefined = undefined;
    
    if (mode === 'update') {
        // 更新時、パスワードを変更しない場合に備え、既存のハッシュを取得する
        // ※ DynamoDBDocumentClient の GetCommand は属性名をそのまま扱えるため便利です。
        const existingRes = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "userId = :uid", // PKで検索
            ExpressionAttributeValues: { ":uid": user.userId },
            ProjectionExpression: "passwordHash",
            Limit: 1
        }));
        existingPasswordHash = (existingRes.Items?.[0] as KbUser)?.passwordHash;
    }

    let passwordHashToSave = existingPasswordHash;

    // ★ パスワードが提供された場合、ハッシュ化して保存
    if (newPassword && newPassword.trim().length > 0) {
        try {
            // 【実運用で置き換える部分】: await bcrypt.hash(newPassword, saltRounds)
            passwordHashToSave = mockHash(newPassword.trim()); 
            console.log(`[Users API] New password set for ${user.userId}. Hash (MOCK) generated.`);
        } catch (hashError) {
            console.error("Password hashing failed:", hashError);
            return NextResponse.json(
                { error: "パスワードのハッシュ化に失敗しました。" },
                { status: 500 }
            );
        }
    }


    const putItem: KbUser = {
      userId: user.userId,
      name: user.name ?? "",
      email: user.email ?? "",
      role: (user.role as any) ?? "viewer",
      brandIds: user.brandIds ?? [],
      deptIds: user.deptIds ?? [],
      groupIds: user.groupIds ?? [],
      isActive: user.isActive ?? true,
      createdAt: user.createdAt ?? now,
      updatedAt: now,
      // ★ ハッシュ値を設定。新しいパスワードがあればハッシュ化された値、なければ既存の値
      passwordHash: passwordHashToSave, 
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: putItem,
      })
    );

    // 返却時にはパスワードハッシュを削除してセキュリティを確保
    const userWithoutHash = { ...putItem };
    delete userWithoutHash.passwordHash;

    return NextResponse.json({ ok: true, user: userWithoutHash });
  } catch (err: any) {
    console.error("POST /api/users error:", err);
    return NextResponse.json(
      {
        error: "Failed to save user",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}