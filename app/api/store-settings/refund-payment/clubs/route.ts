// app/api/store-settings/refund-payment/clubs/route.ts
//
// 返金画面のクラブセレクタ用エンドポイント。
// ログインユーザの yamauchi-Users.clubCodes に基づいて利用可能なクラブ一覧を返す。
// clubCodes が空 (= 全クラブアクセス可) なら knowbie-clubs を Scan して全件返す。

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { getRefundUser } from "@/lib/refundAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLUBS_TABLE = process.env.CLUBS_TABLE || "knowbie-clubs";
const CLUBS_REGION = process.env.CLUBS_TABLE_REGION || "us-east-1";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: CLUBS_REGION }));

type Club = { clubCode: string; clubName?: string; clubNameShort?: string };

function sortClubs(items: Club[]): Club[] {
  return [...items].sort((a, b) => {
    const na = Number(a.clubCode);
    const nb = Number(b.clubCode);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a.clubCode).localeCompare(String(b.clubCode));
  });
}

export async function GET() {
  const user = await getRefundUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (user.clubCodes.length === 0) {
      // 全店アクセス可: 全件返す
      const items: Club[] = [];
      let LastEvaluatedKey: Record<string, any> | undefined;
      do {
        const res = await ddb.send(
          new ScanCommand({
            TableName: CLUBS_TABLE,
            ProjectionExpression: "clubCode, clubName, clubNameShort",
            ExclusiveStartKey: LastEvaluatedKey,
          })
        );
        items.push(...((res.Items as Club[]) ?? []));
        LastEvaluatedKey = res.LastEvaluatedKey;
      } while (LastEvaluatedKey);
      return NextResponse.json({ ok: true, clubs: sortClubs(items), scope: "all" });
    }

    // clubCodes に絞って BatchGet
    const items: Club[] = [];
    for (let i = 0; i < user.clubCodes.length; i += 100) {
      const chunk = user.clubCodes.slice(i, i + 100);
      const res = await ddb.send(
        new BatchGetCommand({
          RequestItems: {
            [CLUBS_TABLE]: {
              Keys: chunk.map((c) => ({ clubCode: c })),
              ProjectionExpression: "clubCode, clubName, clubNameShort",
            },
          },
        })
      );
      items.push(...((res.Responses?.[CLUBS_TABLE] as Club[]) ?? []));
    }
    // BatchGet で取れなかった clubCodes も "名前なし" として返す
    const got = new Set(items.map((it) => it.clubCode));
    for (const code of user.clubCodes) {
      if (!got.has(code)) items.push({ clubCode: code });
    }
    return NextResponse.json({ ok: true, clubs: sortClubs(items), scope: "limited" });
  } catch (e: any) {
    console.error("[refund clubs] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "DB error" }, { status: 500 });
  }
}
