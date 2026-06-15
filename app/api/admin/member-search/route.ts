// app/api/admin/member-search/route.ts
//
// 管理者専用: FIT会員情報検索の入口API。
// 1. isAdminRequest で admin 限定にガード
// 2. 環境変数で指定した API Gateway を叩き (x-api-key ヘッダ付与)
// 3. 結果をマスキングして返す
// 4. 監査ログを DynamoDB に書き込み (誰が・何タイプで・何件ヒットしたか)
//
// 必要な環境変数:
//   MEMBER_SEARCH_API_BASE   例: https://abcd1234.execute-api.ap-northeast-1.amazonaws.com/prod
//   MEMBER_SEARCH_API_KEY    API Gateway のAPI Key
//   MEMBER_SEARCH_AUDIT_TABLE  デフォルト "knowbie-member-lookup-audit"

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, requestHasPermission, verifySignedValue } from "@/lib/auth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";
const AUDIT_TABLE = process.env.MEMBER_SEARCH_AUDIT_TABLE || "knowbie-member-lookup-audit";
const CLUBS_TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const CLUBS_REGION = process.env.CLUBS_TABLE_REGION || "us-east-1";

const SUPPORTED_TYPES = new Set([
  "udid",
  "member_no",
  "phone",
  "email",
  "name_kanji",
  "name_kana",
]);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const clubsDdb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: CLUBS_REGION }));

export async function GET(req: NextRequest) {
  // ① admin ガード + member_search 権限ガード (両方必要)
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (!(await requestHasPermission(req, "member_search"))) {
    return NextResponse.json(
      { ok: false, error: "permission_denied", required: "member_search" },
      { status: 403 }
    );
  }
  if (!API_BASE || !API_KEY) {
    return NextResponse.json(
      { ok: false, error: "search_api_not_configured" },
      { status: 500 }
    );
  }

  // ② パラメータ検証
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") || "";
  const q = (sp.get("q") || "").trim();
  const q2 = (sp.get("q2") || "").trim();

  if (!SUPPORTED_TYPES.has(type)) {
    return NextResponse.json({ ok: false, error: "invalid_type" }, { status: 400 });
  }
  if (!q) {
    return NextResponse.json({ ok: false, error: "missing_q" }, { status: 400 });
  }

  // ③ Lambda (API Gateway) 呼び出し
  const url = new URL(`${API_BASE}/members/search`);
  url.searchParams.set("type", type);
  url.searchParams.set("q", q);
  if (q2) url.searchParams.set("q2", q2);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-key": API_KEY },
      cache: "no-store",
    });
  } catch (err) {
    console.error("upstream fetch failed", err);
    return NextResponse.json({ ok: false, error: "upstream_unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("upstream error", upstream.status, text);
    return NextResponse.json(
      { ok: false, error: "upstream_error", status: upstream.status },
      { status: 502 }
    );
  }

  let payload: { results?: MemberRow[]; count?: number };
  try {
    payload = await upstream.json();
  } catch (e: any) {
    console.error("upstream json parse failed", e);
    return NextResponse.json(
      { ok: false, error: "upstream_invalid_json", detail: e?.message },
      { status: 502 }
    );
  }

  let masked: ReturnType<typeof maskRow>[];
  let results: any[];
  try {
    masked = (payload.results || []).map(maskRow);
    results = await enrichWithClubNames(masked);
  } catch (e: any) {
    console.error("member-search post-process failed", e, "payload sample:", JSON.stringify(payload?.results?.[0] ?? null));
    return NextResponse.json(
      { ok: false, error: "post_process_failed", detail: e?.message },
      { status: 500 }
    );
  }

  // ④ 監査ログ書き込み (失敗してもレスポンスは返す)
  const session = await readSessionFromReq(req);
  ddb
    .send(
      new PutCommand({
        TableName: AUDIT_TABLE,
        Item: {
          userId: session?.email ?? "unknown",
          timestamp: new Date().toISOString(),
          action: "search",
          searchType: type,
          resultCount: results.length,
          ip: req.headers.get("x-forwarded-for") ?? "",
          userAgent: req.headers.get("user-agent") ?? "",
        },
      })
    )
    .catch((e) => console.error("audit log write failed", e));

  return NextResponse.json({ ok: true, results, count: results.length });
}

// --- 共通ユーティリティ -------------------------------------------------------
async function readSessionFromReq(req: NextRequest) {
  const email = await verifySignedValue(req.cookies.get("kb_user")?.value);
  return email ? { email } : null;
}

// --- マスキング ---------------------------------------------------------------
type MemberRow = {
  kojinSeq: string | null;
  memberNo: string | null;
  nameKanji: string | null;
  nameKanaSei: string | null;
  nameKanaMei: string | null;
  birthday: string | null;
  email: string | null;
  phone: string | null;
  udid: string | null;
  udidDeleted: boolean;
  clubCode?: string | null;
};

function maskRow(r: MemberRow) {
  return {
    ...r,
    email: maskEmail(r.email),
    phone: maskPhone(r.phone),
    udid: maskUdid(r.udid),
    clubCode: r.clubCode ?? null,
  };
}

// --- クラブ名解決 (最新クラブ 1 件のみ) ----------------------------------------
async function enrichWithClubNames(rows: ReturnType<typeof maskRow>[]) {
  const codes = Array.from(
    new Set(rows.map((r) => r.clubCode).filter((c): c is string => !!c))
  );
  const nameByCode = codes.length > 0 ? await fetchClubNames(codes) : new Map();
  return rows.map((r) => ({
    ...r,
    club: r.clubCode
      ? { code: r.clubCode, name: nameByCode.get(r.clubCode) ?? null }
      : null,
  }));
}

async function fetchClubNames(codes: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  // BatchGetItem は 100 件上限
  for (let i = 0; i < codes.length; i += 100) {
    const chunk = codes.slice(i, i + 100);
    try {
      const res = await clubsDdb.send(
        new BatchGetCommand({
          RequestItems: {
            [CLUBS_TABLE]: {
              Keys: chunk.map((c) => ({ clubCode: c })),
              ProjectionExpression: "clubCode, clubNameShort, clubName",
            },
          },
        })
      );
      for (const item of res.Responses?.[CLUBS_TABLE] ?? []) {
        const code = String((item as any).clubCode);
        const name = (item as any).clubNameShort || (item as any).clubName;
        if (name) result.set(code, name);
      }
    } catch (e) {
      console.error("clubs batch get failed", e);
    }
  }
  return result;
}

function maskEmail(v: string | null): string | null {
  if (!v) return v;
  const at = v.indexOf("@");
  if (at < 0) return v;
  const local = v.slice(0, at);
  const domain = v.slice(at);
  if (local.length <= 2) return `${local[0] ?? "*"}***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

function maskPhone(v: string | null): string | null {
  if (!v) return v;
  const digits = v.replace(/\D/g, "");
  if (digits.length <= 4) return v;
  const tail = digits.slice(-4);
  return `***-****-${tail}`;
}

function maskUdid(v: string | null): string | null {
  if (!v) return v;
  if (v.length <= 6) return `***${v.slice(-2)}`;
  return `${v.slice(0, 4)}***${v.slice(-4)}`;
}
