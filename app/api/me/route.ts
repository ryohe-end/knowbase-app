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

export async function GET() {
  const cookieStore = cookies();
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

    return NextResponse.json({
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

        // ✅ 追加
        mustChangePassword: user.mustChangePassword === true,

        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error: any) {
    console.error("API Me Error:", error?.name, error?.message);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
