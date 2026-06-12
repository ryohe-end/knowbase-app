// app/api/store-settings/terms/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";
import type { StoreTerm } from "@/types/storeTerms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_TERMS = process.env.DYNAMO_STORE_TERMS_TABLE || "yamauchi-StoreTerms";
const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const region = process.env.AWS_REGION || "us-east-1";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function getCurrentUser() {
  try {
    const cookieStore = await cookies();
    const rawUser = cookieStore.get("kb_user")?.value ?? "";
    const email = (await verifySignedValue(rawUser)) ?? "";
    if (!email) return null;

    const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_USERS,
        IndexName: EMAIL_GSI_NAME,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
        ProjectionExpression: "userId, email, #r, isActive",
        ExpressionAttributeNames: { "#r": "role" },
      })
    );
    const user = result.Items?.[0] as any;
    if (!user || user.isActive === false) return null;
    return { email: user.email as string, role: user.role as string };
  } catch (e) {
    console.error("[terms API] auth error:", e);
    return null;
  }
}

function validateTerm(body: any): { ok: true; term: StoreTerm } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  if (typeof body.termId !== "string" || !body.termId) return { ok: false, error: "termId required" };
  if (typeof body.brand !== "string" || !body.brand) return { ok: false, error: "brand required" };
  if (typeof body.baseTitle !== "string" || !body.baseTitle) return { ok: false, error: "baseTitle required" };
  if (!Array.isArray(body.versions)) return { ok: false, error: "versions must be array" };
  return {
    ok: true,
    term: {
      termId: body.termId,
      brand: body.brand,
      baseTitle: body.baseTitle,
      variants: Array.isArray(body.variants) ? body.variants.map(String) : [],
      categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
      versions: body.versions,
      createdAt: typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

// GET /api/store-settings/terms              → 全件一覧
// GET /api/store-settings/terms?termId=xxx    → 1件取得
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const termId = searchParams.get("termId");

  try {
    if (termId) {
      const res = await docClient.send(
        new GetCommand({ TableName: TABLE_TERMS, Key: { termId } })
      );
      return NextResponse.json({ ok: true, term: res.Item ?? null });
    }

    const res = await docClient.send(new ScanCommand({ TableName: TABLE_TERMS }));
    return NextResponse.json({ ok: true, terms: res.Items ?? [] });
  } catch (e: any) {
    console.error("[terms API] GET error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

// POST /api/store-settings/terms  →  upsert
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const v = validateTerm(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

  try {
    await docClient.send(
      new PutCommand({ TableName: TABLE_TERMS, Item: v.term })
    );
    return NextResponse.json({ ok: true, term: v.term });
  } catch (e: any) {
    console.error("[terms API] POST error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

// DELETE /api/store-settings/terms?termId=xxx
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const termId = searchParams.get("termId");
  if (!termId) {
    return NextResponse.json({ ok: false, error: "termId required" }, { status: 400 });
  }

  try {
    await docClient.send(new DeleteCommand({ TableName: TABLE_TERMS, Key: { termId } }));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[terms API] DELETE error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
