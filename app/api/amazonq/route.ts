// app/api/amazonq/route.ts
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const keys = Object.keys(process.env);

  // QBUSINESS 関連のキーだけ抽出
  const qbKeys = keys.filter((k) => k.toUpperCase().includes("QBUSINESS"));

  // "QBUSINESS_APP_ID" に見えるけど実は末尾スペース等で違うキーを検出
  const suspicious = keys.filter(
    (k) => k.trim() === "QBUSINESS_APP_ID" && k !== "QBUSINESS_APP_ID"
  );

  const appId = process.env.QBUSINESS_APP_ID;

  return new Response(
    JSON.stringify(
      {
        QBUSINESS_APP_ID: appId ? "(set)" : "(missing)",
        QBUSINESS_APP_ID_len: appId?.length ?? 0,
        foundQBusinessKeys: qbKeys,
        suspiciousKeysLikeQBUSINESS_APP_ID: suspicious,
        AWS_REGION: process.env.AWS_REGION ?? null,
        QBUSINESS_REGION: process.env.QBUSINESS_REGION ?? null,
        AMPLIFY_ENV: process.env.AMPLIFY_ENV ?? null,
        NODE_ENV: process.env.NODE_ENV ?? null,
      },
      null,
      2
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
}
