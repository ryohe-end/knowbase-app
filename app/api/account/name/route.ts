import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

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
};

const region = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = "yamauchi-Users";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

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

function normalizeName(name: string) {
  // 全角スペースも含めてトリム
  return name.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const email = getCurrentUserEmail(req);
    if (!email) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const nextNameRaw = String(body?.name ?? "");
    const nextName = normalizeName(nextNameRaw);

    if (!nextName || nextName.length < 1) {
      return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
    }
    if (nextName.length > 40) {
      return NextResponse.json({ error: "名前は40文字以内にしてください" }, { status: 400 });
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

    const now = new Date().toISOString();
    const putItem: KbUser = {
      ...existing,
      name: nextName,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: putItem,
      })
    );

    // passwordHash は返さない
    const responseUser: any = { ...putItem };
    delete responseUser.passwordHash;

    return NextResponse.json({ ok: true, user: responseUser });
  } catch (err: any) {
    console.error("POST /api/account/name error:", {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
    return NextResponse.json(
      { error: "Failed to update name", detail: err?.message },
      { status: 500 }
    );
  }
}
