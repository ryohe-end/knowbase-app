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
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

// ✅ DynamoDBの「文字/ {S:""} / 混在配列」を string[] に正規化
function normalizeStringArray(raw: any): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((x) => {
      if (!x) return "";
      if (typeof x === "string") return x;
      if (typeof x === "object" && "S" in x) return String((x as any).S);
      return String(x);
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET() {
  const cookieStore = await cookies();
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

    // ✅ ここが今回の本丸：groupIdsを正規化して primary groupId も作る
    const groupIds = normalizeStringArray(user.groupIds);
    const groupId = groupIds[0] || ""; // 先頭を primary として扱う

    const res = NextResponse.json({
      ok: true,
      user: {
        userId: String(user.userId ?? "").trim(),
        name: user.name,
        email: user.email,
        role: user.role,

        brandIds: normalizeStringArray(user.brandIds),
        deptIds: normalizeStringArray(user.deptIds),

        // ✅ 両方返す（フロント互換）
        groupId,      // ← 追加：page.tsx が今見てるやつ
        groupIds,     // ← string[] に正規化して返す

        isActive: user.isActive ?? true,
        mustChangePassword: user.mustChangePassword === true,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });

    res.cookies.set("kb_user", String(user.email ?? email).trim(), cookieOptions());
    res.cookies.set("kb_userid", String(user.userId ?? "").trim(), cookieOptions());

    return res;
  } catch (error: any) {
    console.error("API Me Error:", error?.name, error?.message);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
