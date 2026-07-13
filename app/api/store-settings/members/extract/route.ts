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
//       groupOp: "OR",                   // 条件グループ間の結合 (既定 OR。"AND" も可)
//       groups: [                        // 各グループ内は AND、グループ間は groupOp
//         {
//           genderCodes: [1,2],          // a.性別コード (1=男,2=女)。空なら絞らない
//           membershipStatus: ["stable","leaver"], // stable=退会日IS NULL / leaver=IS NOT NULL
//           contractTypes: ["レギュラー"], // e.契約形態名 IN(...)
//           joinDateFrom/To: "YYYYMMDD",  // c.利用開始日 BETWEEN
//           leaveDateFrom/To: "YYYYMMDD", // c.退会日 BETWEEN
//           visitCountFrom/To: <int>, visitFrom/visitTo: "YYYYMMDD", // 来館回数(期間内)
//           hasUnpaidOnly: <bool>,        // 会員入金歴.入金区分コード=4
//         }, ...
//       ],
//       limit, offset                    // プレビュー用ページング
//     }
//   ▼ Oracle SQL (clubCode/アプリ会員/会員区分は常に AND。グループは groupOp で結合):
//     ... WHERE c.クラブコード=:clubCode AND a.アプリ会員 IN(...) AND c.会員区分コード IN(...)
//         AND ( (group1 の各条件を AND) <groupOp> (group2 …) )   -- groupOp 既定 OR
//     各グループ内で使う条件(指定されたものだけ動的付与):
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
//       -- 未納 (hasUnpaidOnly=true のとき): 会員入金歴 f.入金区分コード=4 (3=支払済/4=未納)
//       [AND EXISTS (SELECT 1 FROM 会員入金歴 f WHERE f.契約者SEQ = c.契約者SEQ AND f.入金区分コード = 4)]
//       -- 来館回数 (visitCountFrom/To): 入館トラン g の 営業年月日 が対象期間内のレコード数で絞る
//       [AND (SELECT COUNT(*) FROM 入館トラン g
//               WHERE g.会員番号 = b.会員番号 AND g.クラブコード = c.クラブコード
//                 AND g.営業年月日 BETWEEN :visitFrom AND :visitTo) BETWEEN :visitMin AND :visitMax]
//   ▼ Response(JSON):
//     { "results": [ {memberNo,name,kana,birthday(YYYY-MM-DD),genderCode(1|2),
//                     clubCode,contractName,withdrawnAt,
//                     email} ], "totalCount": <条件一致総数> }
//     ※ email は個人テーブルのメールアドレス。DM(deliveryType=dm)の配信先に使う。
//
// ★ 来館回数の「0回」定義 (重要): 対象期間中に契約はあるが 入館トラン にレコードが無い人 = 0回。
//    → 入館トラン は INNER JOIN せず、EXISTS/相関サブクエリの COUNT で数える
//      (INNER JOIN すると 0回の会員が除外されてしまう)。同様に 会員入金歴 も EXISTS で
//      判定する (JOIN すると入金履歴の件数だけ行が増える)。
// ※ visitCountFrom/To, hasUnpaidOnly は本 route から member-search へ転送済み。
// ────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/memberDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";

type DeliveryType = "push" | "dm";

// 1条件グループ (グループ内はすべて AND)。グループ間は groupOp(既定 OR) で結合。
interface GroupInput {
  gender?: string[]; // ["male","female"]
  membershipStatus?: string[]; // ["stable","leaver"]
  contractTypes?: string[]; // 会員区分名
  contractForms?: string[]; // 契約形態名 (会員区分に紐づく)
  contractOptions?: string[]; // オプション契約の契約形態名 (別枠選択)
  joinDateFrom?: string; // "YYYY-MM-DD"
  joinDateTo?: string;
  leaveDateFrom?: string;
  leaveDateTo?: string;
  visitCountFrom?: string; // 来館回数レンジ
  visitCountTo?: string;
  visitPeriodFrom?: string; // 来館回数を数える期間 "YYYY-MM-DD"
  visitPeriodTo?: string;
  hasUnpaidOnly?: boolean;
}

