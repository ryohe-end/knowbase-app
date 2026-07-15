// app/api/store-settings/points/history/route.ts
//
// ポイント変動履歴 (CPSS get_history_time_span) を期間指定 + 50行ページ送りで返す。
//   GET ?memberCode=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1
//
// ・会員の全ポイント履歴(タウンシステム自動付与/利用/店舗付与すべて)を CPSS から取得。
// ・ブランド/スコープは会員番号の所属クラブ(先頭3桁)で解決・厳密化。
// ・knowbase 由来の付与は DDB(yamauchi-PointTransactions)の理由/担当/取消可否で補完。
import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { getClubBusinessType, cpssBrandForBusinessType } from "@/lib/clubScope";
import { cpssCall } from "@/lib/cpssProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";
import type { PointTransaction as PersistedTx } from "@/types/pointTransaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const PT_TABLE = process.env.DYNAMO_POINT_TRANSACTIONS_TABLE || "yamauchi-PointTransactions";
const CPSS_ENV = (process.env.CPSS_ENV as "stg" | "prod") || "stg";
const PAGE_SIZE = 50;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// "YYYY-MM-DD" → "YYYYMMDD000000"。日数オフセット可(終了日を翌日にして当日を含める)。
function toYmdHis(date: string, addDays = 0): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + addDays);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${mo}${da}000000`;
}

async function fetchPersistedByMember(clubCode: string, memberCode: string): Promise<PersistedTx[]> {
  try {
    const res = await ddb.send(new ScanCommand({ TableName: PT_TABLE }));
    return ((res.Items ?? []) as PersistedTx[]).filter(
      (t) => t.clubCode === clubCode && t.memberCode === memberCode
    );
  } catch (e) {
    console.error("[points/history] persisted scan failed", e);
    return [];
  }
}

export async function GET(req: NextRequest) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const memberCode = (sp.get("memberCode") || "").trim();
  if (!/^\d{4,}$/.test(memberCode)) {
    return NextResponse.json({ ok: false, error: "会員番号が不正です" }, { status: 400 });
  }
  const homeClub = memberCode.slice(0, 3);
  if (!isClubInScope(user, homeClub)) {
    return NextResponse.json({ ok: false, error: "この会員は担当クラブ外です" }, { status: 403 });
  }

  // 期間 (既定: 直近3ヶ月)
  const today = new Date();
  const defTo = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  const past = new Date(today); past.setUTCMonth(past.getUTCMonth() - 3);
  const defFrom = `${past.getUTCFullYear()}-${String(past.getUTCMonth() + 1).padStart(2, "0")}-${String(past.getUTCDate()).padStart(2, "0")}`;
  const from = sp.get("from") || defFrom;
  const to = sp.get("to") || defTo;
  const sdate = toYmdHis(from, 0);
  const edate = toYmdHis(to, 1); // 終了日は非包含なので翌日 → 当日を含める
  if (!sdate || !edate) {
    return NextResponse.json({ ok: false, error: "期間の形式が不正です (YYYY-MM-DD)" }, { status: 400 });
  }
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);

  const brand = cpssBrandForBusinessType(await getClubBusinessType(homeClub));

  // 次ページ有無判定のため 1件多く取得
  const cp = await cpssCall(brand, CPSS_ENV, "getHistoryTimeSpan", {
    aid: memberCode, sdate, edate, ptypes: "point",
    lines: PAGE_SIZE + 1, page, order: "desc",
  });
  if (!cp.ok) {
    return NextResponse.json(
      { ok: false, error: cp.cpssMsg || cp.error, code: cp.code, brand, from, to, page },
      { status: 502 }
    );
  }
  const raw: any[] = Array.isArray(cp.result?.history) ? cp.result.history : [];
  const hasNext = raw.length > PAGE_SIZE;
  const slice = raw.slice(0, PAGE_SIZE);

  // DDB(knowbase由来)を hid で引けるように
  const persisted = await fetchPersistedByMember(homeClub, memberCode);
  const byHid = new Map<string, PersistedTx>();
  for (const p of persisted) if (p.hid) byHid.set(String(p.hid), p);

  const rows = slice.map((h, i) => {
    const isAdd = h.direction === "ADD";
    const pt = Number(h.point) || 0;
    const cancelled = h.status === "CAN";
    const hid = h.hid != null ? String(h.hid) : "";
    const dtx = hid ? byHid.get(hid) : undefined;
    return {
      id: hid || `${h.effective || h.operate || i}-${i}`,
      occurredAt: h.effective ? new Date(Number(h.effective)).toISOString() : "",
      type: isAdd ? "earned" : "used",
      points: isAdd ? pt : -pt,
      status: h.status ?? null,
      cancelled,
      source: dtx?.reason || h.reason || h.facing || "—",
      shopid: h.shopid ?? null,
      hid,
      operatorName: dtx?.operatorName ?? null,
      note: cancelled ? (h.cancel_reason || null) : (dtx?.note ?? null),
      // knowbase由来の付与(有効・未取消)のみ取消可 → 既存 transactions API(sourceTransactionId)で取消
      cancellableTxId: (!cancelled && isAdd && dtx && !dtx.cancelledBy) ? dtx.transactionId : null,
    };
  });

  void writeAudit({
    userId: user.email || user.userId, userName: user.name,
    action: "points.historyView", resource: `member:${memberCode}`,
    clubCodes: [homeClub], targetCount: rows.length, result: "ok",
    detail: { brand, from, to, page },
    ip: clientIp(req),
  });

  return NextResponse.json({
    ok: true, memberCode, brand, from, to, page, pageSize: PAGE_SIZE, hasNext, rows,
  });
}
