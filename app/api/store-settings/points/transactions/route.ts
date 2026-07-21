// app/api/store-settings/points/transactions/route.ts
//
// ポイント付与 / 取り消しを 1 リクエストで処理。
//   POST {action:"grant",   clubCode, memberCode, points, reason, note?}
//   POST {action:"cancel",  clubCode, memberCode, sourceTransactionId, note?}  // knowbie付与の取消
//   POST {action:"cancelExternal", clubCode, memberCode, hid, occurredAt, note} // 外部/利用(SUB)等の取消
//
// 取り消しは元 earned トランザクションへの逆方向の adjusted トランザクションを作る。
// 元 tx には cancelledBy / cancelledAt を書き戻し、UI で「取消済」表示できるようにする。
//
// cancelExternal は knowbie台帳に無いCPSS由来(タウン/POSの利用=SUB等)を hid 指定で取り消す。
// 安全ガード: ①担当クラブスコープ ②取消理由(note)必須 ③期間ガード(既定92日) ④CPSSで
// hid の実在・会員一致・未取消(AVA)を検証してから取消 ⑤監査ログ必須。

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { getClubBusinessType, cpssBrandForBusinessType } from "@/lib/clubScope";
import { cpssCall } from "@/lib/cpssProxy";
import { writeAudit, clientIp } from "@/lib/auditLog";
import { POINT_REASONS, type PointReason, type PointTransaction } from "@/types/pointTransaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMO_POINT_TRANSACTIONS_TABLE || "yamauchi-PointTransactions";
const CPSS_ENV = (process.env.CPSS_ENV as "stg" | "prod") || "stg";
// 外部(CPSS由来)取消の取消可能期間(日)。これより古い取引は画面から取り消せない。
const EXTERNAL_CANCEL_MAX_AGE_DAYS = Number(process.env.POINTS_EXTERNAL_CANCEL_MAX_AGE_DAYS || 92);

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

function nowIso(): string {
  return new Date().toISOString();
}

function newTransactionId(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const uuid = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `PT-${yyyy}${mm}${dd}-${uuid}`;
}

// "YYYYMMDDHHMMSS" (CPSS期間指定用)。Date → 現地TZは使わずUTCで生成し、CPSS側の照会窓に使う。
function toCpssStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// CPSS で hid の取引を検証する。会員一致・実在・状態(AVA/CAN)を返す。
// occurredAt 前後に窓を取り、複数ページを走査して hid を探す。見つからなければ null。
async function verifyCpssHid(
  brand: "JOYFIT" | "FIT365",
  memberCode: string,
  hid: string,
  occurredAt: Date | null
): Promise<{ found: boolean; status?: string; point?: number; direction?: string; effectiveMs?: number }> {
  // 窓: occurredAt ±2日 (無ければ直近92日)
  const now = Date.now();
  const center = occurredAt ? occurredAt.getTime() : now;
  const sdate = toCpssStamp(new Date(occurredAt ? center - 2 * 86400000 : now - EXTERNAL_CANCEL_MAX_AGE_DAYS * 86400000));
  const edate = toCpssStamp(new Date(occurredAt ? center + 2 * 86400000 : now + 86400000));
  for (let page = 1; page <= 6; page++) {
    const cp = await cpssCall(brand, CPSS_ENV, "getHistoryTimeSpan", {
      aid: memberCode, sdate, edate, ptypes: "point", lines: 100, page, order: "desc",
    });
    if (!cp.ok) return { found: false };
    const hist: any[] = Array.isArray(cp.result?.history) ? cp.result.history : [];
    const row = hist.find((h) => String(h.hid ?? "") === hid);
    if (row) {
      return {
        found: true,
        status: row.status ?? undefined,
        point: Number(row.point) || 0,
        direction: row.direction ?? undefined,
        effectiveMs: row.effective ? Number(row.effective) : undefined,
      };
    }
    if (hist.length < 100) break; // これ以上ページ無し
  }
  return { found: false };
}

