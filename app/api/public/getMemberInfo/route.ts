// app/api/public/getMemberInfo/route.ts
// 公開API: 会員ステータス状況確認(本家 wellness-frontier.com/api/getMemberInfo 互換)。
// adb01(FIT_ADMIN)ベースで member-search Lambda(type=member_info)から生成。外部パートナーが
// 本家APIのドロップイン置換として使えるよう、同一のリクエスト/レスポンス形式を返す。
//   認証: x-api-key ヘッダ(KB_PUBLIC_API_KEY と照合)
//   メソッド: POST(本家同様) ※GETも可(クエリ/ボディどちらでも memberID/type を受ける)
//   リクエスト(JSON): { userID?, memberID, type(1|2|3|4), reqTimestamp?, historyFrom?, historyTo? }
//     type=1 会員認証/契約情報, 2 支払情報, 3 YOGAスタジオ履歴, 4 入館履歴
//     ※type=3(YOGA)は adb01 に該当データが無く resultCode=NG(yogaStudioHistory:[]) を返す
//   レスポンス(JSON): { userID, resultCode, memberID, type, reqTimestamp, historyFrom, historyTo,
//                       memberInfo, contractInfo|payInfo|yogaStudioHistory|clubHistory }
//   ※データ源 adb01 は夜間スナップショット由来のため当日更新は最大~24h遅延。
import { NextResponse } from "next/server";
import { callMemberSearch } from "@/lib/unpaid";
import { requirePublicApiKey } from "@/lib/publicApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nowTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function handle(req: Request, input: Record<string, any>) {
  const authErr = requirePublicApiKey(req);
  if (authErr) return authErr;

  const memberID = String(input.memberID ?? "").trim();
  const type = String(input.type ?? "1").trim();
  const userID = input.userID != null ? String(input.userID).trim() : null;
  const historyFrom = input.historyFrom != null && input.historyFrom !== "" ? String(input.historyFrom).trim() : null;
  const historyTo = input.historyTo != null && input.historyTo !== "" ? String(input.historyTo).trim() : null;
  const reqTimestamp = input.reqTimestamp ? String(input.reqTimestamp).trim() : nowTimestamp();

  if (!/^\d{1,10}$/.test(memberID)) {
    return NextResponse.json({ userID, resultCode: "NG", memberID: Number(memberID) || 0, type: Number(type), reqTimestamp, historyFrom, historyTo, memberInfo: null, error: "memberID(半角数字) required" }, { status: 400 });
  }
  if (!["1", "2", "3", "4"].includes(type)) {
    return NextResponse.json({ userID, resultCode: "NG", memberID: Number(memberID), type: Number(type) || 0, reqTimestamp, historyFrom, historyTo, memberInfo: null, error: "type must be 1|2|3|4" }, { status: 400 });
  }
  // type=3/4 は historyFrom/To(YYYYMMDD)必須。期間は最大366日。
  if (type === "4" || type === "3") {
    if (!historyFrom || !historyTo || !/^\d{8}$/.test(historyFrom) || !/^\d{8}$/.test(historyTo)) {
      return NextResponse.json({ userID, resultCode: "NG", memberID: Number(memberID), type: Number(type), reqTimestamp, historyFrom, historyTo, memberInfo: null, error: "historyFrom/historyTo(YYYYMMDD) required for type 3/4" }, { status: 400 });
    }
  }

  try {
    const params: Record<string, string> = { type: "member_info", memberID, infoType: type };
    if (historyFrom) params.historyFrom = historyFrom;
    if (historyTo) params.historyTo = historyTo;
    const data = await callMemberSearch(params);
    // Lambda応答は既に getMemberInfo 互換。userID(リクエスト値)と reqTimestamp(呼び出し時刻)を付与して返す。
    return NextResponse.json({ userID, ...data, reqTimestamp });
  } catch (e: any) {
    return NextResponse.json({ userID, resultCode: "NG", memberID: Number(memberID), type: Number(type), reqTimestamp, historyFrom, historyTo, memberInfo: null, error: e?.message || "member_search_error" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { body = {}; }
  return handle(req, body);
}

// GET も許可(?memberID=&type=&historyFrom=&historyTo=)。動作確認・簡易利用向け。
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  return handle(req, {
    userID: sp.get("userID"), memberID: sp.get("memberID"), type: sp.get("type"),
    reqTimestamp: sp.get("reqTimestamp"), historyFrom: sp.get("historyFrom"), historyTo: sp.get("historyTo"),
  });
}
