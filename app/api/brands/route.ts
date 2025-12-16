// app/api/brands/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";

const region = "us-east-1";              // ← Dynamo が us-east-1 なので固定
const TABLE_BRANDS = "yamauchi-Brands";

const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export async function GET() {
  try {
    console.log("[/api/brands] start scan", { region, TABLE_BRANDS });

    const cmd = new ScanCommand({
      TableName: TABLE_BRANDS,
    });

    const data = await docClient.send(cmd);
    const items = (data.Items || []) as any[];

    items.sort((a, b) => {
      const sa = Number(a.sortOrder ?? 9999);
      const sb = Number(b.sortOrder ?? 9999);
      if (sa !== sb) return sa - sb;
      return String(a.brandId || "").localeCompare(
        String(b.brandId || "")
      );
    });

    console.log("[/api/brands] items count:", items.length);

    return NextResponse.json({ brands: items });
  } catch (err: any) {
    console.error("[/api/brands] Dynamo error:", err);

    // ★ Dynamo失敗時のフォールバック（UIは動かしたい）
    const fallback = [
      { brandId: "ALL", name: "全社共通", sortOrder: 0, isActive: true },
      { brandId: "FIT365", name: "FIT365", sortOrder: 1, isActive: true },
      { brandId: "JOYFIT", name: "JOYFIT", sortOrder: 2, isActive: true },
      { brandId: "JOYFIT24", name: "JOYFIT24", sortOrder: 3, isActive: true },
    ];

    return NextResponse.json(
      {
        brands: fallback,
        error: "DynamoDB scan failed. Fallback brands returned.",
        detail: String(err?.message || err),
        name: err?.name ?? undefined,
      },
      { status: 200 }
    );
  }
}

