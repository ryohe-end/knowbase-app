// app/api/store-settings/refund-payment/member-detail/route.ts
//
// 返金画面用の会員詳細 (口座 + プラン + 返金可能項目) 取得 API。
// member-search 同様、API Gateway 経由で Oracle 系を叩く。
//
// Lambda 側に追加してもらうエンドポイント:
//   GET {MEMBER_SEARCH_API_BASE}/members/refundable
//   Query: memberNo, clubCode, fromMonth? (YYYYMM), toMonth? (YYYYMM)
//   Header: x-api-key: {MEMBER_SEARCH_API_KEY}
//
// ▼ Oracle 側 SQL (7 テーブル JOIN — 会員区分/会費分類マスタを含む):
//   SELECT
//     -- 会員情報
//     b.会員番号, b.個人SEQ, c.クラブコード,
//     c.会員区分コード, k.会員区分名, k.会員大区分コード, k.法人フラグ,
//     c.入会届出日, c.退会届出日, c.退会日,
//     c.T休会開始年月日 AS 休会開始, c.T休会終了年月日 AS 休会終了,
//     -- 入金歴 (返金可能項目)
//     a.契約SEQ, a.対応年月,
//     a.会費分類コード, h.会費分類名,
//     a.会費摘要コード,
//     a.月相当額, a.請求額, a.入金額, a.当営業月入金額,
//     a.入金年月日, a.会費支払方式コード,
//     -- 口座 (会員契約者口座、通常 1 件の有効口座)
//     f.銀行支店コード, f.預金種目コード,
//     TRIM(f.口座番号) AS 口座番号, TRIM(f.預金者名) AS 預金者名,
//     f.クレジットカードNO, f.有効期限, f.ステータス1, f.ステータス2, f.ステータス3
//   FROM 会員入金歴 a
//   INNER JOIN 会員番号 b       ON a.契約者SEQ = b.契約者SEQ
//   INNER JOIN 会員契約 c       ON a.契約SEQ   = c.契約SEQ
//   INNER JOIN 会員契約明細 e   ON c.契約SEQ   = e.契約SEQ
//   INNER JOIN 会員契約者口座 f ON a.契約者SEQ = f.契約者SEQ
//   LEFT  JOIN 会員区分 k       ON c.会員区分コード = k.会員区分コード
//   LEFT  JOIN 会費分類 h       ON a.会費分類コード = h.会費分類コード
//   WHERE b.会員番号 = :memberNo
//     AND c.クラブコード = :clubCode
//     AND a.対応年月 BETWEEN :fromMonth AND :toMonth
//     AND a.入金額 > 0;
//
// ▼ コード変換ルール:
//   - 銀行支店コード (10桁) = 銀行4桁 + 支店6桁
//       例: "1000127100" → bankCode="1000", branchCode="127100"
//   - 預金種目コード: 1 = 普通, 2 = 当座
//
//   - 会員区分 (会員区分テーブル参照、k.会員区分名 をそのまま plan に):
//       1=フィットネス, 2=スイミング, 3=会員区分3, 4=会員区分4, 5=会員区分5,
//       6=お試し会員, 7=スタッフ, 8=タイム会員, 9=他店舗会員,
//       60=法人 (法人フラグ=1), 70=法人個人, 80=短期スイミング, 90=オプション契約
//     ※ 法人フラグ=1 のとき plan ラベルに「法人」を強調表示するなど UI 側で活用
//
//   - 会費分類 (会費分類テーブル参照、h.会費分類名 をそのまま category に):
//       0=入会金, 1=会費, 2=バス代, 3=PVロッカー費, 4=シューズロッカー,
//       50=年管理費, 60=保証金, 90=更新費, 91=事務手数料, 99=その他
//     ※ Lambda は h.会費分類名 を返すだけで、UI 側で必要に応じてカテゴリグループ化
//
//   - 対応年月 "202007" → targetMonth "2020-07"
//   - 入金年月日 "20200817" → paidAt "2020-08-17"
//   - 項目ラベル例: "会費 (2020年7月分)" = `${会費分類名} (${YYYY}年${MM}月分)`
//
// ▼ Response 契約:
// {
//   "results": {
//     "member": {
//       "memberNo": "3130003649",
//       "name": "横内 みちつな",           // 会員番号テーブルに漢字氏名なければ預金者名カナから推定不可、別ソース
//       "kana": "ﾖｺｳﾁ ﾐﾁﾂﾅ",
//       "phone": null,                       // 別テーブル参照が必要なら別途
//       "plan": "フィットネス",              // 会員区分名 (k.会員区分名)
//       "planCode": 1,                       // 会員区分コード
//       "isCorporate": false,                // 法人フラグ=1 のとき true
//       "joinClubCode": "313",
//       "joinClubName": "旭川アモール",      // クラブマスタから解決
//       "withdrawnAt": "2021-03-01",         // 退会日
//       "status": "withdrawn"                // active/dormant/withdrawn
//     },
//     "account": {
//       "bankCode": "1000",
//       "bankName": "(銀行マスタ参照、不明なら null)",
//       "branchCode": "127100",
//       "branchName": "(支店マスタ参照、不明なら null)",
//       "accountType": "普通",              // 1→"普通", 2→"当座"
//       "accountNumber": "2297908",
//       "holderName": "ﾖｺｳﾁ ﾐﾁﾂﾅ",
//       "source": "登録済み（引落口座）",
//       "isCreditCard": false,              // クレジットカードNOがある場合 true
//       "isActive": true                    // ステータス1〜3が空欄なら true
//     },
//     "items": [
//       { "id": "28000-202007-1", "label": "会費 (2020年7月分)",
//         "amount": 5280, "paidAt": "2020-08-17", "targetMonth": "2020-07",
//         "category": "会費", "categoryCode": 1, "contractSeq": 28000 }
//     ]
//   }
// }
//
// 環境変数:
//   MEMBER_SEARCH_API_BASE / MEMBER_SEARCH_API_KEY  (member-search と共通)

