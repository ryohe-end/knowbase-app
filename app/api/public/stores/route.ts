// app/api/public/stores/route.ts
// 公開API: Knowbase の店舗情報 (knowbie-clubs)。x-api-key 認証。
//   GET /api/public/stores            … 全店
//   GET /api/public/stores?clubCode=  … 1店
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { requirePublicApiKey } from "@/lib/publicApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.CLUBS_REGION || "us-east-1";
const TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const PROJ = "clubCode, clubName, clubNameShort, companyGroup, companyName, businessType, openDate";

function shape(it: any) {
  return {
    clubCode: String(it.clubCode),
    clubName: it.clubName ?? null,
    clubNameShort: it.clubNameShort ?? null,
    companyGroup: it.companyGroup ?? null,
    companyName: it.companyName ?? null,
    businessType: it.businessType ?? null,
    openDate: it.openDate ?? null,
  };
}

export async function GET(req: Request) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;
  const clubCode = (new URL(req.url).searchParams.get("clubCode") || "").trim();
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
      return NextResponse.json({ ok: true, store: one });
    }
    items.sort((a, b) => (Number(a.clubCode) - Number(b.clubCode)) || a.clubCode.localeCompare(b.clubCode));
    return NextResponse.json({ ok: true, count: items.length, stores: items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
