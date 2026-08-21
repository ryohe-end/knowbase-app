// app/api-reference/page.tsx
// 公開API リファレンス(Web版)。クラブ一覧 + 会費 を1ページにまとめる。
// ログイン不要(middleware の publicPaths に /api-reference を追加)。
// 外部連携先に URL を共有して参照してもらう用途。API キーは本ページには記載しない。
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "KnowBase 公開API リファレンス",
  robots: { index: false, follow: false },
};

const BASE = "https://main.d5z4bnw4wyrxn.amplifyapp.com";

const s = {
  root: { maxWidth: 920, margin: "0 auto", padding: "32px 20px 80px", color: "#1e293b", fontFamily: "'Helvetica Neue',Arial,'Noto Sans JP',sans-serif", lineHeight: 1.7 } as const,
  h1: { fontSize: 26, fontWeight: 700, margin: "0 0 8px" } as const,
  lead: { color: "#475569", fontSize: 14, margin: "0 0 24px" } as const,
  h2: { fontSize: 20, fontWeight: 700, margin: "40px 0 12px", paddingBottom: 6, borderBottom: "2px solid #e2e8f0" } as const,
  h3: { fontSize: 16, fontWeight: 700, margin: "24px 0 8px" } as const,
  p: { fontSize: 14, margin: "0 0 12px" } as const,
  code: { background: "#f1f5f9", borderRadius: 4, padding: "1px 6px", fontFamily: "'SFMono-Regular',Consolas,monospace", fontSize: 13 } as const,
  pre: { background: "#0f172a", color: "#e2e8f0", borderRadius: 10, padding: "14px 16px", overflowX: "auto", fontFamily: "'SFMono-Regular',Consolas,monospace", fontSize: 13, lineHeight: 1.6 } as const,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, margin: "8px 0 16px" } as const,
  th: { textAlign: "left", borderBottom: "2px solid #cbd5e1", padding: "8px 10px", background: "#f8fafc" } as const,
  td: { textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "8px 10px", verticalAlign: "top" } as const,
  pill: { display: "inline-block", background: "#0ea5e9", color: "#fff", fontWeight: 700, fontSize: 12, borderRadius: 6, padding: "2px 8px", marginRight: 8 } as const,
  note: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 13, margin: "12px 0" } as const,
};

function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <p style={{ margin: "8px 0" }}>
      <span style={s.pill}>{method}</span>
      <code style={s.code}>{path}</code>
    </p>
  );
}

