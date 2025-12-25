// app/api/news/notify/route.ts
import { NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";

// SendGrid APIキーの設定（環境変数から読み込み）
sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function POST(req: Request) {
  try {
    const { title, body, targetGroupIds } = await req.json();

    // 1. 配信対象グループのロジック構築
    // 直営(direct) -> 直営 + 管理者
    // 加盟店(franchise) -> 加盟店 + 管理者
    // 管理者(admin_attr) -> 管理者のみ
    const recipientGroups = new Set<string>(targetGroupIds);
    if (targetGroupIds.includes('direct')) recipientGroups.add('admin_attr');
    if (targetGroupIds.includes('franchise')) recipientGroups.add('admin_attr');
    
    const finalGroupIds = Array.from(recipientGroups);

    // 2. ユーザーテーブルからメールアドレスを取得
    // ※ ここは実際のDBライブラリ (PrismaやFirebase Admin等) に合わせて書き換えてください
    /*
    const users = await db.user.findMany({
      where: { groupId: { in: finalGroupIds } },
      select: { email: true }
    });
    const bccEmails = users.map(u => u.email).filter(Boolean);
    */
    
    // サンプルのためのダミーデータ
    const bccEmails = ["user1@example.com", "user2@example.com"]; 

    if (bccEmails.length === 0) {
      return NextResponse.json({ message: "送信対象がいません" });
    }

    // 3. SendGridで送信 (BCCを利用)
    await sgMail.send({
      to: 'noreply@knowbase-app.com', // ダミーの送信先（必須項目）
      bcc: bccEmails,
      from: 'info@your-verified-domain.com', // SendGridで認証済みのメールアドレス
      subject: `【KnowBaseお知らせ】${title}`,
      text: body,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mail Error:", error);
    return NextResponse.json({ error: "通知に失敗しました" }, { status: 500 });
  }
}