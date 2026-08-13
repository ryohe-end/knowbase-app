// app/api/public/clubs/route.ts
// 公開API: クラブ一覧 (Knowbase DB = DynamoDB knowbie-clubs)。x-api-key 認証。
// 返却: クラブ(コード) / クラブ名称 / ブランド(FIT365|JOYFIT) / 業態(businessType)。
//   ※ 住所・都道府県は現状データ未整備のため返しません(揃い次第 別途追加)。
//   GET /api/public/clubs                     … 全店
//   GET /api/public/clubs?clubCode=375        … 1店
//   GET /api/public/clubs?brand=FIT365|JOYFIT … ブランド絞り込み
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { requirePublicApiKey } from "@/lib/publicApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.CLUBS_REGION || "us-east-1";
const TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const PROJ = "clubCode, clubName, clubNameShort, businessType";

// 業態(赤/青/緑/FIT365/ｼﾞｮｲﾌｨｯﾄﾌﾟﾗｽ 等)から消費者ブランドを正規化。
// FIT365 のみ FIT365、それ以外(JOYFIT系の色コード等)は JOYFIT。
function brandOf(businessType?: string | null): "FIT365" | "JOYFIT" {
  return String(businessType || "").toUpperCase().startsWith("FIT365") ? "FIT365" : "JOYFIT";
}

function shape(it: any) {
  const businessType = it.businessType ?? null; // 業態(生値)
  return {
    clubCode: String(it.clubCode),
    clubName: it.clubName ?? it.clubNameShort ?? null, // クラブ名称
    brand: brandOf(businessType), // ブランド
    businessType, // 業態
  };
}

export async function GET(req: Request) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;
  const sp = new URL(req.url).searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  const brand = (sp.get("brand") || "").trim().toUpperCase();
  try {
    const items: any[] = [];
    let ek: any;
    do {
      const r: any = await ddb.send(new ScanCommand({ TableName: TABLE, ProjectionExpression: PROJ, ExclusiveStartKey: ek }));
      for (const it of r.Items ?? []) if (it.clubCode) items.push(shape(it));
      ek = r.LastEvaluatedKey;
    } while (ek);

    if (clubCode) {
      const one = items.find((x) => x.clubCode === clubCode);
      if (!one) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, club: one });
    }

    let clubs = items;
    if (brand === "FIT365" || brand === "JOYFIT") clubs = clubs.filter((c) => c.brand === brand);
    clubs.sort((a, b) => (Number(a.clubCode) - Number(b.clubCode)) || a.clubCode.localeCompare(b.clubCode));
    return NextResponse.json({ ok: true, count: clubs.length, clubs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
