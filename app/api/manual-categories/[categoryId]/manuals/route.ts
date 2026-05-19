// app/api/manual-categories/[categoryId]/manuals/route.ts
//
// シリーズに紐づくマニュアルの一括割当・並び替え用エンドポイント。
//
// PUT body: { manualIds: string[] }
//   並び順は配列の順序 (index 0, 1, 2, ...)
//   既にこのシリーズに属していて、manualIds に含まれないマニュアルは
//   categoryId / seriesOrder を null にクリアする (解除)。
//
// 認可: 管理者のみ。
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const MANUALS_TABLE = process.env.KB_MANUALS_TABLE || "yamauchi-Manuals";
const CATEGORIES_TABLE = process.env.KB_MANUAL_CATEGORIES_TABLE || "yamauchi-ManualCategories";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);

async function categoryExists(categoryId: string): Promise<boolean> {
  // ConsistentRead でないと、直前に PUT したばかりの項目が Scan/Query で見えないことがある
  const res = await ddbDoc.send(
    new GetCommand({
      TableName: CATEGORIES_TABLE,
      Key: { categoryId },
      ConsistentRead: true,
    })
  );
  return !!res.Item;
}

async function listManualIdsInCategory(categoryId: string): Promise<string[]> {
  const res = await ddbDoc.send(
    new ScanCommand({
      TableName: MANUALS_TABLE,
      FilterExpression: "categoryId = :cid",
      ExpressionAttributeValues: { ":cid": categoryId },
      ProjectionExpression: "manualId",
    })
  );
  return (res.Items || []).map((it: any) => String(it.manualId));
}

async function setManualSeries(manualId: string, categoryId: string | null, seriesOrder: number | null) {
  const now = new Date().toISOString();
  if (categoryId === null) {
    // 解除: REMOVE
    await ddbDoc.send(
      new UpdateCommand({
        TableName: MANUALS_TABLE,
        Key: { manualId },
        UpdateExpression: "REMOVE categoryId, seriesOrder SET updatedAt = :u",
        ExpressionAttributeValues: { ":u": now },
      })
    );
    return;
  }
  await ddbDoc.send(
    new UpdateCommand({
      TableName: MANUALS_TABLE,
      Key: { manualId },
      UpdateExpression: "SET categoryId = :cid, seriesOrder = :so, updatedAt = :u",
      ExpressionAttributeValues: {
        ":cid": categoryId,
        ":so": seriesOrder,
        ":u": now,
      },
    })
  );
}

/** GET: このシリーズに紐づくマニュアル ID 一覧 (seriesOrder 昇順)。簡易ヘルスチェック兼用 */
export async function GET(_req: Request, ctx: { params: Promise<{ categoryId: string }> }) {
  try {
    const { categoryId } = await ctx.params;
    if (!categoryId) {
      return Response.json({ ok: false, error: "categoryId is required" }, { status: 400 });
    }
    const res = await ddbDoc.send(
      new ScanCommand({
        TableName: MANUALS_TABLE,
        FilterExpression: "categoryId = :cid",
        ExpressionAttributeValues: { ":cid": categoryId },
        ProjectionExpression: "manualId, seriesOrder",
      })
    );
    const rows = (res.Items || []).map((it: any) => ({
      manualId: String(it.manualId),
      seriesOrder: typeof it.seriesOrder === "number" ? it.seriesOrder : it.seriesOrder != null ? Number(it.seriesOrder) : null,
    }));
    rows.sort((a, b) => (a.seriesOrder ?? 9999) - (b.seriesOrder ?? 9999));
    return Response.json({ ok: true, manualIds: rows.map((r) => r.manualId) });
  } catch (e: any) {
    console.error("GET /api/manual-categories/[id]/manuals error", e);
    return Response.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}

/** PUT: シリーズに割り当てるマニュアル ID 配列を受け取って一括更新 */
export async function PUT(req: Request, ctx: { params: Promise<{ categoryId: string }> }) {
  try {
    if (!(await isAdminRequest(req))) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { categoryId } = await ctx.params;
    if (!categoryId) {
      return Response.json({ ok: false, error: "categoryId is required" }, { status: 400 });
    }
    if (!(await categoryExists(categoryId))) {
      return Response.json({ ok: false, error: "Series not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const incoming: unknown = body?.manualIds;
    if (!Array.isArray(incoming)) {
      return Response.json({ ok: false, error: "manualIds (array) is required" }, { status: 400 });
    }
    const manualIds = (incoming as unknown[])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((s): s is string => !!s);

    // 重複チェック
    const seen = new Set<string>();
    for (const id of manualIds) {
      if (seen.has(id)) {
        return Response.json({ ok: false, error: `Duplicate manualId: ${id}` }, { status: 400 });
      }
      seen.add(id);
    }

    // 現在このシリーズに属しているマニュアル
    const currentIds = new Set(await listManualIdsInCategory(categoryId));
    const newIdSet = new Set(manualIds);

    // 解除対象 = 現在属しているが新リストに無いもの
    const toUnset: string[] = [];
    for (const id of currentIds) {
      if (!newIdSet.has(id)) toUnset.push(id);
    }

    // 並列に更新 (本数が多いと API throttle の可能性があるので 25 ずつ分割)
    const CHUNK = 25;
    const errors: { manualId: string; message: string }[] = [];

    const runChunked = async <T,>(items: T[], handler: (it: T) => Promise<void>) => {
      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        const results = await Promise.allSettled(chunk.map(handler));
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            const item: any = chunk[idx];
            errors.push({
              manualId: String(item),
              message: r.reason?.message || String(r.reason),
            });
          }
        });
      }
    };

    await runChunked(manualIds, async (manualId) => {
      const idx = manualIds.indexOf(manualId);
      await setManualSeries(manualId, categoryId, idx);
    });
    await runChunked(toUnset, async (manualId) => {
      await setManualSeries(manualId, null, null);
    });

    if (errors.length > 0) {
      return Response.json(
        { ok: false, error: "Some manuals failed to update", errors },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      categoryId,
      assignedCount: manualIds.length,
      unassignedCount: toUnset.length,
    });
  } catch (e: any) {
    console.error("PUT /api/manual-categories/[id]/manuals error", e);
    return Response.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}
