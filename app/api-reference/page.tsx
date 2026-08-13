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
        外部システム連携向けの公開APIです。本ページは、<b>クラブ一覧</b>と<b>会費</b>の2つのAPIをまとめたリファレンスです。
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
          <tr><td style={s.td}><code style={s.code}>includeClosed</code></td><td style={s.td}>–</td><td style={s.td}><code style={s.code}>0</code> で閉店店舗を除外（既定は閉店も含む）</td></tr>
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
      "closed": false
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
        </tbody>
      </table>
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

      <h2 style={s.h2}>呼び出し例（cURL）</h2>
      <pre style={s.pre}>{`# クラブ一覧(閉店含む)
curl -H "x-api-key: $KEY" "${BASE}/api/public/clubs"

# クラブ別 会費(最新)
curl -H "x-api-key: $KEY" "${BASE}/api/public/fees?clubCode=375"`}</pre>
    </div>
  );
}
