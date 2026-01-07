import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const TABLE_NAME = "yamauchi-ExternalLinks";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { linkId: string } }
) {
  const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
  try {
    const { linkId } = params;
    await client.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ linkId }),
    }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
