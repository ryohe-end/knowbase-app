// app/api/store-settings/members/extract/route.ts
//
// DM/Push の会員抽出 API。dm / push 画面の generateMockMembers を置換する本番実装。
// 画面操作時のオンデマンド実行: 条件 → member-search(Oracle)抽出 → app_user(Fly PG)突合。
//
// ── member-search Lambda 側に追加してもらうエンドポイント ──────────────
//   POST {MEMBER_SEARCH_API_BASE}/members/extract
//   Header: x-api-key: {MEMBER_SEARCH_API_KEY}
//   Body(JSON):
//     {
//       deliveryType: "push"|"dm",      // a.アプリ会員: push=(1) / dm=(0,1)
//       clubCode: "123",                 // c.クラブコード (必須)
//       includeOptions: false,           // true で 会員区分90 を IN に追加(既定 1,60,70)
//       genderCodes: [1,2],              // a.性別コード (1=男,2=女)。空/未指定なら絞らない
//       membershipStatus: ["stable","leaver"], // stable=退会日IS NULL / leaver=退会日IS NOT NULL
//       contractTypes: ["レギュラー"],   // e.契約形態名 IN(...)。空なら絞らない
//       joinDateFrom/To: "YYYYMMDD",     // c.利用開始日 BETWEEN
//       leaveDateFrom/To: "YYYYMMDD",    // c.退会日 BETWEEN
//       limit, offset                    // プレビュー用ページング
//     }
//   ▼ Oracle SQL (指定条件だけ動的に WHERE 付与):
//     SELECT b.会員番号, a.漢字姓名 AS name, a.カナ姓||a.カナ名 AS kana,
//            a.生年月日 AS birthday, a.性別コード AS genderCode,
//            c.クラブコード, e.契約形態名 AS contractName, c.退会日 AS withdrawnAt
//     FROM 個人 a
//     INNER JOIN 会員番号 b     ON a.個人SEQ     = b.個人SEQ
//     INNER JOIN 会員契約 c     ON b.契約者SEQ   = c.契約者SEQ
//     INNER JOIN 会員契約明細 d ON c.契約SEQ     = d.契約SEQ
//     INNER JOIN 契約形態 e     ON d.契約形態コード = e.契約形態コード
//     WHERE c.クラブコード = :clubCode
//       AND a.アプリ会員 IN (:appMemberValues)
//       AND c.会員区分コード IN (:kubunCodes)
//       [AND a.性別コード IN (:genderCodes)]
//       [AND c.利用開始日 BETWEEN :joinFrom AND :joinTo]
//       [AND c.退会日     BETWEEN :leaveFrom AND :leaveTo]
//       [AND (退会日 IS NULL / IS NOT NULL by membershipStatus)]
//       [AND e.契約形態名 IN (:contractTypeNames)]
//   ▼ Response(JSON):
//     { "results": [ {memberNo,name,kana,birthday(YYYY-MM-DD),genderCode(1|2),
//                     clubCode,contractName,withdrawnAt} ], "totalCount": <条件一致総数> }
//
// ※ visitCount(来館回数) / hasUnpaidOnly(未納) は別途 SQL 提供待ち。member-search へ
//    転送済み(visitCountFrom/To, hasUnpaidOnly)なので、Lambda 側 SQL 対応後に自動で効く。
// ────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/memberDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";

type DeliveryType = "push" | "dm";

interface ExtractBody {
  deliveryType?: DeliveryType;
  clubCode?: string;
  includeOptions?: boolean;
  gender?: string[]; // ["male","female"]
  membershipStatus?: string[]; // ["stable","leaver"]
  contractTypes?: string[];
  joinDateFrom?: string; // "YYYY-MM-DD"
  joinDateTo?: string;
  leaveDateFrom?: string;
  leaveDateTo?: string;
  visitCountFrom?: string; // 未適用(TODO)
  visitCountTo?: string;
  hasUnpaidOnly?: boolean; // 未適用(TODO)
  limit?: number;
  offset?: number;
}

// "YYYY-MM-DD" → "YYYYMMDD"。空なら undefined。
function toYmd(d?: string): string | undefined {
  if (!d) return undefined;
  const s = d.replaceAll("-", "").trim();
  return /^\d{8}$/.test(s) ? s : undefined;
}

