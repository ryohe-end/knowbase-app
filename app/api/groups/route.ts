// app/api/groups/route.ts

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";

const region = process.env.AWS_REGION || "us-east-1";
const TABLE_GROUPS = "yamauchi-Groups"; // ★ 新しいテーブル名

// ★★★ 修正箇所: 認証情報の設定 ★★★
const ACCESS_KEY_ID = process.env.APP_AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.APP_AWS_SECRET_ACCESS_KEY;
// ★★★

const ddbClient = new DynamoDBClient({ 
  region,
  ...(ACCESS_KEY_ID && SECRET_ACCESS_KEY 
    ? { credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY } } 
    : {})
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// ★ ユーザー指定のフォールバックデータ
const FALLBACK_GROUPS = [
    { groupId: "direct", groupName: "直営", sortOrder: 10, isActive: true },
    { groupId: "franchise", groupName: "加盟店", sortOrder: 20, isActive: true },
    { groupId: "admin_attr", groupName: "管理者", sortOrder: 90, isActive: true },
];

export async function GET() {
  try {
    const cmd = new ScanCommand({
      TableName: TABLE_GROUPS,
    });

    const data = await docClient.send(cmd);
    const items = (data.Items || []) as any[];

    // sortOrderでソート
    items.sort((a, b) => {
      const sa = Number(a.sortOrder ?? 9999);
      const sb = Number(b.sortOrder ?? 9999);
      if (sa !== sb) return sa - sb;
      return String(a.groupId || "").localeCompare(
        String(b.groupId || "")
      );
    });

    return NextResponse.json({ groups: items });
  } catch (err: any) {
    console.error("[/api/groups] Dynamo error:", err);

    return NextResponse.json(
      {
        groups: FALLBACK_GROUPS,
        error: "DynamoDB scan failed. Fallback groups returned.",
        detail: String(err?.message || err),
        name: err?.name ?? undefined,
      },
      { status: 200 }
    );
  }
}