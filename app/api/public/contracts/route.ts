// app/api/public/contracts/route.ts
// 公開API: adb01 契約形態マスタ — クラブごとの「最新の契約できる契約」。x-api-key 認証。
// 契約形態マスタはクラブ非依存のため、直近 sinceMonths ヶ月に入会した会員(区分1/7/70)の
// 契約形態から「現在そのクラブで契約可能な契約形態」を導出する。
//   GET /api/public/contracts?clubCode=375[&sinceMonths=12]
import { NextResponse } from "next/server";
import { callMemberSearch } from "@/lib/unpaid";
import { requirePublicApiKey } from "@/lib/publicApiAuth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENROLL_TABLE = process.env.CLUB_CONTRACT_SETTINGS_TABLE || "knowbie-club-contract-settings";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" }));

// 入会管理(店舗詳細管理)で設定した Knowbase 権威の上書き(入会可否ON/OFF + 違約金)を契約形態コード別に取得。
async function loadEnrollmentOverrides(clubCode: string): Promise<Map<string, any>> {
  const m = new Map<string, any>();
  try {
    let ek: any;
    do {
      const r: any = await ddb.send(new QueryCommand({
        TableName: ENROLL_TABLE,
        KeyConditionExpression: "clubCode = :c",
        ExpressionAttributeValues: { ":c": String(clubCode) },
        ExclusiveStartKey: ek,
      }));
      for (const it of r.Items ?? []) m.set(String(it.contractFormCode), it);
      ek = r.LastEvaluatedKey;
    } while (ek);
  } catch { /* 上書きが無くても近似は返す */ }
  return m;
}

export async function GET(req: Request) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;
  const sp = new URL(req.url).searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  const sinceMonths = (sp.get("sinceMonths") || "12").trim();

  try {
    const data = await callMemberSearch({ type: "club-contracts", clubCode, sinceMonths });
    const contracts = (data?.contracts || []).map((r: any) => ({
      code: r.CODE,
      name: r.NAME,
      memberKubun: r.KUBUN, // 1=会費(本会員) / 7=スタッフ / 70=法人個人
      termMonths: r.TERM, // 契約形態マスタ「有効期限」(契約期間/月数相当)
      flags: {
        school: r.SCHOOL_FLAG === 1,
        groupDiscount: r.GROUP_DISCOUNT_FLAG === 1,
        pausable: r.PAUSABLE_FLAG === 1,
      },
      monthlyUses: r.MONTHLY_USES,
      yearlyUses: r.YEARLY_USES,
      productCodes: {
        deposit: r.DEPOSIT_PID,
        enrollment: r.ENROLL_PID,
        adminFee: r.ADMIN_FEE_PID,
        monthlyFee: r.FEE_PID,
        annualFee: r.ANNUAL_FEE_PID,
      },
      sortNo: r.SORT_NO,
      recentSignups: r.RECENT_COUNT, // 直近sinceMonthsの新規契約数
      latestSignupDate: r.LATEST_JOIN, // 直近の入会届出日(YYYYMMDD)
    }));

    // Knowbase(入会管理)の権威上書きをマージ: enrollEnabled(既定true) + penalty(既定{})。
    const overrides = await loadEnrollmentOverrides(String(data?.clubCode ?? clubCode));
    const seen = new Set<string>();
    let mergedContracts = contracts.map((c: any) => {
      const ov = overrides.get(String(c.code));
      seen.add(String(c.code));
      return { ...c, enrollEnabled: ov?.enrollEnabled ?? true, penalty: ov?.penalty ?? {}, overridden: !!ov };
    });
    // 近似に出ない上書き契約(募集停止で実績消失など)も反映
    for (const [code, ov] of overrides) {
      if (seen.has(code)) continue;
      mergedContracts.push({
        code, name: ov.name ?? code, memberKubun: ov.memberKubun ?? null, termMonths: ov.termMonths ?? null,
        flags: {}, monthlyUses: null, yearlyUses: null, productCodes: {}, sortNo: ov.sortNo ?? 9999,
        recentSignups: 0, latestSignupDate: null,
        enrollEnabled: ov.enrollEnabled ?? true, penalty: ov.penalty ?? {}, overridden: true,
      });
    }
    // onlyEnrollable=1 で入会可のみに絞る
    if (sp.get("onlyEnrollable") === "1") mergedContracts = mergedContracts.filter((c: any) => c.enrollEnabled);

    return NextResponse.json({
      ok: true,
      clubCode: String(data?.clubCode ?? clubCode),
      sinceMonths: data?.sinceMonths ?? Number(sinceMonths),
<<<<<<< Updated upstream
      count: contracts.length,
      contracts,
=======
      // 導出方法: 一覧の土台は直近入会実績による近似。ただし入会可否(enrollEnabled)と違約金(penalty)は
      // Knowbase(入会管理画面)の設定が権威。overridden=true の契約はKB設定が適用済み。
      derivation: {
        method: "recent-signups+knowbase-overrides",
        approximate: true,
        note: "契約一覧は直近入会実績に基づく近似。ただし enrollEnabled / penalty は Knowbase の入会管理設定が権威(overridden=true の契約)。未設定の契約は enrollEnabled=true(募集中とみなす)。",
      },
      count: mergedContracts.length,
      contracts: mergedContracts,
>>>>>>> Stashed changes
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "member_search_error" }, { status: 502 });
  }
}
