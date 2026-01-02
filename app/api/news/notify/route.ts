// app/api/news/notify/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import sgMail from "@sendgrid/mail";

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// SendGrid APIキーの設定
sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

export async function POST(req: Request) {
  try {
    const { newsId } = await req.json();
    if (!newsId) {
      return NextResponse.json({ error: "newsIdが指定されていません" }, { status: 400 });
    }

    // 1. お知らせ詳細をDynamoDBから取得
    const newsRes = await docClient.send(new GetCommand({
      TableName: "yamauchi-News",
      Key: { newsId }
    }));
    const news = newsRes.Item;
    if (!news) {
      return NextResponse.json({ error: "お知らせが見つかりませんでした" }, { status: 404 });
    }

    // 2. ユーザー一覧を取得（isActive = true のユーザーを抽出するため全件スキャン）
    const usersRes = await docClient.send(new ScanCommand({
      TableName: "yamauchi-Users"
    }));
    const allUsers = usersRes.Items || [];

    // 3. 配信対象ユーザーの絞り込み
    const targetUsers = allUsers.filter(user => {
      // 条件1: isActive が true (または未定義) であること
      const isActiveUser = user.isActive !== false;

      // 条件2: ブランド一致 (お知らせが ALL または ユーザーのブランドと一致)
      const matchBrand = news.brandId === "ALL" || user.brandId === news.brandId;

      // 条件3: 部署一致 (お知らせが ALL または ユーザーの部署と一致)
      const matchDept = news.deptId === "ALL" || user.deptId === news.deptId;

      // 条件4: 属性グループ一致 (お知らせの targetGroupIds にユーザーの groupId が含まれるか)
      const matchGroup = !news.targetGroupIds || 
                         news.targetGroupIds.length === 0 || 
                         news.targetGroupIds.includes(user.groupId);

      return isActiveUser && matchBrand && matchDept && matchGroup;
    });

    if (targetUsers.length === 0) {
      return NextResponse.json({ ok: true, count: 0, message: "対象ユーザーがいません" });
    }

    // 4. SendGridメッセージの作成
    // 受信者全員に個別に送る（BCCのように他人のアドレスが見えない）設定
    const emails = targetUsers.map(u => u.email).filter(Boolean);
    
    const msg = {
      to: emails,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL!,
        name: "KnowBase運営事務局" // 受信トレイに表示される名前
      },
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
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}" 
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
      count: targetUsers.length,
      message: `${targetUsers.length}名の有効なユーザーに配信しました` 
    });

  } catch (error: any) {
    console.error("[NOTIFY_ERROR]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}