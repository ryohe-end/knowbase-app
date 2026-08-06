// app/api/design/requests/route.ts
// 設計業務① 変更依頼ワークフローのAPI。
//   GET  ?status=&brand=            … 一覧(Scan+filter、createdAt降順)
//   POST {action:"create", ...}     … 新規変更依頼(status=依頼)
//   POST {action:"transition", requestId, to, comment?, applyFrom?} … ステータス遷移(履歴追記)
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser } from "@/lib/refundAuth";
import {
  type DesignChangeRequest, type DesignStatus, type DesignEvent,
  DESIGN_SCALES, DESIGN_CATEGORIES, DESIGN_BRANDS, DESIGN_STATUSES,
} from "@/types/designChange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = process.env.DESIGN_REQUESTS_TABLE || "yamauchi-DesignChangeRequests";
const REGION = process.env.DYNAMO_REGION || process.env.AWS_REGION || "us-east-1";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });

const nowIso = () => new Date().toISOString();
function newRequestId(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DCR-${ymd}-${rnd}`;
}

// 許可する遷移(状態機械)。差戻しはいつでも可、差戻し→依頼で再申請。
const TRANSITIONS: Record<DesignStatus, DesignStatus[]> = {
  "依頼": ["検討中", "差戻し"],
  "検討中": ["承認待ち", "差戻し"],
  "承認待ち": ["承認済", "差戻し"],
  "承認済": ["検証中", "差戻し"],
  "検証中": ["完了", "差戻し"],
  "差戻し": ["依頼", "検討中"],
  "完了": [],
};
const ACTION_OF: Partial<Record<DesignStatus, DesignEvent["action"]>> = {
  "検討中": "review", "承認待ち": "submit", "承認済": "approve", "差戻し": "reject", "検証中": "verify", "完了": "complete", "依頼": "submit",
};

export async function GET(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id") || "";
  if (id) {
    const got = await ddb.send(new GetCommand({ TableName: TABLE, Key: { requestId: id } }));
    if (!got.Item) return NextResponse.json({ ok: false, error: "対象が見つかりません" }, { status: 404 });
    return NextResponse.json({ ok: true, request: got.Item });
  }
  const status = sp.get("status") || "";
  const brand = sp.get("brand") || "";

  const items: DesignChangeRequest[] = [];
  let ek: Record<string, any> | undefined;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: ek }));
    for (const it of (r.Items || []) as DesignChangeRequest[]) items.push(it);
    ek = r.LastEvaluatedKey;
  } while (ek);

  let filtered = items;
  if (status) filtered = filtered.filter((x) => x.status === status);
  if (brand) filtered = filtered.filter((x) => x.brand === brand);
  filtered.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return NextResponse.json({ ok: true, requests: filtered });
}

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const ts = nowIso();

  // ── 新規変更依頼 ──────────────────────────────────────────────
  if (body.action === "create") {
    const title = String(body.title || "").trim();
    const reason = String(body.reason || "").trim();
    const detail = String(body.detail || "").trim();
    if (!title || !reason || !detail) {
      return NextResponse.json({ ok: false, error: "対象・変更理由・変更内容は必須です" }, { status: 400 });
    }
    const category = DESIGN_CATEGORIES.includes(body.category) ? body.category : "仕様書";
    const brand = DESIGN_BRANDS.includes(body.brand) ? body.brand : "共通";
    const scale = DESIGN_SCALES.includes(body.scale) ? body.scale : "軽微";
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.filter((a: any) => a && a.url).map((a: any) => ({ name: String(a.name || a.url).slice(0, 200), url: String(a.url).slice(0, 1000) })).slice(0, 20)
      : undefined;

    const requestId = newRequestId();
    const item: DesignChangeRequest = {
      requestId, title, category, brand, scale, reason, detail, attachments,
      requestedById: user.userId, requestedByName: user.name, requestedByDept: user.dept,
      status: "依頼",
      events: [{ at: ts, byUserId: user.userId, byUserName: user.name, action: "create", toStatus: "依頼", comment: body.note ? String(body.note).slice(0, 500) : undefined }],
      createdAt: ts, updatedAt: ts,
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(requestId)" }));
    return NextResponse.json({ ok: true, request: item });
  }

  // ── ステータス遷移 ────────────────────────────────────────────
  if (body.action === "transition") {
    const requestId = String(body.requestId || "").trim();
    const to = body.to as DesignStatus;
    if (!requestId || !DESIGN_STATUSES.includes(to)) {
      return NextResponse.json({ ok: false, error: "requestId / to が不正です" }, { status: 400 });
    }
    const got = await ddb.send(new GetCommand({ TableName: TABLE, Key: { requestId } }));
    const cur = got.Item as DesignChangeRequest | undefined;
    if (!cur) return NextResponse.json({ ok: false, error: "対象が見つかりません" }, { status: 404 });
    const allowed = TRANSITIONS[cur.status] || [];
    if (!allowed.includes(to)) {
      return NextResponse.json({ ok: false, error: `「${cur.status}」から「${to}」へは変更できません` }, { status: 400 });
    }
    const ev: DesignEvent = {
      at: ts, byUserId: user.userId, byUserName: user.name,
      action: ACTION_OF[to] || "comment", fromStatus: cur.status, toStatus: to,
      comment: body.comment ? String(body.comment).slice(0, 500) : undefined,
    };
    const updated: DesignChangeRequest = {
      ...cur,
      status: to,
      applyFrom: to === "承認済" && body.applyFrom ? String(body.applyFrom) : cur.applyFrom,
      events: [...(cur.events || []), ev],
      updatedAt: ts,
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: updated }));
    return NextResponse.json({ ok: true, request: updated });
  }

  // ── 壁打ちチャット投稿 ────────────────────────────────────────
  if (body.action === "message") {
    const requestId = String(body.requestId || "").trim();
    const text = String(body.text || "").trim();
    if (!requestId || !text) return NextResponse.json({ ok: false, error: "requestId / text が必要です" }, { status: 400 });
    const got = await ddb.send(new GetCommand({ TableName: TABLE, Key: { requestId } }));
    const cur = got.Item as DesignChangeRequest | undefined;
    if (!cur) return NextResponse.json({ ok: false, error: "対象が見つかりません" }, { status: 404 });
    const msg = {
      id: `M-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: ts, byUserId: user.userId, byUserName: user.name, byDept: user.dept, text: text.slice(0, 2000),
    };
    const updated: DesignChangeRequest = { ...cur, messages: [...(cur.messages || []), msg], updatedAt: ts };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: updated }));
    return NextResponse.json({ ok: true, request: updated, message: msg });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