// 生年月日(YYYY-MM-DD) → 満年齢
function ageFrom(birthday?: string | null): number | null {
  if (!birthday) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday);
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const now = new Date();
  let age = now.getFullYear() - y;
  const md = (now.getMonth() + 1) * 100 + now.getDate();
  if (md < mo * 100 + da) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!API_BASE || !API_KEY) {
    return NextResponse.json({ ok: false, error: "member-search not configured" }, { status: 500 });
  }

  let body: ExtractBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const deliveryType: DeliveryType = body.deliveryType === "dm" ? "dm" : "push";
  const clubCode = (body.clubCode || "").trim();
  if (!clubCode) {
    return NextResponse.json({ ok: false, error: "clubCode is required" }, { status: 400 });
  }
  // 担当外クラブの抽出を禁止 (clubCodes 空=admin全クラブ)
  if (user.clubCodes.length > 0 && !user.clubCodes.includes(clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
  }

  // 性別 male/female → 性別コード 1/2
  const genderCodes = Array.isArray(body.gender)
    ? body.gender.map((g) => (g === "male" ? 1 : g === "female" ? 2 : 0)).filter((c) => c === 1 || c === 2)
    : [];

  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 1000);
  const offset = Math.max(Number(body.offset) || 0, 0);

  // ── member-search(Oracle) 抽出 ──
  const searchBody = {
    deliveryType,
    clubCode,
    includeOptions: !!body.includeOptions,
    genderCodes,
    membershipStatus: Array.isArray(body.membershipStatus) ? body.membershipStatus : [],
    contractTypes: Array.isArray(body.contractTypes) ? body.contractTypes : [],
    joinDateFrom: toYmd(body.joinDateFrom),
    joinDateTo: toYmd(body.joinDateTo),
    leaveDateFrom: toYmd(body.leaveDateFrom),
    leaveDateTo: toYmd(body.leaveDateTo),
    // 来館回数 / 未納 (別途 SQL 提供待ち)。member-search 側の対応後に有効化。
    visitCountFrom: body.visitCountFrom ? Number(body.visitCountFrom) : undefined,
    visitCountTo: body.visitCountTo ? Number(body.visitCountTo) : undefined,
    hasUnpaidOnly: !!body.hasUnpaidOnly,
    limit,
    offset,
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/members/extract`, {
      method: "POST",
      headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(searchBody),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[members/extract] upstream fetch failed", err);
    return NextResponse.json({ ok: false, error: "upstream_unreachable" }, { status: 502 });
  }
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error("[members/extract] upstream error", upstream.status, text);
    // 抽出エンドポイント未実装(404)は分かりやすく返す
    const code = upstream.status === 404 ? "extract_endpoint_pending" : "upstream_error";
    return NextResponse.json({ ok: false, error: code, status: upstream.status }, { status: 502 });
  }

  const payload = (await upstream.json()) as {
    results?: Array<{
      memberNo: string | number;
      name?: string;
      kana?: string;
      birthday?: string | null;
      genderCode?: number;
      clubCode?: string;
      contractName?: string | null;
      withdrawnAt?: string | null;
    }>;
    totalCount?: number;
  };
  const oracleRows = Array.isArray(payload.results) ? payload.results : [];
  const totalCount = typeof payload.totalCount === "number" ? payload.totalCount : oracleRows.length;

  // ── app_user(Fly PG) 突合: 配信可否 + 内部ID解決 ──
  const memberNos = oracleRows.map((r) => String(r.memberNo));
  const appUserByMemberId = new Map<
    string,
    { appUserId: number; approveNotice: boolean; hasToken: boolean; email: string | null }
  >();
  if (memberNos.length > 0) {
    const res = await query<{
      member_id: string;
      app_user_id: number;
      approve_of_notice: boolean;
      has_token: boolean;
      email: string | null;
    }>(
      `SELECT member_id, id AS app_user_id, approve_of_notice,
              (fcm_token IS NOT NULL OR apns_token IS NOT NULL) AS has_token,
              NULLIF(hacomono_mail_address, '') AS email
       FROM app_user
       WHERE member_id = ANY($1::text[])`,
      [memberNos]
    );
    for (const r of res.rows) {
      appUserByMemberId.set(String(r.member_id), {
        appUserId: r.app_user_id,
        approveNotice: r.approve_of_notice,
        hasToken: r.has_token,
        email: r.email,
      });
    }
  }

  const members = oracleRows.map((r) => {
    const memberNo = String(r.memberNo);
    const au = appUserByMemberId.get(memberNo) ?? null;
    // 配信可否: push=トークン保有かつ通知許諾 / dm=メール保有
    const deliverable =
      deliveryType === "push"
        ? !!au && au.hasToken && au.approveNotice
        : !!au && !!au.email;
    return {
      memberNo,
      name: r.name ?? "",
      kana: r.kana ?? "",
      birthday: r.birthday ?? null,
      age: ageFrom(r.birthday),
      gender: r.genderCode === 1 ? "male" : r.genderCode === 2 ? "female" : null,
      clubCode: r.clubCode ?? clubCode,
      contractType: r.contractName ?? "",
      withdrawnAt: r.withdrawnAt ?? null,
      appUserId: au?.appUserId ?? null, // ← 配信時に information2_destination へ
      deliverable,
    };
  });

  const deliverableCount = members.filter((m) => m.deliverable).length;

  return NextResponse.json({
    ok: true,
    deliveryType,
    totalCount, // Oracle 条件一致総数
    returnedCount: members.length, // このページで返した件数
    deliverableCount, // 実際に配信可能な件数
    members,
    // 未適用フィルタの明示 (UI で注意表示できるように)
    notApplied: {
      visitCount: !!(body.visitCountFrom || body.visitCountTo),
      hasUnpaidOnly: !!body.hasUnpaidOnly,
    },
  });
}
