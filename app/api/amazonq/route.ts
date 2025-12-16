// app/api/amazonq/route.ts
import { NextRequest, NextResponse } from "next/server";
import { QBusinessClient, ChatSyncCommand } from "@aws-sdk/client-qbusiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function getClient() {
  // Amplifyでは AWS_ プレフィックスが禁止なので APP_AWS_* を使う
  const region =
    process.env.QBUSINESS_REGION ||
    process.env.APP_AWS_REGION ||
    "us-east-1";

  const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY;

  const applicationId = mustEnv("QBUSINESS_APP_ID");

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing env APP_AWS_ACCESS_KEY_ID / APP_AWS_SECRET_ACCESS_KEY"
    );
  }

  return {
    client: new QBusinessClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    }),
    applicationId,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "prompt が空です。" }, { status: 400 });
    }

    const { client, applicationId } = getClient();

    // accessToken は「入ってる時だけ送る」。空を送るとValidationで落ちる
    const token = String(process.env.QBUSINESS_ACCESS_TOKEN ?? "").trim();

    const input: any = {
      applicationId,
      userMessage: prompt,
      ...(token ? { accessToken: token } : {}),
    };

    const res = await client.send(new ChatSyncCommand(input));

    return NextResponse.json({
      ok: true,
      answer: (res as any)?.systemMessage ?? "",
      conversationId: (res as any)?.conversationId ?? null,
      systemMessageId: (res as any)?.systemMessageId ?? null,
      sourceAttributions: (res as any)?.sourceAttributions ?? [],
    });
  } catch (e: any) {
    console.error("Amazon Q ChatSync error:", e);
    return NextResponse.json(
      { ok: false, error: `${e?.name ?? "Error"} - ${e?.message ?? ""}` },
      { status: 500 }
    );
  }
}
