// app/api/store-settings/dm/route.ts

import { NextResponse } from "next/server";
import type { DmNotification } from "@/types/dmNotification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ★ MOCK DATA
let MOCK_DMS: DmNotification[] = [
  {
    id: "dm_001",
    subject: "【重要】会費改定のお知らせ",
    body: "平素よりご利用いただきありがとうございます。\nこの度、昨今の光熱費高騰に伴い...",
    imageUrl: "",
    targetType: "ALL",
    status: "SENT",
    scheduledAt: "2023-11-01T10:00:00.000Z",
    createdAt: "2023-10-25T15:30:00.000Z",
    // ✅ 統計データ
    stats: {
      targetCount: 1200,
      deliveredCount: 1180, // 98%到達
      openCount: 850,       // 70%開封
      errorCount: 20,       // 2%エラー
    }
  },
  {
    id: "dm_002",
    subject: "お誕生日おめでとうございます！",
    body: "今月お誕生日のお客様へ、ささやかなプレゼントをご用意いたしました。",
    imageUrl: "https://placehold.co/600x200/fbbf24/fff?text=Happy+Birthday",
    targetType: "CONDITION",
    condition: {
      ageFrom: "20",
      ageTo: "60",
    },
    status: "SENT",
    scheduledAt: "2024-02-01T09:00:00.000Z",
    createdAt: "2024-01-28T11:00:00.000Z",
    // ✅ 統計データ
    stats: {
      targetCount: 45,
      deliveredCount: 45,
      openCount: 20,
      errorCount: 0,
    }
  },
  {
    id: "dm_003",
    subject: "春の入会キャンペーンのご案内",
    body: "新生活応援！今なら入会金0円...",
    targetType: "ALL",
    status: "SCHEDULED", // 予約中なので統計なし
    scheduledAt: "2025-04-01T10:00:00.000Z",
    createdAt: "2024-03-15T12:00:00.000Z",
  }
];

export async function GET(req: Request) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const sorted = [...MOCK_DMS].sort(
    (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
  );
  return NextResponse.json({ notifications: sorted });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 新規作成時は stats は undefined (送信処理後にバックグラウンドで集計される想定)
    const newDm: DmNotification = {
      id: `dm_${Date.now()}`,
      subject: body.subject,
      body: body.body,
      imageUrl: body.imageUrl,
      targetType: body.targetType,
      condition: body.condition,
      status: body.isImmediate ? "SENT" : "SCHEDULED",
      scheduledAt: body.isImmediate ? new Date().toISOString() : body.scheduledAt,
      createdAt: new Date().toISOString(),
      // 即時送信の場合のみ、仮の統計データを入れる（デモ用）
      stats: body.isImmediate ? {
        targetCount: 150,
        deliveredCount: 150,
        openCount: 0, // 送った直後は0
        errorCount: 0
      } : undefined,
    };

    MOCK_DMS = [newDm, ...MOCK_DMS];

    return NextResponse.json({ ok: true, notification: newDm });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}