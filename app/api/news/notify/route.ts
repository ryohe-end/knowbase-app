// app/api/news/notify/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import sgMail from "@sendgrid/mail";

// DynamoDB
const region = process.env.AWS_REGION || "us-east-1";
const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// SendGrid（使う直前に初期化する）
function initSendGrid() {
  const key = process.env.SENDGRID_API_KEY ?? "";
  const from = process.env.SENDGRID_FROM_EMAIL ?? "";

  // 値そのものはログに出さない（prefix/len のみ）
  console.log("[SendGrid key check]", {
    hasKey: !!key,
    prefix: key.slice(0, 3),
    len: key.length,
    hasFrom: !!from,
  });

  if (!key) throw new Error("Missing env: SENDGRID_API_KEY");
  if (!key.startsWith("SG.")) throw new Error("Invalid SENDGRID_API_KEY (must start with 'SG.')");
  if (!from) throw new Error("Missing env: SENDGRID_FROM_EMAIL");

  sgMail.setApiKey(key);
  return { from };
}

export async function POST(req: Request) {
  try {
    const { newsId } = await req.json();
    if (!newsId) {
      return NextResponse.json(
        { error: "newsIdが指定されていません" },
        { status: 400 }
      );
    }

    // 1. お知らせ詳細をDynamoDBから取得
    const newsRes = await docClient.send(
      new GetCommand({
        TableName: "yamauchi-News",
        Key: { newsId },
      })
    );
    const news = newsRes.Item as any;
    if (!news) {
      return NextResponse.json(
        { error: "お知らせが見つかりませんでした" },
        { status: 404 }
      );
    }

    // 2. ユーザー一覧を取得
    const usersRes = await docClient.send(
      new ScanCommand({
        TableName: "yamauchi-Users",
      })
    );
    const allUsers = (usersRes.Items || []) as any[];

    // 3. 配信対象ユーザーの絞り込み
    const targetUsers = allUsers.filter((user) => {
      const isActiveUser = user.isActive !== false;

      const matchBrand = news.brandId === "ALL" || user.brandId === news.brandId;
      const matchDept = news.deptId === "ALL" || user.deptId === news.deptId;

      const matchGroup =
        !news.targetGroupIds ||
        news.targetGroupIds.length === 0 ||
        news.targetGroupIds.includes(user.groupId);

      return isActiveUser && matchBrand && matchDept && matchGroup;
    });

    if (targetUsers.length === 0) {
      return NextResponse.json({
        ok: true,
        count: 0,
        message: "対象ユーザーがいません",
      });
    }

    // 4. 受信者（空や不正を除外）
    const emails = targetUsers.map((u) => u.email).filter(Boolean);
    if (emails.length === 0) {
      return NextResponse.json({
        ok: true,
        count: 0,
        message: "対象ユーザーにメールアドレスがありません",
      });
    }

    // 5. SendGrid 初期化（ここで初めて setApiKey）
    const { from } = initSendGrid();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const msg = {
      to: emails,
      from: { email: from, name: "KnowBase運営事務局" },
      subject: `【KnowBase】お知らせ：${news.title}`,
      text: `${news.body}\n\n詳細はKnowBaseにログインして確認してください。`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #0ea5e9; padding: 20px; color: white; text-align: center;">
            <h1 style="margin: 0; font-size: 20px;">KnowBase お知らせ通知</h1>
          </div>
          <div style="padding: 24px; color: #1e293b;">
            <h2 style="margin-top: 0; color: #0f172a;">${news.title}</h2>
            <div style="white-space: pre-wrap; line-height: 1.6; color: #475569;">${news.body}</div>
            <div style="margin-top: 32px; text-align: center;">
              <a href="${appUrl}"
                 style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
                KnowBaseで詳細を見る
              </a>
            </div>
          </div>
          <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
            ※このメールは送信専用です。心当たりがない場合は破棄してください。
          </div>
        </div>
      `,
    };

    // 一括送信（個人宛てとして複数人に送信）
    await sgMail.sendMultiple(msg);

    return NextResponse.json({
      ok: true,
      count: emails.length,
      message: `${emails.length}名の有効なユーザーに配信しました`,
    });
  } catch (error: any) {
    console.error("[NOTIFY_ERROR]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
