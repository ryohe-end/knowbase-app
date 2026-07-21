// app/api/store-settings/basic/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { verifySignedValue } from "@/lib/auth";
import { query } from "@/lib/memberDb";
import type { StoreAppConfig } from "@/types/storeAppConfig";
import { effectiveClubCodes } from "@/lib/clubScope";
import { resolveEntryShopId } from "@/lib/entryShopMap";
import {
  getServiceControls,
  saveServiceControls,
  applicableToggles,
  type ServiceBrand,
  type ServiceToggleKey,
} from "@/lib/shopServiceControl";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        ProjectionExpression: "userId, #n, email, #r, groupIds, clubCodes, areas, isActive",
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
      clubCodes: await effectiveClubCodes(normalizeStringArray(user.clubCodes), normalizeStringArray(user.areas)),
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

// club__c.brand__c → サービス連携ブランド (JOYFIT系はすべて JOYFIT)
function brandOf(rawBrand: string): ServiceBrand {
  return String(rawBrand || "").toUpperCase().startsWith("JOYFIT") ? "JOYFIT" : "FIT365";
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
  // 担当クラブ(clubCodes)スコープ (空=admin全店舗)
  if (user.clubCodes.length > 0 && !user.clubCodes.includes(clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club not in your scope" }, { status: 403 });
  }

  try {
    // 店舗情報取得
    const clubResult = await query(
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
      WHERE club_code__c = $1 AND COALESCE(isdeleted, false) = false
      LIMIT 1`,
      [clubCode]
    );

    if (clubResult.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Store not found" }, { status: 404 });
    }

    const club = clubResult.rows[0];

    // 解錠機器取得
    const devicesResult = await query(
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

    // 表示サービス(shop_service_control) を入会DBから読む。対応 shop_id は自動解決。
    const svcBrand = brandOf(club.brand);
    let serviceControls: Partial<Record<ServiceToggleKey, boolean>> = {};
    let serviceShopId: string | null = null;
    let serviceReadOk = false;
    try {
      serviceShopId = await resolveEntryShopId(svcBrand, club.club_code__c, club.name);
      if (serviceShopId) { serviceControls = await getServiceControls(svcBrand, serviceShopId); serviceReadOk = true; }
    } catch (e: any) {
      console.error("[basic API] service control read failed:", e?.message || e);
    }
    // 読み取り成功時のみ編集可 (読めない時に false で上書きする事故を防ぐ)
    const serviceControlAvailable = !!serviceShopId && serviceReadOk;

    // 店舗のマシン: 名前は club__c.machine_names__c、詳細(画像/部位/メーカー)は
    // machine__c マスタ(Salesforce連携)から名前で引く。
    const machineNameList = (club.machine_names || "")
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean);
    let machines: { name: string; imageUrl: string; maker?: string; bodyRegion?: string }[] =
      machineNameList.map((name: string) => ({ name, imageUrl: "" }));
    if (machineNameList.length > 0) {
      const detail = await query(
        `SELECT machine_name__c AS name,
                COALESCE(img_url1__c, '') AS image_url,
                COALESCE(body_region__c, 'その他') AS body_region,
                CASE WHEN machine_name__c ~ '\\(.*\\)$'
                     THEN regexp_replace(machine_name__c, '.*\\(([^)]+)\\)$', '\\1')
                     ELSE 'その他' END AS maker
           FROM machine__c
          WHERE isdeleted = false AND machine_name__c = ANY($1)`,
        [machineNameList]
      );
      const byName = new Map(detail.rows.map((r: any) => [r.name, r]));
      machines = machineNameList.map((name: string) => {
        const d: any = byName.get(name);
        return { name, imageUrl: d?.image_url ?? "", maker: d?.maker, bodyRegion: d?.body_region };
      });
    }

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
      // 表示サービスは入会DB shop_service_control が本番SoT。行が無い/未解決は false。
      showAppEnableButton: serviceControls.showAppEnableButton ?? false,
      enableReferral: serviceControls.enableReferral ?? false,
      showMainContractChange: serviceControls.showMainContractChange ?? false,
      showKioskContractChange: serviceControls.showKioskContractChange ?? false,
      showOptionChange: serviceControls.showOptionChange ?? false,
      showFamilyAdd: serviceControls.showFamilyAdd ?? false,
      showUnpaidPayment: !club.hide_unpaid, // 未納金表示は club__c(hide_unpaid) が SoT
      showWithdrawal: serviceControls.showWithdrawal ?? false,

      serviceControlAvailable,
      serviceShopId: serviceShopId || undefined,
      serviceToggleKeys: applicableToggles(svcBrand),

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
  // 管理者は全店、店舗ユーザー/店舗紐づき管理者は自店舗(clubCodes内)を編集可(マシン登録/変更等)。
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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

  // 担当クラブ(clubCodes)スコープで所属チェック。
  // admin は全店舗編集可(clubCodes空=全店)。非adminは自店舗(clubCodesに含まれるクラブ)のみ編集可。
  // 非adminでclubCodesが空のユーザーは編集不可(空を全店許可と誤解しない=権限昇格の穴を塞ぐ)。
  const isAdmin = user.role === "admin";
  const inScope = user.clubCodes.length > 0 && user.clubCodes.includes(clubCode);
  if (!isAdmin && !inScope) {
    return NextResponse.json({ ok: false, error: "Forbidden: club not in your scope" }, { status: 403 });
  }
  try {
    // 店舗の存在確認 + sfid / brand 取得 (brandはサーバ側で確定させ、クライアント値は信用しない)
    const existing = await query(
      `SELECT sfid, name, COALESCE(brand__c, '') AS brand FROM club__c WHERE club_code__c = $1 AND COALESCE(isdeleted, false) = false LIMIT 1`,
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

    // name / field1__c (業態) / brand__c は clubs-sync (MotionBoard) が SoT のため
    // ここでは更新しない。UI 側でも readonly 表示。
    await query(
      `UPDATE club__c
       SET
         addressit__c = $2,
         latitude__c = $3,
         longitude__c = $4,
         link_url__c = $5,
         club_mail_address__c = $6,
         notification_targets__c = $7,
         personal_training_url = $8,
         point_program_support_flag__c = $9,
         point_program_support_start_date = $10,
         app_point_popup_flag__c = $11,
         recess_member_available_flag__c = $12,
         les_mills_member_available_flag__c = $13,
         hide_unpaid_warning_flag__c = $14,
         machine_names__c = $15,
         lastupdateddate = NOW()
       WHERE club_code__c = $1 AND COALESCE(isdeleted, false) = false`,
      [
        clubCode,
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

    // 表示サービスは入会DB shop_service_control(本番SoT)へ保存。
    // 事故防止のため body.serviceToggles(GETで読めた時のみUIが送る)が有る時だけ処理し、
    // 現在値との差分のみ書き込む(未読・全false での一括上書きを防ぐ)。JOYFITはkiosk/family除外。
    const svcToggles = (body as any).serviceToggles;
    if (svcToggles && typeof svcToggles === "object") {
      try {
        const svcBrand = brandOf(existing.rows[0].brand || "");
        const shopId = await resolveEntryShopId(svcBrand, clubCode, existing.rows[0].name);
        if (shopId) {
          const current = await getServiceControls(svcBrand, shopId); // 差分基準(失敗時はcatch)
          const changes: Partial<Record<ServiceToggleKey, boolean>> = {};
          const missing: string[] = [];
          for (const k of applicableToggles(svcBrand)) {
            if (!(k in svcToggles)) continue;
            const want = Boolean(svcToggles[k]);
            const cur = current[k];
            if (cur === undefined) { if (want) missing.push(k); continue; } // 行が無い=INSERT不可(プロビジョン対象外)
            if (cur !== want) changes[k] = want; // 既存行のみ UPDATE
          }
          if (missing.length) console.warn(`[basic API] service行が無く有効化できません (INSERT権限なし) shop=${shopId}:`, missing.join(","));
          const changed = Object.keys(changes).length ? await saveServiceControls(svcBrand, shopId, changes) : 0;
          if (changed > 0) {
            void writeAudit({
              userId: user.email || user.userId, userName: user.name,
              action: "basic.serviceControl.save", resource: `shop:${shopId}`, clubCodes: [clubCode],
              targetCount: changed, detail: { brand: svcBrand, shopId, changes }, ip: clientIp(req),
            });
          }
        } else {
          console.warn(`[basic API] service control: shop_id 未解決 (club=${clubCode})`);
        }
      } catch (e: any) {
        console.error("[basic API] service control save failed:", e?.message || e);
        return NextResponse.json({ ok: false, error: `表示サービス設定の保存に失敗しました: ${e?.message || e}` }, { status: 502 });
      }
    }

    // 解錠機器 (unlocking_machine_code__c) を同期。SF連携は停止済み(残骸)で
    // id/name/sfid は自動採番されるため直接 INSERT/UPDATE/削除できる。
    // フォーム配列と DB を突合し、新規=INSERT / 既存(sfid一致)=UPDATE / 消えたもの=論理削除。
    if (Array.isArray(body.unlockDevices)) {
      const clubSfid = existing.rows[0].sfid;
      const devices = body.unlockDevices.map((d: any) => ({
        id: String(d?.id ?? ""),
        major: String(d?.majorCode ?? "").trim(),
        minor: String(d?.minorCode ?? "").trim(),
        type: String(d?.type ?? "").trim(),
        displayName: String(d?.displayName ?? "").trim(),
        isEntrance: Boolean(d?.isEntrance),
      }));
      // バリデーション: major/minor/表示名 必須、major は数値、セット内 major+minor 重複禁止
      const seen = new Set<string>();
      for (const d of devices) {
        if (!d.major || !d.minor || !d.displayName) {
          return NextResponse.json({ ok: false, error: "解錠機器: Major/Minor/表示名は必須です" }, { status: 400 });
        }
        if (!/^\d+$/.test(d.major) || !/^\d+$/.test(d.minor)) {
          return NextResponse.json({ ok: false, error: "解錠機器: Major/Minor は数値で入力してください" }, { status: 400 });
        }
        const key = `${d.major}-${d.minor}`;
        if (seen.has(key)) {
          return NextResponse.json({ ok: false, error: `解錠機器: Major/Minor が重複しています (${key})` }, { status: 400 });
        }
        seen.add(key);
      }
      // 他店舗との major+minor 重複チェック (解錠は major+minor でクラブを特定するため全社で一意)
      if (devices.length > 0) {
        const dup = await query(
          `SELECT major__c, minor__c FROM unlocking_machine_code__c
            WHERE COALESCE(isdeleted,false)=false AND club_sfid__c <> $1
              AND (major__c || '-' || minor__c) = ANY($2)`,
          [clubSfid, devices.map((d: { major: string; minor: string }) => `${d.major}-${d.minor}`)]
        );
        if (dup.rows.length > 0) {
          const c = dup.rows[0];
          return NextResponse.json({ ok: false, error: `解錠機器: Major/Minor ${c.major__c}-${c.minor__c} は他店舗で使用済みです` }, { status: 409 });
        }
      }

      const cur = await query(
        `SELECT sfid, major__c, minor__c FROM unlocking_machine_code__c WHERE club_sfid__c = $1 AND COALESCE(isdeleted,false)=false`,
        [clubSfid]
      );
      const curSfids = new Set(cur.rows.map((r: any) => String(r.sfid)));
      const keepSfids = new Set<string>();
      for (const d of devices) {
        if (d.id && curSfids.has(d.id)) {
          keepSfids.add(d.id);
          await query(
            `UPDATE unlocking_machine_code__c
                SET major__c=$2, minor__c=$3, door_type__c=$4, display_name__c=$5, is_for_entrance__c=$6, lastupdateddate=NOW()
              WHERE sfid=$1`,
            [d.id, d.major, d.minor, d.type || null, d.displayName, d.isEntrance]
          );
        } else {
          await query(
            `INSERT INTO unlocking_machine_code__c
               (club_sfid__c, major__c, minor__c, door_type__c, display_name__c, is_for_entrance__c, isdeleted)
             VALUES ($1,$2,$3,$4,$5,$6,false)`,
            [clubSfid, d.major, d.minor, d.type || null, d.displayName, d.isEntrance]
          );
        }
      }
      // フォームから消えた既存機器は論理削除
      for (const r of cur.rows) {
        if (!keepSfids.has(String(r.sfid))) {
          await query(`UPDATE unlocking_machine_code__c SET isdeleted=true, lastupdateddate=NOW() WHERE sfid=$1`, [r.sfid]);
        }
      }
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
