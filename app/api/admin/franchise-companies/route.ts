// app/api/admin/franchise-companies/route.ts
// 加盟店企業(FC店の運営企業)マスタ。knowbase 管理画面(admin専用)で登録・管理する。
//   GET    → 一覧
//   POST   → 登録/更新 (companyId 指定で更新、無ければ新規採番)
//   DELETE ?companyId= → 削除
// 保存先: DynamoDB knowbie-franchise-companies (PK: companyId)
// 認可: /admin と同じく admin(kb_admin cookie / KB_ADMIN_API_KEY) のみ。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { isAdminRequest, verifySignedValue, parseCookieHeader } from "@/lib/auth";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.FRANCHISE_COMPANIES_TABLE || "knowbie-franchise-companies";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface FranchiseCompany {
  companyId: string;
  name: string;            // 加盟店企業名
  clubCodes: string[];     // 所属FC店舗(clubCode)
  contactName?: string;    // 担当者
  contactEmail?: string;
  contactPhone?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

function strArr(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

// 監査ログ用に操作者メール(kb_user)を復号(無くても処理は継続)。
async function actorEmail(req: Request): Promise<string> {
  try {
    const map = parseCookieHeader(req.headers.get("cookie") || "");
    return (await verifySignedValue(map["kb_user"])) || "admin";
  } catch {
    return "admin";
  }
}

export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  try {
    const items: FranchiseCompany[] = [];
    let lastKey: any = undefined;
    do {
      const res: any = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
      if (Array.isArray(res.Items)) items.push(...(res.Items as FranchiseCompany[]));
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    items.sort((a, b) => (b.clubCodes?.length ?? 0) - (a.clubCodes?.length ?? 0) || String(a.name).localeCompare(String(b.name), "ja"));
    return NextResponse.json({ ok: true, companies: items });
  } catch (e: any) {
    console.error("[franchise-companies] GET error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "DB error", companies: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  let body: Partial<FranchiseCompany>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "企業名は必須です" }, { status: 400 });

  const email = await actorEmail(req);
  const now = new Date().toISOString();
  const isNew = !body.companyId;
  let existing: FranchiseCompany | undefined;
  if (!isNew) {
    const g = await ddb.send(new GetCommand({ TableName: TABLE, Key: { companyId: String(body.companyId) } }));
    existing = g.Item as FranchiseCompany | undefined;
  }
  const company: FranchiseCompany = {
    companyId: isNew ? `fc-${randomUUID().slice(0, 8)}` : String(body.companyId),
    name,
    clubCodes: strArr(body.clubCodes),
    contactName: body.contactName ? String(body.contactName).trim() : undefined,
    contactEmail: body.contactEmail ? String(body.contactEmail).trim() : undefined,
    contactPhone: body.contactPhone ? String(body.contactPhone).trim() : undefined,
    note: body.note ? String(body.note).trim() : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: existing?.createdBy ?? email,
  };
  try {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: company }));
    void writeAudit({
      userId: email, action: isNew ? "franchiseCompany.create" : "franchiseCompany.update",
      resource: `franchiseCompany:${company.companyId}`, targetCount: company.clubCodes.length,
      detail: { name: company.name, clubs: company.clubCodes.length }, ip: clientIp(req), result: "ok",
    });
    return NextResponse.json({ ok: true, company });
  } catch (e: any) {
    console.error("[franchise-companies] POST error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const companyId = new URL(req.url).searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ ok: false, error: "companyId required" }, { status: 400 });
  try {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { companyId } }));
    void writeAudit({
      userId: await actorEmail(req), action: "franchiseCompany.delete",
      resource: `franchiseCompany:${companyId}`, ip: clientIp(req), result: "ok",
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[franchise-companies] DELETE error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }
}