// 一覧取得 (会員別) — GET ?clubCode=&memberCode=
export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const clubCode = sp.get("clubCode") || "";
  const memberCode = sp.get("memberCode") || "";
  if (!clubCode || !memberCode) {
    return NextResponse.json({ ok: false, error: "clubCode and memberCode required" }, { status: 400 });
  }
  if (!isClubInScope(user, clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    // GSI が無い前提なので Scan + filter で取得 (小規模を想定)
    const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
    const items = ((res.Items ?? []) as PointTransaction[]).filter(
      (t) => t.clubCode === clubCode && t.memberCode === memberCode
    );
    items.sort((a, b) => (b.occurredAt || "").localeCompare(a.occurredAt || ""));
    return NextResponse.json({ ok: true, transactions: items });
  } catch (e: any) {
    console.error("[points transactions] GET error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: {
    action?: "grant" | "cancel" | "cancelExternal";
    clubCode?: string;
    memberCode?: string;
    points?: number;
    reason?: PointReason;
    note?: string;
    sourceTransactionId?: string;
    hid?: string;          // cancelExternal: 取り消す CPSS 取引の hid
    occurredAt?: string;   // cancelExternal: 取引日時(ISO)。期間ガード + 照会窓に使用
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.clubCode || !body.memberCode) {
    return NextResponse.json({ ok: false, error: "clubCode and memberCode required" }, { status: 400 });
  }
  if (!/^\d{4,}$/.test(body.memberCode)) {
    return NextResponse.json({ ok: false, error: "会員番号が不正です" }, { status: 400 });
  }
  // 会員の所属クラブ(会員番号先頭3桁)を正とし、shopid/ブランド/スコープ/台帳キーを統一する。
  // 選択店舗(body.clubCode)と所属クラブの両方が担当スコープ内であること。
  const club = body.memberCode.slice(0, 3);
  if (!isClubInScope(user, club) || !isClubInScope(user, body.clubCode)) {
    return NextResponse.json({ ok: false, error: "この会員は担当クラブ外です" }, { status: 403 });
  }
  // 所属クラブのブランドで JOYFIT/FIT365 の API を振り分け
  const brand = cpssBrandForBusinessType(await getClubBusinessType(club));

  const ts = nowIso();
  const action = body.action;

  try {
    if (action === "grant") {
      const points = Number(body.points);
      if (!Number.isFinite(points) || points <= 0) {
        return NextResponse.json({ ok: false, error: "points must be a positive number" }, { status: 400 });
      }
      if (!body.reason || !POINT_REASONS.includes(body.reason)) {
        return NextResponse.json({ ok: false, error: "invalid reason" }, { status: 400 });
      }
      const transactionId = newTransactionId();

      // CPSS へ手動付与 (shopid=会員所属クラブ, reqid=transactionId で冪等)。CPSS が真実。
      const cp = await cpssCall(brand, CPSS_ENV, "givePoint", {
        aid: body.memberCode,
        shopid: club,
        point: points,
        reqid: transactionId,
        scode: "MANUAL",
        svalue: body.reason,
      });
      if (!cp.ok) {
        void writeAudit({
          userId: user.email || user.userId, userName: user.name,
          action: "points.grant", resource: `member:${body.memberCode}`,
          clubCodes: [club], targetCount: points, result: "error",
          detail: { brand, points, reason: body.reason, code: cp.code, error: cp.cpssMsg || cp.error },
          ip: clientIp(req),
        });
        return NextResponse.json(
          { ok: false, error: `ポイント付与に失敗しました: ${cp.cpssMsg || cp.error}`, code: cp.code },
          { status: 502 }
        );
      }

      const tx: PointTransaction = {
        transactionId,
        clubCode: club,
        memberCode: body.memberCode,
        type: "earned",
        points,
        reason: body.reason,
        note: body.note,
        occurredAt: ts,
        operatorId: user.userId,
        operatorName: user.name,
        hid: cp.result?.hid,
        cpssBalanceAfter: typeof cp.result?.balance === "number" ? cp.result.balance : undefined,
      };
      // CPSS は成功済みなので DDB は監査用台帳。失敗しても付与自体は成立。
      try {
        await ddb.send(
          new PutCommand({
            TableName: TABLE,
            Item: tx,
            ConditionExpression: "attribute_not_exists(transactionId)",
          })
        );
      } catch (e) {
        console.error("[points transactions] grant CPSS ok but DDB write failed", e);
      }
      void writeAudit({
        userId: user.email || user.userId, userName: user.name,
        action: "points.grant", resource: `member:${body.memberCode}`,
        clubCodes: [club], targetCount: points, result: "ok",
        detail: { brand, points, reason: body.reason, note: body.note, hid: tx.hid, balanceAfter: tx.cpssBalanceAfter, transactionId },
        ip: clientIp(req),
      });
      return NextResponse.json({ ok: true, transaction: tx });
    }

    if (action === "cancel") {
      if (!body.sourceTransactionId) {
        return NextResponse.json({ ok: false, error: "sourceTransactionId required" }, { status: 400 });
      }
      // 元トランザクションを取得
      const orig = await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { transactionId: body.sourceTransactionId } })
      );
      const source = orig.Item as PointTransaction | undefined;
      if (!source) {
        return NextResponse.json({ ok: false, error: "source transaction not found" }, { status: 404 });
      }
      if (source.memberCode !== body.memberCode || (source.clubCode !== club && source.clubCode !== body.clubCode)) {
        return NextResponse.json({ ok: false, error: "source mismatch" }, { status: 400 });
      }
      if (source.type !== "earned") {
        return NextResponse.json({ ok: false, error: "earned 以外は取り消せません" }, { status: 400 });
      }
      if (source.cancelledBy) {
        return NextResponse.json({ ok: false, error: "既に取り消されています" }, { status: 400 });
      }

      // CPSS のポイント移動を取消 (hid 指定)。実データ付与には hid がある。
      let cancelBalance: number | undefined;
      if (source.hid) {
        const cp = await cpssCall(brand, CPSS_ENV, "cancelPoint", {
          hid: source.hid,
          shopid: club,
          reason: body.note || "店舗操作による取消",
          reqid: `${source.transactionId}-C`,
        });
        if (!cp.ok) {
          void writeAudit({
            userId: user.email || user.userId, userName: user.name,
            action: "points.cancel", resource: `member:${body.memberCode}`,
            clubCodes: [club], targetCount: source.points, result: "error",
            detail: { brand, sourceTransactionId: source.transactionId, hid: source.hid, points: source.points, code: cp.code, error: cp.cpssMsg || cp.error },
            ip: clientIp(req),
          });
          return NextResponse.json(
            { ok: false, error: `ポイント取消に失敗しました: ${cp.cpssMsg || cp.error}`, code: cp.code },
            { status: 502 }
          );
        }
        // cancel_point は {from,to:{afterbalance}} を返す。会員側(to)の処理後残高を採用。
        const to = cp.result?.to;
        if (typeof to?.afterbalance === "number") cancelBalance = to.afterbalance;
        else if (typeof cp.result?.balance === "number") cancelBalance = cp.result.balance;
      }

      // 逆方向の adjusted トランザクション
      const tx: PointTransaction = {
        transactionId: newTransactionId(),
        clubCode: club,
        memberCode: body.memberCode,
        type: "adjusted",
        points: -source.points,
        reason: source.reason,
        note: body.note ? `取り消し: ${body.note}` : `取り消し (元 ${source.transactionId})`,
        occurredAt: ts,
        operatorId: user.userId,
        operatorName: user.name,
        cancelledOf: source.transactionId,
        cpssBalanceAfter: cancelBalance,
      };
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: tx,
          ConditionExpression: "attribute_not_exists(transactionId)",
        })
      );

      // 元 tx に cancelledBy / cancelledAt を書き戻す
      const updated: PointTransaction = {
        ...source,
        cancelledBy: tx.transactionId,
        cancelledAt: ts,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: updated }));

      void writeAudit({
        userId: user.email || user.userId, userName: user.name,
        action: "points.cancel", resource: `member:${body.memberCode}`,
        clubCodes: [club], targetCount: source.points, result: "ok",
        detail: { brand, sourceTransactionId: source.transactionId, hid: source.hid, points: source.points, balanceAfter: cancelBalance, note: body.note },
        ip: clientIp(req),
      });
      return NextResponse.json({ ok: true, transaction: tx, source: updated });
    }

    if (action === "cancelExternal") {
      const hid = (body.hid || "").trim();
      if (!hid) return NextResponse.json({ ok: false, error: "hid required" }, { status: 400 });
      const note = (body.note || "").trim();
      if (!note) return NextResponse.json({ ok: false, error: "取消理由は必須です" }, { status: 400 });

      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : null;
      if (occurredAt && isNaN(occurredAt.getTime())) {
        return NextResponse.json({ ok: false, error: "occurredAt が不正です" }, { status: 400 });
      }
      // 期間ガード (クライアント申告値での早期弾き)
      if (occurredAt && (Date.now() - occurredAt.getTime()) / 86400000 > EXTERNAL_CANCEL_MAX_AGE_DAYS) {
        return NextResponse.json({ ok: false, error: `取消可能期間(${EXTERNAL_CANCEL_MAX_AGE_DAYS}日)を過ぎた取引は取り消せません` }, { status: 400 });
      }

      // CPSS で hid を検証 (会員一致・実在・未取消)。クライアント値は信用しない。
      const v = await verifyCpssHid(brand, body.memberCode, hid, occurredAt);
      if (!v.found) {
        return NextResponse.json({ ok: false, error: "対象の取引がCPSSで見つかりません（会員・期間・hidをご確認ください）" }, { status: 404 });
      }
      if (v.status === "CAN") {
        return NextResponse.json({ ok: false, error: "この取引は既に取り消されています" }, { status: 400 });
      }
      // effective 側でも期間ガードを再確認 (サーバ側の真値で担保)
      if (v.effectiveMs && (Date.now() - v.effectiveMs) / 86400000 > EXTERNAL_CANCEL_MAX_AGE_DAYS) {
        return NextResponse.json({ ok: false, error: `取消可能期間(${EXTERNAL_CANCEL_MAX_AGE_DAYS}日)を過ぎています` }, { status: 400 });
      }

      const cancelPoints = v.point ?? 0;
      const isSub = v.direction === "SUB"; // SUB=利用(取消で会員に戻す) / ADD=付与(取消で会員から減る)

      // CPSS 取消 (hid指定, reqid=hid由来で冪等=二重取消防止)
      const cp = await cpssCall(brand, CPSS_ENV, "cancelPoint", {
        hid,
        shopid: club,
        reason: note,
        reqid: `ext-${hid}`,
      });
      if (!cp.ok) {
        void writeAudit({
          userId: user.email || user.userId, userName: user.name,
          action: "points.cancel", resource: `member:${body.memberCode}`,
          clubCodes: [club], targetCount: cancelPoints, result: "error",
          detail: { brand, external: true, hid, direction: v.direction, points: cancelPoints, code: cp.code, error: cp.cpssMsg || cp.error, note },
          ip: clientIp(req),
        });
        return NextResponse.json(
          { ok: false, error: `ポイント取消に失敗しました: ${cp.cpssMsg || cp.error}`, code: cp.code },
          { status: 502 }
        );
      }
      const to = cp.result?.to;
      const balanceAfter =
        typeof to?.afterbalance === "number" ? to.afterbalance
        : typeof cp.result?.balance === "number" ? cp.result.balance
        : undefined;

      // 台帳(DDB)へ adjusted として記録 (hidは付けない=CPSS履歴マージ衝突回避)。best-effort。
      const ledgerTx: PointTransaction = {
        transactionId: newTransactionId(),
        clubCode: club,
        memberCode: body.memberCode,
        type: "adjusted",
        points: isSub ? cancelPoints : -cancelPoints,
        reason: "その他",
        note: `外部取引の取消 (hid:${hid}) 理由:${note}`,
        occurredAt: ts,
        operatorId: user.userId,
        operatorName: user.name,
        cpssBalanceAfter: balanceAfter,
      };
      try {
        await ddb.send(new PutCommand({ TableName: TABLE, Item: ledgerTx, ConditionExpression: "attribute_not_exists(transactionId)" }));
      } catch (e) {
        console.error("[points transactions] cancelExternal CPSS ok but ledger write failed", e);
      }

      void writeAudit({
        userId: user.email || user.userId, userName: user.name,
        action: "points.cancel", resource: `member:${body.memberCode}`,
        clubCodes: [club], targetCount: cancelPoints, result: "ok",
        detail: { brand, external: true, hid, direction: v.direction, points: cancelPoints, balanceAfter, occurredAt: body.occurredAt, note },
        ip: clientIp(req),
      });
      return NextResponse.json({ ok: true, balanceAfter, points: cancelPoints, direction: v.direction, transaction: ledgerTx });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[points transactions] POST error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
