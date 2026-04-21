// app/api/depts/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient, ScanCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const TABLE_NAME = process.env.DYNAMO_DEPTS_TABLE || "yamauchi-Depts";

/**
 * ✅ GET: 部署一覧の取得
 */
export async function GET() {
  try {
    const command = new ScanCommand({
      TableName: TABLE_NAME,
    });

    const result = await client.send(command);
    const depts = (result.Items || []).map((item) => unmarshall(item));

    depts.sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999));

    return NextResponse.json({ depts });
  } catch (err) {
    console.error("Failed to fetch depts:", (err as Error)?.name);
    return NextResponse.json({ error: "Failed to fetch depts" }, { status: 500 });
  }
}

/**
 * ✅ POST: 部署情報の保存（新規・更新共通）
 */
export async function POST(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 2. リクエストボディの解析
    const body = await req.json();
    const { deptId, name, mailingList, sortOrder } = body;

    if (!deptId || !name) {
      return NextResponse.json(
        { error: "deptId と name は必須です。" },
        { status: 400 }
      );
    }

    // 3. 保存データの整形
    const item = {
      deptId,
      name,
      mailingList: Array.isArray(mailingList) ? mailingList : [],
      sortOrder: typeof sortOrder === "number" ? sortOrder : 100,
      updatedAt: new Date().toISOString(),
    };

    // 4. DynamoDB への書き込み実行
    await client.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(item, { removeUndefinedValues: true }),
      })
    );

    return NextResponse.json({ ok: true, deptId });
  } catch (err) {
    console.error("Failed to save dept:", (err as Error)?.name);
    return NextResponse.json({ error: "Failed to save dept" }, { status: 500 });
  }
}