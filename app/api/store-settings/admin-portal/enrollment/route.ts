// app/api/store-settings/admin-portal/enrollment/route.ts
// 入会管理(店舗詳細管理): クラブに付随する契約(契約形態)ごとの「入会可否 ON/OFF」と
// 契約マスタ(違約金などフルセット)を Knowbase 側で権威管理する。
//   - 契約一覧の土台は Oracle 近似(member-search: club-contracts = 直近入会実績)。
//   - ON/OFF と違約金は Knowbase 保有(DynamoDB knowbie-club-contract-settings, PK=clubCode/SK=契約形態コード)。
//     → Knowbase の上書きが権威。募集停止で実績が消えた契約も上書き行があれば一覧に残す。
//   GET /api/store-settings/admin-portal/enrollment?clubCode=375[&sinceMonths=12]
//   PUT /api/store-settings/admin-portal/enrollment?clubCode=375  body:{ settings:[{contractFormCode,name,enrollEnabled,penalty}] }
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSessionUser } from "@/lib/auth";
import { callMemberSearch } from "@/lib/unpaid";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.CLUB_CONTRACT_SETTINGS_TABLE || "knowbie-club-contract-settings";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// 担当スコープ: clubCodes 空 = 全店。指定ありなら当該クラブを含むこと。
function inScope(user: { clubCodes: string[] }, clubCode: string): boolean {
  return !user.clubCodes || user.clubCodes.length === 0 || user.clubCodes.includes(clubCode);
}

const numOrUndef = (v: any): number | undefined =>
  v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v);
const boolOrUndef = (v: any): boolean | undefined => (typeof v === "boolean" ? v : undefined);

// 違約金フルセットの正規化(未設定は undefined = DDBに書かない)
function normPenalty(p: any) {
  p = p && typeof p === "object" ? p : {};
  return {
    penaltyAmount: numOrUndef(p.penaltyAmount),         // 違約金額
    penaltyFormula: p.penaltyFormula ? String(p.penaltyFormula).slice(0, 500) : undefined, // 計算式
    minTermMonths: numOrUndef(p.minTermMonths),         // 最低契約期間(月)
    earlyCancelAllowed: boolOrUndef(p.earlyCancelAllowed), // 中途解約可否
    adminFee: numOrUndef(p.adminFee),                   // 事務手数料
    cancelFee: numOrUndef(p.cancelFee),                 // 解約手数料
    depositRefundable: boolOrUndef(p.depositRefundable), // 保証金返還可否
    campaignLockMonths: numOrUndef(p.campaignLockMonths), // キャンペーン縛り期間(月)
  };
}

async function loadOverrides(clubCode: string): Promise<Map<string, any>> {
  const m = new Map<string, any>();
  try {
    let ek: any;
    do {
      const r: any = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "clubCode = :c",
        ExpressionAttributeValues: { ":c": clubCode },
        ExclusiveStartKey: ek,
      }));
      for (const it of r.Items ?? []) m.set(String(it.contractFormCode), it);
      ek = r.LastEvaluatedKey;
    } while (ek);
  } catch (e) {
    console.error("[enrollment] loadOverrides failed", e);
  }
  return m;
}

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  if (!inScope(user, clubCode)) return NextResponse.json({ ok: false, error: "この店舗は担当スコープ外です" }, { status: 403 });
  const sinceMonths = (sp.get("sinceMonths") || "12").trim();

  try {
    // 近似(直近入会実績)の契約一覧
    let approx: any[] = [];
    try {
      const data = await callMemberSearch({ type: "club-contracts", clubCode, sinceMonths });
      approx = (data?.contracts || []).map((r: any) => ({
        contractFormCode: String(r.CODE),
        name: r.NAME,
        memberKubun: r.KUBUN,
        termMonths: r.TERM,
        sortNo: r.SORT_NO,
        recentSignups: r.RECENT_COUNT,
        latestSignupDate: r.LATEST_JOIN,
      }));
    } catch (e) {
      console.error("[enrollment] club-contracts failed", e);
    }

    const overrides = await loadOverrides(clubCode);
    const seen = new Set<string>();
    const merge = (base: any) => {
      const ov = overrides.get(base.contractFormCode);
      seen.add(base.contractFormCode);
      return {
        ...base,
        // Knowbase上書きが権威。未設定は既定 enrollEnabled=true(近似に出る=募集中とみなす)。
        enrollEnabled: ov?.enrollEnabled ?? true,
        penalty: ov?.penalty ?? {},
        hasOverride: !!ov,
        updatedAt: ov?.updatedAt ?? null,
      };
    };
    const rows = approx.map(merge);
    // 近似に出ないが上書き行がある契約(募集停止で実績が消えた等)も残す。
    for (const [code, ov] of overrides) {
      if (seen.has(code)) continue;
      rows.push({
        contractFormCode: code, name: ov.name ?? code, memberKubun: ov.memberKubun ?? null,
        termMonths: ov.termMonths ?? null, sortNo: ov.sortNo ?? 9999, recentSignups: 0, latestSignupDate: null,
        enrollEnabled: ov.enrollEnabled ?? true, penalty: ov.penalty ?? {}, hasOverride: true,
        updatedAt: ov.updatedAt ?? null, approxAbsent: true,
      });
    }
    rows.sort((a, b) => (Number(a.sortNo ?? 9999) - Number(b.sortNo ?? 9999)) || String(a.contractFormCode).localeCompare(String(b.contractFormCode)));
    return NextResponse.json({ ok: true, clubCode, sinceMonths: Number(sinceMonths), contracts: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const clubCode = (sp.get("clubCode") || "").trim();
  if (!clubCode) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  if (!inScope(user, clubCode)) return NextResponse.json({ ok: false, error: "この店舗は担当スコープ外です" }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const settings = Array.isArray(body?.settings) ? body.settings : [];
  if (settings.length === 0) return NextResponse.json({ ok: false, error: "settings が空です" }, { status: 400 });

  const now = new Date().toISOString();
  let saved = 0;
  try {
    for (const s of settings) {
      const contractFormCode = String(s?.contractFormCode ?? "").trim();
      if (!contractFormCode) continue;
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          clubCode,
          contractFormCode,
          name: s?.name ? String(s.name).slice(0, 200) : undefined,
          memberKubun: s?.memberKubun ?? undefined,
          termMonths: numOrUndef(s?.termMonths),
          sortNo: numOrUndef(s?.sortNo),
          enrollEnabled: s?.enrollEnabled === true,
          penalty: normPenalty(s?.penalty),
          updatedAt: now,
          updatedBy: user.email,
        },
      }));
      saved += 1;
    }
    void writeAudit({
      userId: user.email, userName: user.email,
      action: "enrollment.settings.save", resource: `club:${clubCode}`,
      clubCodes: [clubCode], targetCount: saved, result: "ok",
      detail: { count: saved }, ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, saved });
  } catch (e: any) {
    console.error("[enrollment] save failed", e);
    return NextResponse.json({ ok: false, error: e?.message || "保存に失敗しました" }, { status: 500 });
  }
}
