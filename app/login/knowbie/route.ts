// app/api/amazonq/route.ts
import { NextResponse } from "next/server";
import {
  QBusinessClient,
  ChatSyncCommand,
  ChatSyncCommandInput,
} from "@aws-sdk/client-qbusiness";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { answer: "質問文が空です。", error: "EMPTY_PROMPT" },
        { status: 400 }
      );
    }

    const region = process.env.AWS_REGION;
    const appId = process.env.QBUSINESS_APPLICATION_ID;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!region || !appId || !accessKeyId || !secretAccessKey) {
      const envInfo = {
        region,
        appId,
        hasAccessKey: !!accessKeyId,
        hasSecretKey: !!secretAccessKey,
      };
      console.error("Amazon Q env 不足", envInfo);

      return NextResponse.json(
        {
          answer: "Amazon Q の環境変数が不足しています。",
          error: "MISSING_ENV",
          detail: envInfo,
        },
        { status: 500 }
      );
    }

    const client = new QBusinessClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const input: ChatSyncCommandInput = {
      applicationId: appId,
      userId: "knowbie-demo-user@yamauchi.local", // Q Business のユーザーに合わせるのがベスト
      userMessage: prompt,
    };

    const command = new ChatSyncCommand(input);
    const res = await client.send(command);

    // res.systemMessage に回答が入る
    const answer =
      res.systemMessage ??
      "（Amazon Q からの応答テキストが取得できませんでした）";

    return NextResponse.json({ answer });
  } catch (err: any) {
    console.error("Amazon Q API ERROR:", err);

    return NextResponse.json(
      {
        answer: "Amazon Q API 呼び出し中にエラーが発生しました。",
        error: err?.name ?? "UNKNOWN_ERROR",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}

