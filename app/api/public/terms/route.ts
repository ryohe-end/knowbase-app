// app/api/public/terms/route.ts
// 公開API: Knowbase の規約情報 (yamauchi-StoreTerms)。x-api-key 認証。
//   GET /api/public/terms               … 全規約(現行版のみ)
//   GET /api/public/terms?brand=        … ブランド絞り込み(FIT365|JOYFIT)
//   GET /api/public/terms?category=Web入会 … 掲出カテゴリで絞り込み(categories[] に含む)
//   GET /api/public/terms?termId=...    … 該当1件のみ(現行版の本文つき)。無ければ404
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { requirePublicApiKey } from "@/lib/publicApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.STORE_TERMS_REGION || process.env.CLUBS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_STORE_TERMS_TABLE || "yamauchi-StoreTerms";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function shape(t: any) {
  const versions = Array.isArray(t.versions) ? t.versions : [];
  const current = versions.find((v: any) => v.isCurrent) || versions[versions.length - 1] || null;
  return {
    termId: t.termId,
    brand: t.brand ?? null,
    baseTitle: t.baseTitle ?? null,
    variants: Array.isArray(t.variants) ? t.variants : [],
    categories: Array.isArray(t.categories) ? t.categories : [],
    updatedAt: t.updatedAt ?? null,
    current: current
      ? {
          id: current.id,
          label: current.label ?? null,
          note: current.note ?? null,
          createdAt: current.createdAt ?? null,
          contentByVariant: current.contentByVariant ?? {},
        }
      : null,
  };
}

export async function GET(req: Request) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;
  const sp = new URL(req.url).searchParams;
  const brand = (sp.get("brand") || "").trim();
  const category = (sp.get("category") || "").trim();
  const termId = (sp.get("termId") || "").trim();
  try {
    const items: any[] = [];
    let ek: any;
    do {
      const r: any = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: ek }));
      for (const it of r.Items ?? []) if (it.termId) items.push(shape(it));
      ek = r.LastEvaluatedKey;
    } while (ek);

    // termId 指定時は該当1件のみ返す
    if (termId) {
      const one = items.find((x) => String(x.termId) === termId);
      if (!one) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, term: one });
    }

    let filtered = brand ? items.filter((x) => String(x.brand) === brand) : items;
    // category は categories[](掲出カテゴリ: Web入会 / 1DayPass / KIOSK(...) 等)に含むもの
    if (category) filtered = filtered.filter((x) => Array.isArray(x.categories) && x.categories.map(String).includes(category));
    filtered.sort((a, b) => String(a.brand).localeCompare(String(b.brand)) || String(a.baseTitle).localeCompare(String(b.baseTitle)));
    return NextResponse.json({
      ok: true,
      count: filtered.length,
      ...(brand ? { brand } : {}),
      ...(category ? { category } : {}),
      terms: filtered,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
