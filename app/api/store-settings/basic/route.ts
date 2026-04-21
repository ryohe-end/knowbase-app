// app/api/store-settings/basic/route.ts

import { NextResponse } from "next/server";
import type { StoreAppConfig } from "@/types/storeAppConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ★ MOCK DATA
const MOCK_CONFIG: StoreAppConfig = {
  // [店舗情報]
  clubCode: "MOCK_STORE_001",
  clubName: "FIT365 テスト店舗",
  brand: "FIT365",
  businessType: "FIT365",
  
  inquiryEmail: "support@example.com",
  storeEmail: "test-store@example.com",
  
  latitude: 35.6895,
  longitude: 139.6917,
  prefecture: "東京都",
  address: "新宿区西新宿2-8-1",
  
  externalLink: "https://fit365.jp/test",
  personalTrainingUrl: "https://example.com/pt-reserve",

  // [店舗設定]
  isPointSupported: true,
  canUseDormantMember: false,
  showAppEnableButton: true,
  enableReferral: true,
  showMainContractChange: false,
  showKioskContractChange: false,
  showOptionChange: true,
  showFamilyAdd: true,
  showUnpaidPayment: true,
  showWithdrawal: false,

  // [解錠機器] (✅ 新規追加)
  unlockDevices: [
    { 
      id: "dev_001", 
      majorCode: "1001", 
      minorCode: "0001", 
      type: "入口", 
      isEntrance: true, 
      displayName: "メインエントランス" 
    }
  ],

  // [マシンリスト]
  machines: [
    { name: "Versa Chest Press", imageUrl: "https://placehold.co/300x200/222/fff?text=MATRIX+Chest+Press" },
  ],

  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

export async function GET(req: Request) {
  console.log("[API] GET /store-settings/basic - Returning MOCK data");
  await new Promise((resolve) => setTimeout(resolve, 500));
  return NextResponse.json({ config: MOCK_CONFIG });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const updatedConfig = {
      ...MOCK_CONFIG,
      ...body,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ ok: true, config: updatedConfig });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}