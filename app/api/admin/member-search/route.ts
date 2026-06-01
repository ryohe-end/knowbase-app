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
import { isAdminRequest, verifySignedValue } from "@/lib/auth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";
const AUDIT_TABLE = process.env.MEMBER_SEARCH_AUDIT_TABLE || "knowbie-member-lookup-audit";

const SUPPORTED_TYPES = new Set([
  "udid",
  "member_no",
  "phone",
  "email",
  "name_kanji",
  "name_kana",
]);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export async function GET(req: NextRequest) {
  // ① admin ガード
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
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

  const payload = (await upstream.json()) as { results?: MemberRow[]; count?: number };
  const results = (payload.results || []).map(maskRow);

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
};

function maskRow(r: MemberRow) {
  return {
    ...r,
    email: maskEmail(r.email),
    phone: maskPhone(r.phone),
    udid: maskUdid(r.udid),
  };
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
