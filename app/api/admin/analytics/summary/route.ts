// app/api/admin/analytics/summary/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

const getStartDate = (days: number) => {
  if (days === 0) return "1970-01-01T00:00:00.000Z";
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30", 10);
    const targetDate = getStartDate(days);

    // 1. ユーザーデータの取得
    const usersRes = await docClient.send(
      new ScanCommand({
        TableName: "yamauchi-Users",
        ProjectionExpression: "userId, #n, email, isActive, lastLoginAt",
        ExpressionAttributeNames: { "#n": "name" },
      })
    );
    const users = usersRes.Items || [];
    const userMap = new Map(users.map((u) => [u.userId, u]));

    const totalUsers = users.length;
    const activeUsers = users.filter((u) => u.isActive).length;
    const uniqueLoginUsersList = users.filter((u) => u.lastLoginAt && u.lastLoginAt >= targetDate);
    const uniqueLogins = uniqueLoginUsersList.length;
    const activityRate = activeUsers > 0 ? Math.round((uniqueLogins / activeUsers) * 100) : 0;

    // ※総ログイン数/ユーザー別回数はLoginLogsテーブルがない場合はユニーク数で代用
    const totalLogins = uniqueLogins; 
    const userLoginCounts = uniqueLoginUsersList.map(u => ({
      name: u.name, email: u.email, count: 1 // 複数回ログインログがある場合はここで集計
    }));

    // 2. マニュアル閲覧集計
    const manualsRes = await docClient.send(
      new ScanCommand({ TableName: process.env.KB_MANUALS_TABLE || "yamauchi-Manuals" })
    );
    const manuals = manualsRes.Items || [];
    
    let manualLogs: any[] = [];
    try {
      const logsRes = await docClient.send(
        new ScanCommand({
          TableName: "yamauchi-ManualViewLogs",
          FilterExpression: "viewedAt >= :targetDate",
          ExpressionAttributeValues: { ":targetDate": targetDate },
        })
      );
      manualLogs = logsRes.Items || [];
    } catch (e) { console.warn("ManualViewLogs table missing"); }

    const manualViewCounts: Record<string, number> = {};
    manualLogs.forEach((log) => { manualViewCounts[log.manualId] = (manualViewCounts[log.manualId] || 0) + 1; });

    const totalManualViews = manualLogs.length; // ✅ 追加: マニュアル総閲覧数

    const allManuals = manuals.map((m) => ({
      manualId: m.manualId,
      title: m.title,
      views: manualViewCounts[m.manualId] || 0,
    })).sort((a, b) => b.views - a.views);

    // 3. お問い合わせ集計
    let contactsDetail: any[] = [];
    try {
      const contactsRes = await docClient.send(
        new ScanCommand({
          TableName: "yamauchi-Contacts",
          FilterExpression: "createdAt >= :targetDate",
          ExpressionAttributeValues: { ":targetDate": targetDate },
        })
      );
      contactsDetail = (contactsRes.Items || []).map(c => ({
        name: c.name || "不明", email: c.email || "-", createdAt: c.createdAt
      })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (e) { console.warn("Contacts table missing"); }

    // 4. お知らせ閲覧集計（掘り下げ用データ作成）
    let newsViewsDetail: any[] = [];
    let newsViewCount = 0;
    try {
      // お知らせ本体を取得
      const newsRes = await docClient.send(new ScanCommand({ TableName: "yamauchi-News" }));
      const newsItems = newsRes.Items || [];
      const newsMap = new Map(newsItems.map(n => [n.newsId, n.title]));

      // 閲覧ログを取得
      const newsLogsRes = await docClient.send(
        new ScanCommand({
          TableName: "yamauchi-NewsViewLogs",
          FilterExpression: "viewedAt >= :targetDate",
          ExpressionAttributeValues: { ":targetDate": targetDate },
        })
      );
      const newsLogs = newsLogsRes.Items || [];
      newsViewCount = newsLogs.length;

      // お知らせIDごとに閲覧者をまとめる
      const newsAgg: Record<string, { title: string, views: number, viewers: any[] }> = {};
      newsLogs.forEach(log => {
        if (!newsAgg[log.newsId]) {
          newsAgg[log.newsId] = { 
            title: newsMap.get(log.newsId) || "不明なお知らせ", 
            views: 0, 
            viewers: [] 
          };
        }
        newsAgg[log.newsId].views += 1;
        const viewer = userMap.get(log.userId);
        newsAgg[log.newsId].viewers.push({
          name: viewer?.name || "不明なユーザー",
          email: viewer?.email || "-",
          viewedAt: log.viewedAt
        });
      });

      newsViewsDetail = Object.values(newsAgg).sort((a, b) => b.views - a.views);
    } catch (e) { console.warn("News/NewsViewLogs table missing"); }

    // 5. 検索ワードランキング
    let searchRanking: { keyword: string; count: number }[] = [];
    try {
      const searchRes = await docClient.send(
        new ScanCommand({
          TableName: "yamauchi-SearchLogs",
          FilterExpression: "searchedAt >= :targetDate",
          ExpressionAttributeValues: { ":targetDate": targetDate },
        })
      );
      const searchCounts: Record<string, number> = {};
      (searchRes.Items || []).forEach((s) => {
        if (s.keyword) searchCounts[s.keyword] = (searchCounts[s.keyword] || 0) + 1;
      });
      searchRanking = Object.entries(searchCounts)
        .map(([keyword, count]) => ({ keyword, count }))
        .sort((a, b) => b.count - a.count).slice(0, 10);
    } catch (e) { console.warn("SearchLogs table missing"); }

    return NextResponse.json({
      summary: {
        totalUsers, activeUsers, uniqueLogins, activityRate,
        totalLogins, totalManuals, totalManualViews, // ✅ 追加
        contactsCount: contactsDetail.length, newsViewCount,
      },
      uniqueLoginUsers: uniqueLoginUsersList,
      newsViewsDetail,
      contactsDetail,
      allManuals,
      searchRanking,
      userLoginCounts,
    });
  } catch (error: any) {
    console.error("Analytics Summary API Error:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}