import { NextRequest, NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { writeAudit, clientIp } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.MEMBER_SEARCH_API_BASE || "";
const API_KEY = process.env.MEMBER_SEARCH_API_KEY || "";

export async function GET(req: NextRequest) {
  const user = await getRefundUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const memberNo = (sp.get("memberNo") || "").trim();
  const clubCode = (sp.get("clubCode") || "").trim();
  if (!memberNo) {
    return NextResponse.json({ ok: false, error: "memberNo required" }, { status: 400 });
  }
  if (!clubCode) {
    return NextResponse.json({ ok: false, error: "clubCode required" }, { status: 400 });
  }
  if (!isClubInScope(user, clubCode)) {
    return NextResponse.json({ ok: false, error: "Forbidden: club out of scope" }, { status: 403 });
  }

  if (!API_BASE || !API_KEY) {
    return NextResponse.json(
      { ok: false, error: "member_search_api_not_configured" },
      { status: 500 }
    );
  }

  // 既存の /members/search Lambda に type=refundable で投げる
  // (新たな API Gateway ルートを増やさないため)
  const url = new URL(`${API_BASE}/members/search`);
  url.searchParams.set("type", "refundable");
  url.searchParams.set("memberNo", memberNo);
  url.searchParams.set("clubCode", clubCode);
  const fromMonth = sp.get("fromMonth");
  const toMonth = sp.get("toMonth");
  if (fromMonth) url.searchParams.set("fromMonth", fromMonth);
  if (toMonth) url.searchParams.set("toMonth", toMonth);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-key": API_KEY },
      cache: "no-store",
    });
  } catch (err) {
    console.error("upstream fetch failed", err);
    return NextResponse.json({ ok: false, error: "upstream_unreachable" }, { status: 502 });
  }
  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("upstream error", upstream.status, text);
    return NextResponse.json(
      { ok: false, error: "upstream_error", status: upstream.status },
      { status: 502 }
    );
  }

  const payload = await upstream.json() as { results?: { member?: any; account?: any; items?: any[] } };
  const r = payload.results || {};
  void writeAudit({
    userId: (user as any).email || (user as any).userId || "unknown",
    userName: (user as any).name,
    action: "refund.memberDetail",
    clubCodes: [clubCode],
    resource: `member:${memberNo}`,
    detail: { hasAccount: !!r.account, itemCount: Array.isArray(r.items) ? r.items.length : 0 },
    ip: clientIp(req),
  });
  return NextResponse.json({
    ok: true,
    member: r.member ?? null,
    account: r.account ?? null,
    items: Array.isArray(r.items) ? r.items : [],
  });
}
