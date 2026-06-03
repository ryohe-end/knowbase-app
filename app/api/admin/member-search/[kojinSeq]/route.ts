// app/api/admin/member-search/[kojinSeq]/route.ts
//
// 管理者専用: 個人SEQ 指定で会員詳細を取得し、view 監査ログを残す。
// マスキングはせず、フル情報を返す (admin限定なので)。

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

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const clubsDdb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: CLUBS_REGION }));

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ kojinSeq: string }> }
) {
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

  const { kojinSeq } = await ctx.params;
  if (!/^\d+$/.test(kojinSeq)) {
    return NextResponse.json({ ok: false, error: "invalid_kojin_seq" }, { status: 400 });
  }

  const url = new URL(`${API_BASE}/members/search`);
  url.searchParams.set("type", "kojin_seq");
  url.searchParams.set("q", kojinSeq);

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
    return NextResponse.json(
      { ok: false, error: "upstream_error", status: upstream.status },
      { status: 502 }
    );
  }

  const payload = (await upstream.json()) as { results?: any[] };
  const rawRows = payload.results || [];

  if (rawRows.length === 0) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // clubCode を knowbie-clubs から名前解決
  const codes = Array.from(
    new Set(rawRows.map((r) => r.clubCode).filter((c): c is string => !!c))
  );
  const nameByCode = new Map<string, string>();
  if (codes.length > 0) {
    try {
      const res = await clubsDdb.send(
        new BatchGetCommand({
          RequestItems: {
            [CLUBS_TABLE]: {
              Keys: codes.map((c) => ({ clubCode: c })),
              ProjectionExpression: "clubCode, clubNameShort, clubName",
            },
          },
        })
      );
      for (const item of res.Responses?.[CLUBS_TABLE] ?? []) {
        const code = String((item as any).clubCode);
        const name = (item as any).clubNameShort || (item as any).clubName;
        if (name) nameByCode.set(code, name);
      }
    } catch (e) {
      console.error("clubs batch get failed", e);
    }
  }
  const rows = rawRows.map((r) => ({
    ...r,
    club: r.clubCode
      ? { code: r.clubCode, name: nameByCode.get(r.clubCode) ?? null }
      : null,
  }));

  // 監査ログ (view)
  const email = await verifySignedValue(req.cookies.get("kb_user")?.value);
  ddb
    .send(
      new PutCommand({
        TableName: AUDIT_TABLE,
        Item: {
          userId: email ?? "unknown",
          timestamp: new Date().toISOString(),
          action: "view",
          accessedKojinSeq: kojinSeq,
          ip: req.headers.get("x-forwarded-for") ?? "",
          userAgent: req.headers.get("user-agent") ?? "",
        },
      })
    )
    .catch((e) => console.error("audit log write failed", e));

  return NextResponse.json({ ok: true, member: rows });
}
