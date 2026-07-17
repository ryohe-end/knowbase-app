// app/api/store-settings/stamp-card/route.ts
// 来館スタンプカード設定（店舗=clubCode 単位）の取得/保存。
// GET  ?clubCode=xxxx           → { ok, settings: StampCardSettings }
// POST body: StampCardSettings   → 保存(admin のみ)。club__c 追加カラム + stamp_card_prize を更新。
//
// データ層の雛形。UI(React)は別タスクで /store-settings 配下に実装する。
// 認証/スコープ/レスポンス形は app/api/store-settings/basic/route.ts に合わせている。
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";
import { query } from "@/lib/memberDb";
import { effectiveClubCodes } from "@/lib/clubScope";
import type { StampCardSettings, StampCardPrize } from "@/types/stampCardSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- DynamoDB (ユーザー認証) --- basic/route.ts と同じ流儀
const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const region = process.env.AWS_REGION || "us-east-1";
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

function normalizeStringArray(raw: any): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((x: any) => (typeof x === "string" ? x : x && typeof x === "object" && "S" in x ? String(x.S) : String(x ?? "")))
    .map((s: string) => s.trim())
    .filter(Boolean);
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
        ProjectionExpression: "userId, #n, email, #r, groupIds, clubCodes, areas, isActive",
        ExpressionAttributeNames: { "#n": "name", "#r": "role" },
      })
    );
    const u = result.Items?.[0] as any;
    if (!u || u.isActive === false) return null;
    return {
      userId: String(u.userId ?? ""),
      name: u.name,
      email: u.email,
      role: u.role as string,
      groupIds: normalizeStringArray(u.groupIds),
      clubCodes: await effectiveClubCodes(normalizeStringArray(u.clubCodes), normalizeStringArray(u.areas)),
    };
  } catch (e) {
    console.error("[stamp-card API] getCurrentUser failed:", e);
    return null;
  }
}

function toNullableString(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** 共有DBから店舗のスタンプカード設定を読む。存在しない店舗は null。 */
async function readSettings(clubCode: string): Promise<StampCardSettings | null> {
  const clubRes = await query(
    `SELECT COALESCE(stamp_card_support_flag__c, false) AS support_flag,
            COALESCE(stamp_card_month_label__c, '')     AS month_label,
            COALESCE(stamp_card_promo_text__c, '')       AS promo_text,
            COALESCE(stamp_card_announcement__c, '')     AS announcement
       FROM club__c
      WHERE club_code__c = $1 AND COALESCE(isdeleted, false) = false
      LIMIT 1`,
    [clubCode]
  );
  if (clubRes.rows.length === 0) return null;
  const c = clubRes.rows[0];

  const prizeRes = await query(
    `SELECT id, required_count, name,
            COALESCE(image_url, '')   AS image_url,
            COALESCE(description, '') AS description,
            COALESCE(display_order, 0) AS display_order
       FROM stamp_card_prize
      WHERE club_code = $1
      ORDER BY required_count ASC, display_order ASC`,
    [clubCode]
  );

  return {
    clubCode,
    supportFlag: c.support_flag === true,
    monthLabel: c.month_label || undefined,
    promoText: c.promo_text || undefined,
    announcement: c.announcement || undefined,
    prizes: prizeRes.rows.map((r: any) => ({
      id: r.id,
      requiredCount: r.required_count,
      name: r.name,
      imageUrl: r.image_url,
      description: r.description || undefined,
      displayOrder: r.display_order ?? 0,
    })),
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const clubCode = new URL(req.url).searchParams.get("clubCode");
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  // 担当クラブスコープ(空=admin全店舗)
  if (user.clubCodes.length > 0 && !user.clubCodes.includes(clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club not in your scope" }, { status: 403 });
  }

  try {
    const settings = await readSettings(clubCode);
    if (!settings) return NextResponse.json({ ok: false, error: "Store not found" }, { status: 404 });
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    console.error("[stamp-card API] GET failed:", e);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as StampCardSettings | null;
  const clubCode = String(body?.clubCode ?? "").trim();
  if (!body || !clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  if (user.clubCodes.length > 0 && !user.clubCodes.includes(clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club not in your scope" }, { status: 403 });
  }

  // --- バリデーション ---
  const prizes: StampCardPrize[] = Array.isArray(body.prizes) ? body.prizes : [];
  for (const p of prizes) {
    if (!Number.isInteger(p.requiredCount) || p.requiredCount <= 0) {
      return NextResponse.json({ ok: false, error: "required_count は正の整数で入力してください" }, { status: 400 });
    }
    if (!p.name || !String(p.name).trim()) {
      return NextResponse.json({ ok: false, error: "景品名は必須です" }, { status: 400 });
    }
    if (!p.imageUrl || !String(p.imageUrl).trim()) {
      return NextResponse.json({ ok: false, error: "景品画像(imageUrl)は必須です" }, { status: 400 });
    }
  }

  try {
    // 1:1 設定 (club__c)
    await query(
      `UPDATE club__c SET
          stamp_card_support_flag__c = $2,
          stamp_card_month_label__c  = $3,
          stamp_card_promo_text__c   = $4,
          stamp_card_announcement__c = $5
        WHERE club_code__c = $1`,
      [
        clubCode,
        !!body.supportFlag,
        toNullableString(body.monthLabel),
        toNullableString(body.promoText),
        toNullableString(body.announcement),
      ]
    );

    // 景品(1:多) を丸ごと置換。単一ステートメントの CTE で DELETE→INSERT を原子的に行う。
    if (prizes.length === 0) {
      await query(`DELETE FROM stamp_card_prize WHERE club_code = $1`, [clubCode]);
    } else {
      const values: any[] = [clubCode];
      const rowsSql: string[] = [];
      prizes.forEach((p, i) => {
        const base = 2 + i * 5; // $1 は club_code
        rowsSql.push(`($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
        values.push(
          p.requiredCount,
          String(p.name).trim(),
          String(p.imageUrl).trim(),
          toNullableString(p.description),
          Number.isInteger(p.displayOrder) ? p.displayOrder : i
        );
      });
      await query(
        `WITH del AS (DELETE FROM stamp_card_prize WHERE club_code = $1)
         INSERT INTO stamp_card_prize (club_code, required_count, name, image_url, description, display_order)
         VALUES ${rowsSql.join(", ")}`,
        values
      );
    }

    const settings = await readSettings(clubCode);
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    console.error("[stamp-card API] POST failed:", e);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
