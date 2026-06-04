// app/api/store-settings/stores/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- DynamoDB (ユーザー認証) ---
const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const region = process.env.AWS_REGION || "us-east-1";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// --- PostgreSQL (店舗マスタ) ---
const PG_CONNECTION = process.env.PG_DATABASE_URL
  || "postgres://wf_member_app_prod:UA5JAaqYeyVGUpD@188.93.146.126:5432/wf_member_app_prod";

const pool = new Pool({
  connectionString: PG_CONNECTION,
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

function normalizeStringArray(raw: any): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((x: any) => {
      if (!x) return "";
      if (typeof x === "string") return x;
      if (typeof x === "object" && "S" in x) return String(x.S);
      return String(x);
    })
    .map((s: string) => s.trim())
    .filter(Boolean);
}

// 住所から都道府県を抽出
function extractPrefecture(address: string | null): string {
  if (!address) return "";
  const match = address.match(/^(.{2,3}[都道府県])/);
  return match ? match[1] : "";
}

async function getCurrentUser() {
  try {
    const cookieStore = await cookies();
    const rawUser = cookieStore.get("kb_user")?.value ?? "";
    const email = (await verifySignedValue(rawUser)) ?? "";
    if (!email) return null;

    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_USERS,
        IndexName: EMAIL_GSI_NAME,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
        ProjectionExpression: "userId, #n, email, #r, groupIds, clubCodes, isActive",
        ExpressionAttributeNames: { "#n": "name", "#r": "role" },
      })
    );
    const user = result.Items?.[0] as any;
    if (!user || user.isActive === false) return null;

    return {
      userId: String(user.userId ?? ""),
      name: user.name,
      email: user.email,
      role: user.role as string,
      groupIds: normalizeStringArray(user.groupIds),
      clubCodes: normalizeStringArray(user.clubCodes),
    };
  } catch (e) {
    console.error("[stores API] Failed to get current user:", e);
    return null;
  }
}

async function fetchStoresFromDB() {
  const query = `
    SELECT
      club_code__c AS "clubCode",
      name AS "clubName",
      COALESCE(brand__c, '') AS "brand",
      COALESCE(field1__c, '') AS "businessType",
      COALESCE(addressit__c, '') AS "address",
      latitude__c AS "latitude",
      longitude__c AS "longitude",
      COALESCE(club_mail_address__c, '') AS "email",
      COALESCE(is_private__c, false) AS "isPrivate",
      capacity__c AS "capacity"
    FROM club__c
    WHERE COALESCE(isdeleted, false) = false
      AND club_code__c IS NOT NULL
      AND club_code__c != ''
      AND brand__c IS NOT NULL
      AND brand__c != ''
    ORDER BY club_code__c::int
  `;

  const result = await pool.query(query);

  return result.rows.map((row: any) => ({
    clubCode: row.clubCode,
    clubName: row.clubName,
    brand: row.brand,
    businessType: row.businessType,
    prefecture: extractPrefecture(row.address),
    address: row.address,
    isActive: !row.isPrivate,
    capacity: row.capacity || 0,
  }));
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const allStores = await fetchStoresFromDB();

    // 表示範囲: admin かつ clubCodes 未指定 = 全件 / それ以外は user.clubCodes で whitelist
    const isAdmin = user.role === "admin";
    const userClubCodes = new Set(user.clubCodes ?? []);
    const stores =
      isAdmin && userClubCodes.size === 0
        ? allStores
        : allStores.filter((s: any) => userClubCodes.has(String(s.clubCode)));

    return NextResponse.json({
      ok: true,
      stores,
      total: stores.length,
      user: {
        role: user.role,
        groupIds: user.groupIds,
        clubCodes: user.clubCodes,
      },
    });
  } catch (e) {
    console.error("[stores API] DB error:", e);
    return NextResponse.json({ ok: false, error: "Database connection failed" }, { status: 500 });
  }
}
