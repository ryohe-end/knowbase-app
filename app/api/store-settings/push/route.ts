// app/api/store-settings/push/route.ts

import { NextResponse } from "next/server";
import type { PushNotification, PushOpenTimeBucket } from "@/types/pushNotification";

// 配信後の時間別開封数のダミー生成 (送信直後にスパイクするカーブ)
function generateOpenTimeline(openCount: number): PushOpenTimeBucket[] {
  if (openCount <= 0) return [];
  // 24 時間分: 0h で最大、徐々に減衰
  const buckets: PushOpenTimeBucket[] = [];
  const weights = Array.from({ length: 24 }, (_, h) => Math.exp(-h / 4));
  const sum = weights.reduce((s, w) => s + w, 0);
  let remaining = openCount;
  for (let h = 0; h < 24; h++) {
    const v = h === 23 ? remaining : Math.round((weights[h] / sum) * openCount);
    buckets.push({ hourOffset: h, opens: Math.max(0, Math.min(v, remaining)) });
    remaining -= v;
  }
  return buckets;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ★ MOCK DATA (画像は push 仕様の都合上扱わない)
let MOCK_NOTIFICATIONS: PushNotification[] = [
  {
    id: "push_001",
    title: "【重要】年末年始の営業について",
    body: "年末年始の営業時間は以下の通り変更となります...",
    targetType: "ALL",
    status: "SENT",
    scheduledAt: "2023-12-25T10:00:00.000Z",
    createdAt: "2023-12-20T15:30:00.000Z",
    stats: { targetCount: 1250, sentCount: 1245, openCount: 520, errorCount: 5 },
    openTimeline: generateOpenTimeline(520),
  },
  {
    id: "push_002",
    title: "女性会員様限定！ヨガイベント開催",
    body: "来月開催の特別ヨガイベントのご案内です。先着順ですのでお早めに！",
    targetType: "CONDITION",
    condition: { gender: ["female"], ageFrom: "20", ageTo: "40" },
    status: "SENT",
    scheduledAt: "2024-01-15T09:00:00.000Z",
    createdAt: "2024-01-10T11:00:00.000Z",
    stats: { targetCount: 340, sentCount: 338, openCount: 180, errorCount: 2 },
    openTimeline: generateOpenTimeline(180),
  },
  {
    id: "push_003",
    title: "春の入会キャンペーン実施中",
    body: "今なら入会金0円！お友達紹介でさらに特典も。",
    targetType: "ALL",
    status: "SCHEDULED",
    scheduledAt: "2026-04-01T10:00:00.000Z",
    createdAt: "2024-03-20T14:00:00.000Z",
  },
];

export async function GET(req: Request) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id) {
    const item = MOCK_NOTIFICATIONS.find((n) => n.id === id) ?? null;
    return NextResponse.json({ notification: item });
  }
  const sorted = [...MOCK_NOTIFICATIONS].sort(
    (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
  );
  return NextResponse.json({ notifications: sorted });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const targetCount = Number(body.targetCount) || 0;
    const newPush: PushNotification = {
      id: `push_${Date.now()}`,
      title: body.title,
      body: body.body,
      targetType: body.targetType,
      condition: body.condition,
      status: body.isImmediate ? "SENT" : "SCHEDULED",
      scheduledAt: body.isImmediate ? new Date().toISOString() : body.scheduledAt,
      createdAt: new Date().toISOString(),
      stats: body.isImmediate
        ? { targetCount, sentCount: targetCount, openCount: 0, errorCount: 0 }
        : undefined,
    };

    MOCK_NOTIFICATIONS = [newPush, ...MOCK_NOTIFICATIONS];
    return NextResponse.json({ ok: true, notification: newPush });
  } catch (e: any) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}