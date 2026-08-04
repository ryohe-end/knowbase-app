// app/api/admin/analytics/summary/route.ts
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// === Table Names (必要なら env 化してください) ===
const USERS_TABLE = "yamauchi-Users";
const MANUALS_TABLE = "yamauchi-Manuals";
const NEWS_TABLE = process.env.NEWS_TABLE_NAME || "yamauchi-News";
const SEARCH_LOGS_TABLE = "yamauchi-SearchLogs";
const MANUAL_VIEW_LOGS_TABLE = "yamauchi-ManualViewLogs";
const NEWS_VIEW_LOGS_TABLE = "yamauchi-NewsViewLogs";
const LOGIN_LOGS_TABLE = "yamauchi-LoginLogs";

type UserData = {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt?: string;
};

type NewsDetail = {
  title: string;
  views: number;
  viewers: { name: string; email: string; viewedAt: string }[];
};

const getStartMs = (days: number) => {
  if (days === 0) return 0; // 全期間
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const safeDateMs = (v: any): number => {
  if (!v) return NaN;
  const ms = new Date(String(v)).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

/**
 * DynamoDB Scanは1回で最大1MB。NextTokenで全件取得。
 * （ログテーブルが増えると重くなるので、将来はGSI+Query推奨）
 */
async function scanAll(tableName: string) {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  while (true) {
    const input: ScanCommandInput = {
      TableName: tableName,
      ExclusiveStartKey,
    };
    const res = await docClient.send(new ScanCommand(input));
    if (res.Items?.length) items.push(...res.Items);
    if (!res.LastEvaluatedKey) break;
    ExclusiveStartKey = res.LastEvaluatedKey as any;
  }

  return items;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const daysRaw = searchParams.get("days") || "30";
    const days = Number.parseInt(daysRaw, 10);
    const safeDays = Number.isFinite(days) ? days : 30;
    const startMs = getStartMs(safeDays);

    // 1) Users / Manuals は先に取得（UIに必須）
    const [users, manuals] = await Promise.all([
      scanAll(USERS_TABLE),
      scanAll(MANUALS_TABLE),
    ]);

    const userMap = new Map<string, any>(
      (users || []).map((u: any) => [String(u.userId ?? ""), u])
    );

    // 2) ユニークログインユーザー詳細（Users.lastLoginAt 基準）
    const uniqueLoginUsers: UserData[] = (users || [])
      .filter((u: any) => {
        const ms = safeDateMs(u.lastLoginAt);
        if (!Number.isFinite(ms)) return false;
        return safeDays === 0 ? true : ms >= startMs;
      })
      .map((u: any) => ({
        userId: String(u.userId ?? ""),
        name: String(u.name ?? "-"),
        email: String(u.email ?? "-"),
        role: String(u.role ?? "viewer"),
        isActive: !!u.isActive,
        lastLoginAt: u.lastLoginAt ? String(u.lastLoginAt) : undefined,
      }))
      .sort((a, b) => (safeDateMs(b.lastLoginAt) || 0) - (safeDateMs(a.lastLoginAt) || 0));

    // 全ユーザー（ロール別切替・休眠アカウント判定・CSV出力に使用）
    const allUsers = (users || []).map((u: any) => ({
      userId: String(u.userId ?? ""),
      name: String(u.name ?? "-"),
      email: String(u.email ?? "-"),
      role: String(u.role ?? "viewer"),
      isActive: !!u.isActive,
      lastLoginAt: u.lastLoginAt ? String(u.lastLoginAt) : undefined,
      createdAt: u.createdAt ? String(u.createdAt) : undefined,
    }));

    // 3) 検索ワードランキング（SearchLogs）
    const searchLogs = await scanAll(SEARCH_LOGS_TABLE);
    const kwCounts = new Map<string, number>();

    for (const item of searchLogs) {
      const kw = String(item.keyword ?? item.Keyword ?? "").trim();
      if (!kw) continue;

      const atMs = safeDateMs(item.searchedAt ?? item.createdAt ?? item.timestamp);
      if (safeDays !== 0) {
        if (!Number.isFinite(atMs)) continue;
        if (atMs < startMs) continue;
      }

      kwCounts.set(kw, (kwCounts.get(kw) || 0) + 1);
    }

    const searchRanking = Array.from(kwCounts.entries())
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 4) ユーザー別ログイン回数（LoginLogs）
    const loginLogs = await scanAll(LOGIN_LOGS_TABLE);
    const cntByUserId = new Map<string, number>();

    for (const item of loginLogs) {
      const uid = String(item.userId ?? item.uid ?? "");
      if (!uid) continue;

      const atMs = safeDateMs(item.loggedAt ?? item.loginAt ?? item.createdAt ?? item.timestamp);
      if (safeDays !== 0) {
        if (!Number.isFinite(atMs)) continue;
        if (atMs < startMs) continue;
      }

      cntByUserId.set(uid, (cntByUserId.get(uid) || 0) + 1);
    }

    const totalLogins = Array.from(cntByUserId.values()).reduce((a, b) => a + b, 0);

    const userLoginCounts = Array.from(cntByUserId.entries())
      .map(([uid, count]) => {
        const u = userMap.get(uid);
        return {
          name: String(u?.name ?? uid),
          email: String(u?.email ?? "-"),
          count,
        };
      })
      .sort((a, b) => b.count - a.count);

    // 5) マニュアル閲覧ランキング（ManualViewLogs）
    // ログ形式の揺れに対応：manualId / manual_id、viewedAt / createdAt 等
    const manualViewLogs = await scanAll(MANUAL_VIEW_LOGS_TABLE);
    const manualViews = new Map<string, number>();

    for (const item of manualViewLogs) {
      const manualId = String(item.manualId ?? item.manual_id ?? "");
      if (!manualId) continue;

      const atMs = safeDateMs(item.viewedAt ?? item.createdAt ?? item.timestamp);
      if (safeDays !== 0) {
        if (!Number.isFinite(atMs)) continue;
        if (atMs < startMs) continue;
      }

      manualViews.set(manualId, (manualViews.get(manualId) || 0) + 1);
    }

    const allManuals = (manuals || [])
      .map((m: any) => {
        const manualId = String(m.manualId ?? "");
        return {
          manualId,
          title: String(m.title ?? ""),
          views: manualViews.get(manualId) || 0,
        };
      })
      .sort((a, b) => b.views - a.views);

    const totalManualViews = allManuals.reduce((sum, m) => sum + (m.views || 0), 0);

    // 6) お知らせ閲覧（NewsViewLogs）
    // newsId で集計し、表示タイトルは News テーブルから解決する。
    const [newsViewLogs, newsItems] = await Promise.all([
      scanAll(NEWS_VIEW_LOGS_TABLE),
      scanAll(NEWS_TABLE).catch(() => [] as any[]),
    ]);

    const newsTitleMap = new Map<string, string>();
    for (const n of newsItems) {
      const id = String(n.newsId ?? n.news_id ?? "").trim();
      const title = String(n.title ?? n.newsTitle ?? "").trim();
      if (id && title) newsTitleMap.set(id, title);
    }

    const newsAgg = new Map<
      string,
      { title: string; views: number; viewers: { name: string; email: string; viewedAt: string }[] }
    >();

    for (const item of newsViewLogs) {
      const atMs = safeDateMs(item.viewedAt ?? item.createdAt ?? item.timestamp);
      if (safeDays !== 0) {
        if (!Number.isFinite(atMs)) continue;
        if (atMs < startMs) continue;
      }

      const newsId = String(item.newsId ?? item.news_id ?? "").trim();
      const logTitle = String(item.title ?? item.newsTitle ?? item.news_title ?? "").trim();
      const key = newsId || logTitle;
      if (!key) continue;

      const displayTitle =
        (newsId && newsTitleMap.get(newsId)) || logTitle || newsId || "(タイトル不明)";

      const uid = String(item.userId ?? item.uid ?? "");
      const u = uid ? userMap.get(uid) : null;

      const viewer = {
        name: String(u?.name ?? item.userName ?? item.name ?? "-"),
        email: String(u?.email ?? item.userEmail ?? item.email ?? "-"),
        viewedAt: String(item.viewedAt ?? item.createdAt ?? new Date().toISOString()),
      };

      const cur = newsAgg.get(key);
      if (!cur) {
        newsAgg.set(key, { title: displayTitle, views: 1, viewers: [viewer] });
      } else {
        cur.views += 1;
        cur.viewers.push(viewer);
        // News テーブル解決できた場合は最新の title で上書き
        if (newsId && newsTitleMap.has(newsId)) cur.title = newsTitleMap.get(newsId)!;
      }
    }

    const newsViewsDetail: NewsDetail[] = Array.from(newsAgg.values())
      .sort((a, b) => b.views - a.views)
      .map((n) => ({
        title: n.title,
        views: n.views,
        viewers: n.viewers.sort((a, b) => safeDateMs(b.viewedAt) - safeDateMs(a.viewedAt)),
      }));

    const newsViewCount = newsViewsDetail.reduce((sum, n) => sum + n.views, 0);

    // 7) Contacts（ここでは簡易：0固定）
    const contactsCount = 0;
    const contactsDetail: { name: string; email: string; createdAt: string }[] = [];

    // 8) Summary
    const totalUsers = users.length;
    const activeUsers = users.filter((u: any) => !!u.isActive).length;
    const uniqueLogins = uniqueLoginUsers.length;
    const activityRate =
      activeUsers > 0 ? Math.round((uniqueLogins / activeUsers) * 1000) / 10 : 0; // 例: 12.3

    const summary = {
      totalUsers,
      activeUsers,
      uniqueLogins,
      activityRate,
      totalLogins,
      totalManuals: manuals.length,
      totalManualViews,
      contactsCount,
      newsViewCount,
    };

    // 9) Debug（不要なら削除OK）
    const debug = {
      region: REGION,
      days: safeDays,
      startIso: safeDays === 0 ? null : new Date(startMs).toISOString(),
      counts: {
        users: users.length,
        manuals: manuals.length,
        searchLogs: searchLogs.length,
        loginLogs: loginLogs.length,
        manualViewLogs: manualViewLogs.length,
        newsViewLogs: newsViewLogs.length,
      },
    };

    return NextResponse.json({
      summary,
      uniqueLoginUsers,
      allUsers,
      searchRanking,
      newsViewsDetail,
      contactsDetail,
      allManuals,
      userLoginCounts,
      debug,
    });
  } catch (error: any) {
    console.error("Critical Error:", error);
    return NextResponse.json(
      { error: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}