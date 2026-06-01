// app/api/clubs/route.ts
// admin 用クラブ一覧取得 API。/admin/users のクラブ多選択 UI から呼ばれる想定。
// DynamoDB knowbie-clubs (us-east-1) を Scan して返す。
// MotionBoard と毎日同期される (knowbie-clubs-sync Lambda)。

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLUBS_TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const CLUBS_REGION = process.env.CLUBS_TABLE_REGION || "us-east-1";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: CLUBS_REGION }));

type ClubRow = {
  clubCode: string;
  clubName?: string | null;
  clubNameShort?: string | null;
  companyGroup?: string | null;
  companyName?: string | null;
  businessType?: string | null;
  openDate?: string | null;
};

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    // 462件想定。Scan で全件取得 (将来 1MB 超えたらページング対応)。
    const items: ClubRow[] = [];
    let LastEvaluatedKey: Record<string, any> | undefined;
    do {
      const res = await ddb.send(
        new ScanCommand({
          TableName: CLUBS_TABLE,
          ProjectionExpression:
            "clubCode, clubName, clubNameShort, companyGroup, companyName, businessType, openDate",
          ExclusiveStartKey: LastEvaluatedKey,
        })
      );
      items.push(...((res.Items as ClubRow[]) ?? []));
      LastEvaluatedKey = res.LastEvaluatedKey;
    } while (LastEvaluatedKey);

    // clubCode 数値順で並べる (e.g. "101" < "121" < "1001")
    items.sort((a, b) => {
      const na = Number(a.clubCode);
      const nb = Number(b.clubCode);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a.clubCode).localeCompare(String(b.clubCode));
    });

    return NextResponse.json({ ok: true, clubs: items, total: items.length });
  } catch (err) {
    console.error("[GET /api/clubs] error", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
