// app/api/me/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const region = process.env.AWS_REGION || "us-east-1";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,      // ✅ dev(http)では false / 本番(https)では true
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7日
  };
}

export async function GET() {
  // ✅ Next.js 15 対応：cookies() は Promise 扱いになるので await
  const cookieStore = await cookies();

  // kb_user は「email」が入っている前提
  const email = (cookieStore.get("kb_user")?.value ?? "").trim();

  if (!email) {
    return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_USERS,
        IndexName: EMAIL_GSI_NAME,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
        ProjectionExpression:
          "userId, #n, email, #r, brandIds, deptIds, groupIds, isActive, mustChangePassword, createdAt, updatedAt",
        ExpressionAttributeNames: {
          "#n": "name",
          "#r": "role",
        },
      })
    );

    const user = result.Items?.[0] as any;

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }
    if (user.isActive === false) {
      return NextResponse.json({ ok: false, error: "Inactive user" }, { status: 403 });
    }

    // ✅ ここが最短修正：kb_userid を補完して発行（/api/account/password がこれを必要とする）
    const res = NextResponse.json({
      ok: true,
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        brandIds: user.brandIds ?? [],
        deptIds: user.deptIds ?? [],
        groupIds: user.groupIds ?? [],
        isActive: user.isActive ?? true,
        mustChangePassword: user.mustChangePassword === true,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });

    // kb_user（email）も念のため揃える（ログインが別実装でもここで補完される）
    res.cookies.set("kb_user", String(user.email ?? email).trim(), cookieOptions());
    res.cookies.set("kb_userid", String(user.userId ?? "").trim(), cookieOptions());

    return res;
  } catch (error: any) {
    console.error("API Me Error:", error?.name, error?.message);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