export default function ApiReferencePage() {
  return (
    <div style={s.root}>
      <h1 style={s.h1}>KnowBase 公開API リファレンス</h1>
      <p style={s.lead}>
        外部システム連携向けの公開APIです。本ページは、<b>クラブ一覧</b>・<b>会費</b>・<b>規約</b>の3つのAPIをまとめたリファレンスです。
      </p>

      {/* 共通仕様 */}
      <h2 style={s.h2}>共通仕様</h2>
      <h3 style={s.h3}>ベースURL</h3>
      <pre style={s.pre}>{BASE}</pre>
      <h3 style={s.h3}>認証</h3>
      <p style={s.p}>
        すべてのエンドポイントで <code style={s.code}>x-api-key</code> ヘッダが必要です。キーは別途、安全な手段でお渡しします。
      </p>
      <pre style={s.pre}>x-api-key: &lt;お渡しした API キー&gt;</pre>
      <h3 style={s.h3}>共通エラー</h3>
      <table style={s.table}>
        <thead><tr><th style={s.th}>ステータス</th><th style={s.th}>body</th><th style={s.th}>条件</th></tr></thead>
        <tbody>
          <tr><td style={s.td}>401</td><td style={s.td}><code style={s.code}>{'{ "ok": false, "error": "unauthorized" }'}</code></td><td style={s.td}>x-api-key 不正/欠落</td></tr>
          <tr><td style={s.td}>400</td><td style={s.td}><code style={s.code}>{'{ "ok": false, "error": "..." }'}</code></td><td style={s.td}>必須パラメータ欠落</td></tr>
          <tr><td style={s.td}>404</td><td style={s.td}><code style={s.code}>{'{ "ok": false, "error": "not_found" }'}</code></td><td style={s.td}>指定IDで該当なし</td></tr>
          <tr><td style={s.td}>5xx</td><td style={s.td}><code style={s.code}>{'{ "ok": false, "error": "..." }'}</code></td><td style={s.td}>一時的なエラー（リトライ可）</td></tr>
        </tbody>
      </table>

      {/* クラブ一覧 */}
      <h2 style={s.h2}>1. クラブ一覧</h2>
      <p style={s.p}>KnowBase に登録されたクラブ（店舗）の一覧。<b>閉店店舗も含めて</b>返し、各店に閉店フラグが付きます。</p>
      <Endpoint method="GET" path="/api/public/clubs" />
      <h3 style={s.h3}>クエリパラメータ</h3>
      <table style={s.table}>
        <thead><tr><th style={s.th}>名前</th><th style={s.th}>必須</th><th style={s.th}>説明</th></tr></thead>
        <tbody>
          <tr><td style={s.td}><code style={s.code}>clubCode</code></td><td style={s.td}>–</td><td style={s.td}>指定時は該当1店のみ返す</td></tr>
          <tr><td style={s.td}><code style={s.code}>brand</code></td><td style={s.td}>–</td><td style={s.td}><code style={s.code}>FIT365</code> / <code style={s.code}>JOYFIT</code> で絞り込み</td></tr>
          <tr><td style={s.td}><code style={s.code}>companyCode</code></td><td style={s.td}>–</td><td style={s.td}>経営企業コードで絞り込み（例 <code style={s.code}>1</code>=オカモト、<code style={s.code}>1002</code>=ヤマウチ 等）</td></tr>
          <tr><td style={s.td}><code style={s.code}>includeClosed</code></td><td style={s.td}>–</td><td style={s.td}><code style={s.code}>0</code> で閉店店舗を除外（既定は閉店も含む）</td></tr>
          <tr><td style={s.td}><code style={s.code}>formCodes</code></td><td style={s.td}>–</td><td style={s.td}>契約形態コードのカンマ区切り（例 <code style={s.code}>2052,711</code>）。<b>その主契約を契約できる店舗だけ</b>に絞り込む（法人入会の店舗一覧用）。各店が実際に扱う該当コードを <code style={s.code}>matchedFormCodes</code> で返す</td></tr>
          <tr><td style={s.td}><code style={s.code}>formMatch</code></td><td style={s.td}>–</td><td style={s.td}><code style={s.code}>any</code>（既定・いずれかを扱う） / <code style={s.code}>all</code>（指定コード全てを扱う店舗のみ）。<code style={s.code}>formCodes</code> 指定時のみ有効</td></tr>
        </tbody>
      </table>
      <h3 style={s.h3}>レスポンス例</h3>
      <pre style={s.pre}>{`GET ${BASE}/api/public/clubs

{
  "ok": true,
  "count": 463,
  "openCount": 353,
  "closedCount": 110,
  "clubs": [
    {
      "clubCode": "228",
      "clubName": "FIT365天童",
      "brand": "FIT365",
      "businessType": "FIT365",
      "closed": false,
      "managementCompanyCode": "1002",
      "companyName": "ヤマウチ"
    }
  ]
}`}</pre>
      <h3 style={s.h3}>フィールド</h3>
      <table style={s.table}>
        <thead><tr><th style={s.th}>フィールド</th><th style={s.th}>説明</th></tr></thead>
        <tbody>
          <tr><td style={s.td}><code style={s.code}>clubCode</code></td><td style={s.td}>クラブ（店舗）コード</td></tr>
          <tr><td style={s.td}><code style={s.code}>clubName</code></td><td style={s.td}>クラブ名称</td></tr>
          <tr><td style={s.td}><code style={s.code}>brand</code></td><td style={s.td}>ブランド（FIT365 / JOYFIT）。業態から正規化</td></tr>
          <tr><td style={s.td}><code style={s.code}>businessType</code></td><td style={s.td}>業態（FIT365 / 赤 / 青 / 緑 / ｼﾞｮｲﾌｨｯﾄﾌﾟﾗｽ 等）</td></tr>
          <tr><td style={s.td}><code style={s.code}>closed</code></td><td style={s.td}>閉店なら true</td></tr>
          <tr><td style={s.td}><code style={s.code}>managementCompanyCode</code></td><td style={s.td}>経営企業コード（未設定は <code style={s.code}>null</code>）</td></tr>
          <tr><td style={s.td}><code style={s.code}>companyName</code></td><td style={s.td}>経営企業名（未設定は <code style={s.code}>null</code>）</td></tr>
          <tr><td style={s.td}><code style={s.code}>matchedFormCodes</code></td><td style={s.td}><code style={s.code}>formCodes</code> 指定時のみ。その店が実際に契約可能な、要求コードのうちの契約形態コード配列</td></tr>
        </tbody>
      </table>
      <h3 style={s.h3}>契約形態コードで絞り込み（法人入会用）</h3>
      <p style={s.p}>法人の特定の主契約（契約形態）を扱う店舗だけを一覧したい場合に <code style={s.code}>formCodes</code> を使います。判定源は「クラブ別 契約会費金額」（そのクラブに会費行がある＝契約可能）です。</p>
      <pre style={s.pre}>{`GET ${BASE}/api/public/clubs?formCodes=2052,711&formMatch=any

{
  "ok": true,
  "count": 9,
  "formCodes": [2052, 711],
  "formMatch": "any",
  "clubs": [
    {
      "clubCode": "107",
      "clubName": "JOYFITBIO",
      "brand": "JOYFIT",
      "businessType": "赤",
      "closed": false,
      "managementCompanyCode": "1",
      "companyName": "オカモト",
      "matchedFormCodes": [711, 2052]
    }
  ]
}`}</pre>
      <div style={s.note}>※ 住所・都道府県はデータ未整備のため現時点では返しません（整備でき次第 追加）。</div>

      {/* 会費 */}
      <h2 style={s.h2}>2. 会費（クラブ別 契約会費金額）</h2>
      <p style={s.p}>クラブごとの会費（入会金 / 事務手数料 / 月会費）を <b>適用年月</b>付きで返します。<code style={s.code}>isLatest</code> で最新かどうかを判定できます。</p>
      <Endpoint method="GET" path="/api/public/fees?clubCode={クラブコード}" />
      <h3 style={s.h3}>クエリパラメータ</h3>
      <table style={s.table}>
        <thead><tr><th style={s.th}>名前</th><th style={s.th}>必須</th><th style={s.th}>説明</th></tr></thead>
        <tbody>
          <tr><td style={s.td}><code style={s.code}>clubCode</code></td><td style={s.td}>✅</td><td style={s.td}>クラブコード（例: 375）</td></tr>
          <tr><td style={s.td}><code style={s.code}>history</code></td><td style={s.td}>–</td><td style={s.td}><code style={s.code}>1</code> で全ての適用年月（改定履歴）を返す</td></tr>
          <tr><td style={s.td}><code style={s.code}>asOf</code></td><td style={s.td}>–</td><td style={s.td}><code style={s.code}>YYYYMM</code>。その年月時点で有効な会費を返す</td></tr>
        </tbody>
      </table>
      <p style={s.p}>
        「最新」の単位＝<code style={s.code}>(契約形態コード × 会費適用区分コード × 適用人数)</code>。同一単位で会費改定ごとに <code style={s.code}>適用年月</code> の異なる行があり、既定では各単位の最新（適用年月 最大）のみ返します。
      </p>
      <h3 style={s.h3}>レスポンス例</h3>
      <pre style={s.pre}>{`GET ${BASE}/api/public/fees?clubCode=375

{
  "ok": true,
  "clubCode": "375",
  "asOf": null,
  "history": false,
  "count": 112,
  "fees": [
    {
      "clubCode": 375,
      "formCode": 10,
      "formName": "レギュラー２",
      "feeApplyKubun": 1,
      "applyHeadcount": 1,
      "applyYearMonth": 201712,
      "isLatest": true,
      "amounts": {
        "enrollmentFee": 0,
        "adminFee": 0,
        "monthlyFee": 8227
      }
    }
  ]
}`}</pre>
      <h3 style={s.h3}>フィールド</h3>
      <table style={s.table}>
        <thead><tr><th style={s.th}>フィールド</th><th style={s.th}>説明</th></tr></thead>
        <tbody>
          <tr><td style={s.td}><code style={s.code}>clubCode</code></td><td style={s.td}>クラブ（店舗）コード</td></tr>
          <tr><td style={s.td}><code style={s.code}>formCode</code> / <code style={s.code}>formName</code></td><td style={s.td}>契約形態コード / 契約形態名</td></tr>
          <tr><td style={s.td}><code style={s.code}>feeApplyKubun</code></td><td style={s.td}>会費適用区分コード</td></tr>
          <tr><td style={s.td}><code style={s.code}>applyHeadcount</code></td><td style={s.td}>適用人数</td></tr>
          <tr><td style={s.td}><code style={s.code}>applyYearMonth</code></td><td style={s.td}>適用年月（YYYYMM の数値）</td></tr>
          <tr><td style={s.td}><code style={s.code}>isLatest</code></td><td style={s.td}>この単位で最新の適用年月なら true</td></tr>
          <tr><td style={s.td}><code style={s.code}>amounts.enrollmentFee</code></td><td style={s.td}>入会金</td></tr>
          <tr><td style={s.td}><code style={s.code}>amounts.adminFee</code></td><td style={s.td}>事務手数料</td></tr>
          <tr><td style={s.td}><code style={s.code}>amounts.monthlyFee</code></td><td style={s.td}>月会費</td></tr>
        </tbody>
      </table>

      {/* 規約 */}
      <h2 style={s.h2}>3. 規約</h2>
      <p style={s.p}>入会・利用にあたっての各種<b>規約</b>（利用規約 / 個人情報の取り扱い / プライバシーポリシー等）を、現行版の本文つきで返します。ブランドや掲出カテゴリ（Web入会 / 1DayPass 等）で絞り込めます。</p>
      <Endpoint method="GET" path="/api/public/terms" />
      <h3 style={s.h3}>クエリパラメータ</h3>
      <table style={s.table}>
        <thead><tr><th style={s.th}>名前</th><th style={s.th}>必須</th><th style={s.th}>説明</th></tr></thead>
        <tbody>
          <tr><td style={s.td}><code style={s.code}>brand</code></td><td style={s.td}>–</td><td style={s.td}><code style={s.code}>FIT365</code> / <code style={s.code}>JOYFIT</code> で絞り込み</td></tr>
          <tr><td style={s.td}><code style={s.code}>category</code></td><td style={s.td}>–</td><td style={s.td}>掲出カテゴリで絞り込み（例 <code style={s.code}>Web入会</code> / <code style={s.code}>1DayPass</code> / <code style={s.code}>Web/APP入会</code>）。<code style={s.code}>categories</code> に含む規約を返す</td></tr>
          <tr><td style={s.td}><code style={s.code}>termId</code></td><td style={s.td}>–</td><td style={s.td}>指定時は該当1件のみ返す（<code style={s.code}>{`{ ok, term }`}</code>）</td></tr>
        </tbody>
      </table>
      <h3 style={s.h3}>レスポンス例</h3>
      <pre style={s.pre}>{`GET ${BASE}/api/public/terms?brand=FIT365&category=1DayPass

{
  "ok": true,
  "count": 1,
  "brand": "FIT365",
  "category": "1DayPass",
  "terms": [
    {
      "termId": "RklUMzY1X1_vvJFEYXkgUGFzc-WIqeeUqOimj-e0hA",
      "brand": "FIT365",
      "baseTitle": "１Day Pass利用規約",
      "variants": [],
      "categories": ["1DayPass"],
      "updatedAt": "2026-01-15T09:00:00.000Z",
      "current": {
        "id": "v3",
        "label": "2026年1月版",
        "note": null,
        "createdAt": "2026-01-15T09:00:00.000Z",
        "contentByVariant": { "_default": "<h2>１Day Pass利用規約</h2> …本文…" }
      }
    }
  ]
}`}</pre>
      <h3 style={s.h3}>フィールド</h3>
      <table style={s.table}>
        <thead><tr><th style={s.th}>フィールド</th><th style={s.th}>説明</th></tr></thead>
        <tbody>
          <tr><td style={s.td}><code style={s.code}>termId</code></td><td style={s.td}>規約ID（一意）</td></tr>
          <tr><td style={s.td}><code style={s.code}>brand</code></td><td style={s.td}>ブランド（FIT365 / JOYFIT）</td></tr>
          <tr><td style={s.td}><code style={s.code}>baseTitle</code></td><td style={s.td}>規約タイトル</td></tr>
          <tr><td style={s.td}><code style={s.code}>categories</code></td><td style={s.td}>掲出カテゴリ配列（Web入会 / 1DayPass / KIOSK(…) 等）</td></tr>
          <tr><td style={s.td}><code style={s.code}>variants</code></td><td style={s.td}>バリアント（宛先/媒体別の版）識別子。無ければ <code style={s.code}>_default</code> のみ</td></tr>
          <tr><td style={s.td}><code style={s.code}>current</code></td><td style={s.td}>現行版。<code style={s.code}>label</code>（版名）・<code style={s.code}>createdAt</code>・<code style={s.code}>contentByVariant</code>（バリアント別の本文HTML）</td></tr>
          <tr><td style={s.td}><code style={s.code}>current.contentByVariant._default</code></td><td style={s.td}>既定バリアントの規約本文（HTML）</td></tr>
        </tbody>
      </table>

      <h2 style={s.h2}>呼び出し例（cURL）</h2>
      <pre style={s.pre}>{`# クラブ一覧(閉店含む)
curl -H "x-api-key: $KEY" "${BASE}/api/public/clubs"

# 経営企業コードで絞り込み
curl -H "x-api-key: $KEY" "${BASE}/api/public/clubs?companyCode=1"

# 特定の契約形態(主契約)を扱う店舗だけ(法人入会用): いずれか
curl -H "x-api-key: $KEY" "${BASE}/api/public/clubs?formCodes=2052,711"
# 指定コードを全て扱う店舗のみ
curl -H "x-api-key: $KEY" "${BASE}/api/public/clubs?formCodes=2052,711&formMatch=all"

# クラブ別 会費(最新)
curl -H "x-api-key: $KEY" "${BASE}/api/public/fees?clubCode=375"

# 規約(全件・現行版)
curl -H "x-api-key: $KEY" "${BASE}/api/public/terms"
# ブランド + 掲出カテゴリで絞り込み
curl -H "x-api-key: $KEY" "${BASE}/api/public/terms?brand=FIT365&category=1DayPass"`}</pre>
    </div>
  );
}
