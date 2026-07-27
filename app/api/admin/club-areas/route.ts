// app/api/admin/club-areas/route.ts
// 課別エリア/テリトリー(例: 関東 第1エリア)マスタ。knowbase 管理画面(admin専用)で編集。
//   GET    → エリア行一覧
//   POST   → 登録/更新 (areaId 指定で更新、無ければ新規採番)
//   DELETE ?areaId= → 削除
// 保存先: DynamoDB knowbie-club-areas (PK: areaId)。読み取りは lib/clubAreas 経由(キャッシュ+フォールバック)。
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";
import { isAdminRequest, verifySignedValue, parseCookieHeader } from "@/lib/auth";
import { writeAudit, clientIp } from "@/lib/auditLog";
import { listClubAreas, invalidateClubAreasCache, CLUB_AREAS_TABLE, type ClubAreaRow, type TerritoryRow } from "@/lib/clubAreas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.CLUB_AREAS_TABLE_REGION || process.env.AWS_REGION || "us-east-1";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

function strArr(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
}
function normTerritories(v: any): TerritoryRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => ({ territory: String(t?.territory ?? "").trim(), clubCodes: strArr(t?.clubCodes) }))
    .filter((t) => t.territory || t.clubCodes.length > 0);
}
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
    const areas = await listClubAreas({ fresh: true });
    return NextResponse.json({ ok: true, areas });
  } catch (e: any) {
    console.error("[club-areas] GET error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "DB error", areas: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  let body: Partial<ClubAreaRow>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const area = String(body.area ?? "").trim();
  if (!area) return NextResponse.json({ ok: false, error: "エリア名は必須です" }, { status: 400 });

  const territories = normTerritories(body.territories);
  // エリア直下の所属店舗 = 明示指定 ∪ 全テリトリーの店舗 (逆引きが全店を拾えるように)
  const clubCodes = [...new Set([...strArr(body.clubCodes), ...territories.flatMap((t) => t.clubCodes)])];

  const email = await actorEmail(req);
  const now = new Date().toISOString();
  const isNew = !body.areaId;
  let existing: ClubAreaRow | undefined;
  if (!isNew) {
    const g = await ddb.send(new GetCommand({ TableName: CLUB_AREAS_TABLE, Key: { areaId: String(body.areaId) } }));
    existing = g.Item as ClubAreaRow | undefined;
  }
  const areaId = isNew ? `area-${createHash("md5").update(area).digest("hex").slice(0, 8)}` : String(body.areaId);

  const row: ClubAreaRow = {
    areaId,
    area,
    block: String(body.block ?? "").trim(),
    clubCodes,
    territories,
    updatedAt: now,
    updatedBy: email,
  };
  try {
    await ddb.send(new PutCommand({ TableName: CLUB_AREAS_TABLE, Item: row }));
    invalidateClubAreasCache();
    void writeAudit({
      userId: email, action: isNew ? "clubArea.create" : "clubArea.update",
      resource: `clubArea:${areaId}`, targetCount: clubCodes.length,
      detail: { area, block: row.block, clubs: clubCodes.length, territories: territories.length }, ip: clientIp(req), result: "ok",
    });
    return NextResponse.json({ ok: true, area: row });
  } catch (e: any) {
    console.error("[club-areas] POST error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const areaId = new URL(req.url).searchParams.get("areaId");
  if (!areaId) return NextResponse.json({ ok: false, error: "areaId required" }, { status: 400 });
  try {
    await ddb.send(new DeleteCommand({ TableName: CLUB_AREAS_TABLE, Key: { areaId } }));
    invalidateClubAreasCache();
    void writeAudit({
      userId: await actorEmail(req), action: "clubArea.delete",
      resource: `clubArea:${areaId}`, ip: clientIp(req), result: "ok",
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[club-areas] DELETE error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }
}
