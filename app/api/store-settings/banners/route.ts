// app/api/store-settings/banners/route.ts
// ホーム画面バナー設定（ブランド共通 = app_type 単位。店舗別ではない）の取得/保存。
// GET  ?appType=joyfit|fit365|wf   → { ok, settings: BannerSettings }
// POST body: BannerSettings         → 保存(admin のみ)。app_banner を app_type 単位で置換。
//
// データ層の雛形。UI(React)は別タスクで実装する。
// ※ バナーは店舗(clubCode)ではなくブランド(app_type)単位のため clubCode スコープは無く、admin のみ編集可。
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";
import { isAdminLike } from "@/lib/roles";
import { query } from "@/lib/memberDb";
import type { BannerSettings, AppBanner, AppType } from "@/types/bannerSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const region = process.env.AWS_REGION || "us-east-1";
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const APP_TYPES: AppType[] = ["joyfit", "fit365", "wf"];

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
        ProjectionExpression: "userId, #n, email, #r, isActive",
        ExpressionAttributeNames: { "#n": "name", "#r": "role" },
      })
    );
    const u = result.Items?.[0] as any;
    if (!u || u.isActive === false) return null;
    return { userId: String(u.userId ?? ""), name: u.name, email: u.email, role: u.role as string };
  } catch (e) {
    console.error("[banners API] getCurrentUser failed:", e);
    return null;
  }
}

function toNullableString(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function readSettings(appType: AppType): Promise<BannerSettings> {
  const res = await query(
    `SELECT id, COALESCE(image_url, '') AS image_url,
            COALESCE(link_url, '') AS link_url,
            COALESCE(title, '')    AS title,
            COALESCE(display_order, 0) AS display_order,
            COALESCE(is_active, true)  AS is_active,
            start_at, end_at
       FROM app_banner
      WHERE app_type = $1
      ORDER BY display_order ASC, id ASC`,
    [appType]
  );
  return {
    appType,
    banners: res.rows.map((r: any) => ({
      id: r.id,
      imageUrl: r.image_url,
      linkUrl: r.link_url || undefined,
      title: r.title || undefined,
      displayOrder: r.display_order ?? 0,
      isActive: r.is_active === true,
      startAt: r.start_at ? new Date(r.start_at).toISOString() : null,
      endAt: r.end_at ? new Date(r.end_at).toISOString() : null,
    })),
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const appType = new URL(req.url).searchParams.get("appType") as AppType | null;
  if (!appType || !APP_TYPES.includes(appType)) {
    return NextResponse.json({ ok: false, error: "appType is required (joyfit|fit365|wf)" }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, settings: await readSettings(appType) });
  } catch (e) {
    console.error("[banners API] GET failed:", e);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isAdminLike(user.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as BannerSettings | null;
  const appType = body?.appType as AppType;
  if (!body || !appType || !APP_TYPES.includes(appType)) {
    return NextResponse.json({ ok: false, error: "appType is required (joyfit|fit365|wf)" }, { status: 400 });
  }

  const banners: AppBanner[] = Array.isArray(body.banners) ? body.banners : [];
  for (const b of banners) {
    if (!b.imageUrl || !String(b.imageUrl).trim()) {
      return NextResponse.json({ ok: false, error: "バナー画像(imageUrl)は必須です" }, { status: 400 });
    }
  }

  try {
    // app_type 単位で丸ごと置換（単一ステートメント CTE で原子的に）
    if (banners.length === 0) {
      await query(`DELETE FROM app_banner WHERE app_type = $1`, [appType]);
    } else {
      const values: any[] = [appType];
      const rowsSql: string[] = [];
      banners.forEach((b, i) => {
        const base = 2 + i * 7; // $1 は app_type
        rowsSql.push(
          `($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        );
        values.push(
          toNullableString(b.title),
          String(b.imageUrl).trim(),
          toNullableString(b.linkUrl),
          Number.isInteger(b.displayOrder) ? b.displayOrder : i,
          b.isActive !== false, // 既定 true
          toNullableString(b.startAt),
          toNullableString(b.endAt)
        );
      });
      await query(
        `WITH del AS (DELETE FROM app_banner WHERE app_type = $1)
         INSERT INTO app_banner (app_type, title, image_url, link_url, display_order, is_active, start_at, end_at)
         VALUES ${rowsSql.join(", ")}`,
        values
      );
    }

    return NextResponse.json({ ok: true, settings: await readSettings(appType) });
  } catch (e) {
    console.error("[banners API] POST failed:", e);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
