// app/api/store-settings/contract-settings/route.ts
// 入会管理オーバーレイの管理API。クラブ×契約形態ごとに、Oracleマスタに無い
// プレオープン/家族可否/説明文/募集ON-OFF/違約金 を knowbase 側で入力・保存する。
//   GET  ?clubCode=.. → そのクラブの契約形態一覧(member-search) + 既存overlayをマージして返す
//   POST { clubCode, contractFormCode, enabled?, isPreOpenContract?, familyAllowed?, description?, penalty? } → upsert
// 認証 = 店舗設定系と同じ getRefundUser + 担当店舗スコープ。
import { NextResponse } from "next/server";
import { callMemberSearch } from "@/lib/unpaid";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { listClubContractSettings, putClubContractSetting } from "@/lib/clubContractSettings";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const clubCode = (new URL(req.url).searchParams.get("clubCode") || "").trim();
  if (!/^\d+$/.test(clubCode)) return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) return NextResponse.json({ ok: false, error: "この店舗は担当外です" }, { status: 403 });

  try {
    const [data, optData, settings] = await Promise.all([
      callMemberSearch({ type: "club-contracts", clubCode, sinceMonths: "24" }),
      callMemberSearch({ type: "club-options", clubCode }),
      listClubContractSettings(clubCode),
    ]);
    const ovMap: Record<string, any> = {};
    for (const s of settings) ovMap[String(s.contractFormCode)] = s;
    const contracts = (data?.contracts || []).map((r: any) => {
      const ov = ovMap[String(r.CODE)] || {};
      return {
        contractFormCode: String(r.CODE),
        name: r.NAME,
        memberKubun: r.KUBUN,
        enabled: typeof ov.enabled === "boolean" ? ov.enabled : null,
        isPreOpenContract: typeof ov.isPreOpenContract === "boolean" ? ov.isPreOpenContract : null,
        familyAllowed: typeof ov.familyAllowed === "boolean" ? ov.familyAllowed : null,
        description: ov.description ?? "",
        penalty: ov.penalty ?? null,
        updatedAt: ov.updatedAt ?? null,
      };
    });
    const options = (optData?.options || []).map((o: any) => {
      const ov = ovMap[String(o.CODE)] || {};
      return {
        contractFormCode: String(o.CODE),
        name: o.NAME,
        enabled: typeof ov.enabled === "boolean" ? ov.enabled : null,
        scope: ov.scope ?? "all",
        availableForContracts: Array.isArray(ov.availableForContracts) ? ov.availableForContracts : [],
        description: ov.description ?? "",
        updatedAt: ov.updatedAt ?? null,
      };
    });
    // 主契約選択肢(availableForContracts 用): 主契約のみ(会員区分 1/7/8/70)。
    const mainContracts = contracts.filter((c: any) => [1, 7, 8, 70].includes(Number(c.memberKubun))).map((c: any) => ({ code: c.contractFormCode, name: c.name }));
    return NextResponse.json({ ok: true, clubCode, count: contracts.length, contracts, options, mainContracts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "member_search_error" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  const clubCode = String(body?.clubCode ?? "").trim();
  const contractFormCode = String(body?.contractFormCode ?? "").trim();
  if (!/^\d+$/.test(clubCode) || !contractFormCode) return NextResponse.json({ ok: false, error: "clubCode/contractFormCode required" }, { status: 400 });
  if (!isClubInScope(user, clubCode)) return NextResponse.json({ ok: false, error: "この店舗は担当外です" }, { status: 403 });

  const penaltyRaw = body?.penalty;
  const penalty = penaltyRaw === "" || penaltyRaw == null ? null : Number(penaltyRaw);
  if (penalty != null && !Number.isFinite(penalty)) return NextResponse.json({ ok: false, error: "penalty は数値で指定してください" }, { status: 400 });
  const validScopes = ["all", "corporate", "premium", "family"];
  const scope = validScopes.includes(String(body?.scope)) ? (body.scope as any) : undefined;

  try {
    await putClubContractSetting({
      clubCode,
      contractFormCode,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
      isPreOpenContract: typeof body?.isPreOpenContract === "boolean" ? body.isPreOpenContract : undefined,
      familyAllowed: typeof body?.familyAllowed === "boolean" ? body.familyAllowed : undefined,
      description: body?.description != null ? String(body.description).slice(0, 2000) : undefined,
      penalty,
      // オプション向け: 提供先主契約(配列)・スコープ
      availableForContracts: Array.isArray(body?.availableForContracts) ? body.availableForContracts.map(String) : undefined,
      scope,
      updatedAt: new Date().toISOString(),
      updatedBy: user.email || user.userId,
    });
    await writeAudit({ userId: user.email, userName: user.name, action: "contractSettings.upsert", resource: `club:${clubCode}`, clubCodes: [clubCode], detail: { contractFormCode }, ip: clientIp(req), result: "ok" });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "save_failed" }, { status: 502 });
  }
}
