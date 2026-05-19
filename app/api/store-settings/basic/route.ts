// app/api/store-settings/basic/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Pool } from "pg";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";
import type { StoreAppConfig } from "@/types/storeAppConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PG_CONNECTION = process.env.PG_DATABASE_URL
  || "postgres://wf_member_app_prod:UA5JAaqYeyVGUpD@188.93.146.126:5432/wf_member_app_prod";

const pool = new Pool({
  connectionString: PG_CONNECTION,
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

// --- DynamoDB (ユーザー認証) ---
const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index";
const region = process.env.AWS_REGION || "us-east-1";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

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
        ProjectionExpression: "userId, #n, email, #r, groupIds, isActive",
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
    };
  } catch (e) {
    console.error("[basic API] Failed to get current user:", e);
    return null;
  }
}

function extractPrefecture(address: string | null): string {
  if (!address) return "";
  const match = address.match(/^(.{2,3}[都道府県])/);
  return match ? match[1] : "";
}

function extractAddressWithoutPrefecture(address: string | null): string {
  if (!address) return "";
  return address.replace(/^.{2,3}[都道府県]/, "");
}

function toBool(v: any): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function toNullableNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNullableString(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}


export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clubCode = searchParams.get("clubCode");

  if (!clubCode) {
    return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  }

  try {
    // 店舗情報取得
    const clubResult = await pool.query(
      `SELECT
        club_code__c,
        name,
        COALESCE(brand__c, '') AS brand,
        COALESCE(field1__c, '') AS business_type,
        COALESCE(addressit__c, '') AS address,
        latitude__c,
        longitude__c,
        COALESCE(link_url__c, '') AS link_url,
        COALESCE(club_mail_address__c, '') AS club_email,
        COALESCE(notification_targets__c, '') AS notification_targets,
        COALESCE(personal_training_url, '') AS personal_training_url,
        COALESCE(is_private__c, false) AS is_private,
        COALESCE(point_program_support_flag__c, false) AS point_support,
        COALESCE(recess_member_available_flag__c, false) AS recess_member,
        COALESCE(app_point_popup_flag__c, false) AS app_point_popup,
        COALESCE(hide_unpaid_warning_flag__c, false) AS hide_unpaid,
        COALESCE(les_mills_member_available_flag__c, false) AS les_mills,
        point_program_support_start_date AS point_support_start_date,
        COALESCE(machine_names__c, '') AS machine_names,
        COALESCE(icon__c, '') AS icon,
        capacity__c,
        sfid,
        createddate,
        lastupdateddate
      FROM club__c
      WHERE club_code__c = $1 AND isdeleted = false
      LIMIT 1`,
      [clubCode]
    );

    if (clubResult.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Store not found" }, { status: 404 });
    }

    const club = clubResult.rows[0];

    // 解錠機器取得
    const devicesResult = await pool.query(
      `SELECT
        sfid,
        COALESCE(major__c, '') AS major,
        COALESCE(minor__c, '') AS minor,
        COALESCE(door_type__c, '') AS door_type,
        COALESCE(display_name__c, '') AS display_name,
        COALESCE(is_for_entrance__c, false) AS is_entrance
      FROM unlocking_machine_code__c
      WHERE club_sfid__c = $1 AND isdeleted = false
      ORDER BY minor__c`,
      [club.sfid]
    );

    // notification_targets はカンマ区切りのメール一覧
    const parsedEmails: string[] = (club.notification_targets || "")
      .split(",")
      .map((e: string) => e.trim())
      .filter(Boolean);
    const inquiryEmails = parsedEmails.length > 0 ? parsedEmails : [""];

    // machine_names はセミコロン区切り
    const machines = (club.machine_names || "")
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean)
      .map((name: string) => ({ name, imageUrl: "" }));

    const unlockDevices = devicesResult.rows.map((d: any) => ({
      id: d.sfid,
      majorCode: d.major,
      minorCode: d.minor,
      type: d.door_type || "入口",
      isEntrance: d.is_entrance,
      displayName: d.display_name || d.door_type || "",
    }));

    const config: StoreAppConfig = {
      clubCode: club.club_code__c,
      clubName: club.name,
      brand: club.brand === "JOYFIT24" || club.brand === "JOYFIT" || club.brand === "JOYFIT+" || club.brand === "JOYFIT YOGA"
        ? "JOYFIT" : club.brand === "FIT365" ? "FIT365" : "FIT365",
      businessType: club.business_type,

      storeEmail: club.club_email,
      inquiryEmails,

      latitude: club.latitude__c || undefined,
      longitude: club.longitude__c || undefined,
      prefecture: extractPrefecture(club.address),
      address: extractAddressWithoutPrefecture(club.address),

      externalLink: club.link_url,
      personalTrainingUrl: club.personal_training_url,

      isPointSupported: club.point_support,
      pointSupportStartDate: club.point_support_start_date || "",
      appPointPopup: club.app_point_popup,
      lesMillsAvailable: club.les_mills,
      canUseDormantMember: club.recess_member,
      showAppEnableButton: false,
      enableReferral: false,
      showMainContractChange: false,
      showKioskContractChange: false,
      showOptionChange: false,
      showFamilyAdd: false,
      showUnpaidPayment: !club.hide_unpaid,
      showWithdrawal: false,

      unlockDevices,
      machines,

      createdAt: club.createddate ? new Date(club.createddate).toISOString() : "",
      updatedAt: club.lastupdateddate ? new Date(club.lastupdateddate).toISOString() : "",
    };

    return NextResponse.json({ ok: true, config });
  } catch (e) {
    console.error("[basic API] DB error:", e);
    return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // --- 認可 ---
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // --- 入力解析 ---
  let body: Partial<StoreAppConfig> & { clubCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const clubCode = body.clubCode;
  if (!clubCode || typeof clubCode !== "string") {
    return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  }

  // groupIds が空でない場合 (=管理範囲が指定されている場合) は所属チェック。
  // 空配列は「全店舗管理可能」の暗黙ルールとして許容。
  // ※ yamauchi-Users に clubCode マッピングが未整備のため、現状 groupIds は空想定。
  if (user.groupIds.length > 0 && !user.groupIds.includes(clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club not in your scope" }, { status: 403 });
  }

  try {
    // 店舗の存在確認 + sfid 取得
    const existing = await pool.query(
      `SELECT sfid FROM club__c WHERE club_code__c = $1 AND isdeleted = false LIMIT 1`,
      [clubCode]
    );
    if (existing.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Store not found" }, { status: 404 });
    }

    // 住所は prefecture + address の連結で保存
    const prefecture = toNullableString(body.prefecture) ?? "";
    const addressLocal = toNullableString(body.address) ?? "";
    const fullAddress = (prefecture + addressLocal).trim() || null;

    // 問い合わせメールはカンマ区切りで保存 (空文字は除外)
    const inquiryEmails = Array.isArray(body.inquiryEmails)
      ? body.inquiryEmails.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const notificationTargets = inquiryEmails.length > 0 ? inquiryEmails.join(",") : null;

    // マシン名はセミコロン区切り
    const machineNames = Array.isArray(body.machines)
      ? body.machines.map((m) => (m && typeof m.name === "string" ? m.name.trim() : "")).filter(Boolean).join(";")
      : null;

    // ブランドは画面では "FIT365" / "JOYFIT" の2値だが、DB の brand__c は元値を保持。
    // フロントから受け取った値が "JOYFIT" の場合、既存値が "JOYFIT24" 等であれば上書きしないよう
    // 既存ブランドが JOYFIT 系列ならそのまま、FIT365 系列なら "FIT365" / "JOYFIT" を素直に書く。
    // ここでは安全策として brand__c は更新対象から除外する (ブランド変更は店舗マスタ管理側で行う想定)。

    await pool.query(
      `UPDATE club__c
       SET
         name = $2,
         field1__c = $3,
         addressit__c = $4,
         latitude__c = $5,
         longitude__c = $6,
         link_url__c = $7,
         club_mail_address__c = $8,
         notification_targets__c = $9,
         personal_training_url = $10,
         point_program_support_flag__c = $11,
         point_program_support_start_date = $12,
         app_point_popup_flag__c = $13,
         recess_member_available_flag__c = $14,
         les_mills_member_available_flag__c = $15,
         hide_unpaid_warning_flag__c = $16,
         machine_names__c = $17,
         lastupdateddate = NOW()
       WHERE club_code__c = $1 AND isdeleted = false`,
      [
        clubCode,
        toNullableString(body.clubName) ?? "",
        toNullableString(body.businessType),
        fullAddress,
        toNullableNumber(body.latitude),
        toNullableNumber(body.longitude),
        toNullableString(body.externalLink),
        toNullableString(body.storeEmail),
        notificationTargets,
        toNullableString(body.personalTrainingUrl),
        toBool(body.isPointSupported),
        toNullableString(body.pointSupportStartDate),
        toBool(body.appPointPopup),
        toBool(body.canUseDormantMember),
        toBool(body.lesMillsAvailable),
        !toBool(body.showUnpaidPayment), // showUnpaidPayment=true なら hide_unpaid=false
        machineNames,
      ]
    );

    // 解錠機器 (unlocking_machine_code__c) は Salesforce-Heroku 連携テーブルのため、
    // 直接 INSERT/DELETE すると SF 側との同期が崩れる恐れがある。別途同期処理が必要。
    // TODO: Salesforce API 経由での upsert もしくは Heroku Connect の writable 設定確認後に実装。
    if (Array.isArray(body.unlockDevices) && body.unlockDevices.length > 0) {
      console.warn("[basic API] unlockDevices write is not yet implemented (SF sync required)");
    }

    // 保存後の最新状態を返すために GET と同等のロジックで再取得
    const refreshUrl = new URL(req.url);
    refreshUrl.search = `?clubCode=${encodeURIComponent(clubCode)}`;
    const refreshed = await GET(new Request(refreshUrl.toString(), { headers: req.headers }));
    return refreshed;
  } catch (e) {
    console.error("[basic API] Update error:", e);
    return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
  }
}