interface ExtractBody extends GroupInput {
  deliveryType?: DeliveryType;
  clubCode?: string;
  includeOptions?: boolean;
  groupOp?: "OR" | "AND"; // グループ間の結合 (既定 OR)
  groups?: GroupInput[]; // 条件グループ。無ければフラットな条件を1グループとして扱う。
  limit?: number;
  offset?: number;
}

// 1グループを member-search 用の条件オブジェクトに変換 (グループ内 AND)
function mapGroup(g: GroupInput) {
  const genderCodes = Array.isArray(g.gender)
    ? g.gender.map((x) => (x === "male" ? 1 : x === "female" ? 2 : 0)).filter((c) => c === 1 || c === 2)
    : [];
  return {
    genderCodes,
    membershipStatus: Array.isArray(g.membershipStatus) ? g.membershipStatus : [],
    contractTypes: Array.isArray(g.contractTypes) ? g.contractTypes : [],
    // オプション(contractOptions)も契約形態名なので contractForms に統合して絞り込む
    contractForms: [
      ...(Array.isArray(g.contractForms) ? g.contractForms : []),
      ...(Array.isArray(g.contractOptions) ? g.contractOptions : []),
    ],
    joinDateFrom: toYmd(g.joinDateFrom),
    joinDateTo: toYmd(g.joinDateTo),
    leaveDateFrom: toYmd(g.leaveDateFrom),
    leaveDateTo: toYmd(g.leaveDateTo),
    visitCountFrom: g.visitCountFrom ? Number(g.visitCountFrom) : undefined,
    visitCountTo: g.visitCountTo ? Number(g.visitCountTo) : undefined,
    visitFrom: toYmd(g.visitPeriodFrom),
    visitTo: toYmd(g.visitPeriodTo),
    hasUnpaidOnly: !!g.hasUnpaidOnly,
  };
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

  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 1000);
  const offset = Math.max(Number(body.offset) || 0, 0);

  // 条件グループ: groups があればそれを、無ければフラットな条件を1グループとして扱う(後方互換)。
  const rawGroups: GroupInput[] =
    Array.isArray(body.groups) && body.groups.length > 0 ? body.groups : [body];
  const groupOp: "OR" | "AND" = body.groupOp === "AND" ? "AND" : "OR";

  // ── member-search(Oracle) 抽出 ──
  // グループ内は AND、グループ間は groupOp(既定 OR)。clubCode/アプリ会員/会員区分は
  // 全グループ共通の前提として member-search 側で常に AND する。
  const searchBody = {
    deliveryType,
    clubCode,
    includeOptions: !!body.includeOptions,
    groupOp,
    groups: rawGroups.map(mapGroup),
    limit,
    offset,
  };

  let upstream: Response;
  try {
    // 抽出は member-search の GET 経路 (?type=member_extract) に base64 ペイロードで渡す。
    const payloadB64 = Buffer.from(JSON.stringify(searchBody), "utf-8").toString("base64");
    const url = new URL(`${API_BASE}/members/search`);
    url.searchParams.set("type", "member_extract");
    url.searchParams.set("payload", payloadB64);
    upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-key": API_KEY },
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
      email?: string | null; // 個人テーブルのメール (DM用)
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
    // DM のメールは個人テーブル(Oracle)優先、無ければ app_user を補完
    const email = deliveryType === "dm" ? (r.email || au?.email || null) : null;
    // 配信可否: push=トークン保有かつ通知許諾 / dm=メール保有
    const deliverable =
      deliveryType === "push" ? !!au && au.hasToken && au.approveNotice : !!email;
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
      appUserId: au?.appUserId ?? null, // push: information2_destination へ
      email, // dm: 送信先メール
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
