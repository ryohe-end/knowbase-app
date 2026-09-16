// app/api/store-settings/campaigns/route.ts
// 店舗設定: キャンペーン(CP)＋入会完了メールの管理API。ユーザーの担当クラブ(clubCodes)スコープ。
//   GET ?clubCode=       … 当該店舗のCP一覧
//   POST { campaignId?, clubCode, name, subject, bodyHtml, enabled, fromName } … 登録/更新
//   POST { action:"test", campaignId, email, variables } … テスト送信
//   DELETE ?campaignId=  … 削除
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";
import { effectiveClubCodes } from "@/lib/clubScope";
import {
  listCampaignsByClub, saveCampaign, deleteCampaign, getCampaign, sendEnrollmentMail,
} from "@/lib/storeCampaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_USERS = "yamauchi-Users";
const region = process.env.AWS_REGION || "us-east-1";
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

function normArr(raw: any): string[] {
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((x: any) => (typeof x === "object" && x && "S" in x ? String(x.S) : String(x))).map((s) => s.trim()).filter(Boolean);
}

async function getCurrentUser() {
  try {
    const cookieStore = await cookies();
    const email = (await verifySignedValue(cookieStore.get("kb_user")?.value ?? "")) ?? "";
    if (!email) return null;
    const r = await docClient.send(new QueryCommand({
      TableName: TABLE_USERS, IndexName: "email-index",
      KeyConditionExpression: "email = :e", ExpressionAttributeValues: { ":e": email }, Limit: 1,
      ProjectionExpression: "userId, #n, email, #r, clubCodes, areas, isActive",
      ExpressionAttributeNames: { "#n": "name", "#r": "role" },
    }));
    const u = r.Items?.[0] as any;
    if (!u || u.isActive === false) return null;
    return {
      email: String(u.email ?? ""), role: String(u.role ?? ""),
      clubCodes: await effectiveClubCodes(normArr(u.clubCodes), normArr(u.areas), { role: String(u.role ?? "") }),
    };
  } catch { return null; }
}

function inScope(user: { role: string; clubCodes: string[] }, clubCode: string): boolean {
  if (user.role === "admin" && user.clubCodes.length === 0) return true; // admin全店
  return user.clubCodes.includes(String(clubCode));
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const clubCode = new URL(req.url).searchParams.get("clubCode");
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  if (!inScope(user, clubCode)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const campaigns = await listCampaignsByClub(clubCode);
    return NextResponse.json({ ok: true, campaigns });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "DB error", message: e?.message || null }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  // テスト送信
  if (body.action === "test") {
    const campaign = body.campaignId ? await getCampaign(String(body.campaignId)) : null;
    // 未保存の内容でもテストできるよう、body の subject/bodyHtml を優先
    const c = campaign
      ? { ...campaign, subject: body.subject ?? campaign.subject, bodyHtml: body.bodyHtml ?? campaign.bodyHtml, fromName: body.fromName ?? campaign.fromName }
      : { campaignId: "preview", clubCode: String(body.clubCode || ""), name: "", enabled: true, subject: String(body.subject || ""), bodyHtml: String(body.bodyHtml || ""), fromName: body.fromName, createdAt: "", updatedAt: "" };
    if (c.clubCode && !inScope(user, c.clubCode)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const email = String(body.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: "テスト送信先メールが不正です" }, { status: 400 });
    const result = await sendEnrollmentMail({ campaign: c as any, email, variables: body.variables || { name: "テスト太郎", clubName: "テスト店舗" } });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  }

  const clubCode = String(body.clubCode ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, error: "CP名は必須です" }, { status: 400 });
  if (!inScope(user, clubCode)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  // 更新時は対象CPが自店舗のものか確認
  if (body.campaignId) {
    const cur = await getCampaign(String(body.campaignId));
    if (cur && !inScope(user, cur.clubCode)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  try {
    const c = await saveCampaign({
      campaignId: body.campaignId, clubCode, name,
      subject: String(body.subject ?? ""), bodyHtml: String(body.bodyHtml ?? ""),
      enabled: body.enabled !== false, fromName: body.fromName,
    }, user.email);
    return NextResponse.json({ ok: true, campaign: c });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "DB error", message: e?.message || null }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const campaignId = new URL(req.url).searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ ok: false, error: "campaignId required" }, { status: 400 });
  const cur = await getCampaign(campaignId);
  if (cur && !inScope(user, cur.clubCode)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    await deleteCampaign(campaignId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "DB error", message: e?.message || null }, { status: 500 });
  }
}
