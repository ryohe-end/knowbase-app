# 公開API 仕様書 — 規約 (`/api/public/terms`)

外部システム向け公開API。入会・利用にあたっての各種**規約**（利用規約 / 個人情報の取り扱い / プライバシーポリシー / あんしんサポート / 特定商取引法に基づく表示 等）を、**現行版の本文つき**で返す。
ブランドや掲出カテゴリ（`Web入会` / `1DayPass` 等）で絞り込める。

- 認証: `x-api-key` ヘッダ（環境変数 `KB_PUBLIC_API_KEY` と照合）
- データソース: DynamoDB `yamauchi-StoreTerms`（us-east-1 / 店舗設定「規約」管理と同一）
- 実装: Next.js route `app/api/public/terms/route.ts`（Lambda 経由なし。DDB を直接 Scan）
- 関連: [クラブ一覧API](./public-api-clubs-spec.md) / [会費API](./public-api-fees-spec.md)

---

## エンドポイント

```
GET /api/public/terms[?brand=][&category=][&termId=]
Header: x-api-key: <KB_PUBLIC_API_KEY>
```

### クエリパラメータ

| 名前 | 必須 | 型 | 説明 |
|---|---|---|---|
| `brand` | – | `FIT365`/`JOYFIT` | ブランドで絞り込み |
| `category` | – | string | 掲出カテゴリで絞り込み（`categories[]` に含むもの）。例: `Web入会` / `1DayPass` / `Web/APP入会` |
| `termId` | – | string | 指定時は該当1件のみ返す（`{ ok, term }`）。無ければ 404 |

> 既定（パラメータなし）は全規約の**現行版のみ**を返す。

### 掲出カテゴリ（`categories`）の値

現状データに存在する値: `Web入会` / `1DayPass` / `Web/APP入会` / `KIOSK（桃）` / `KIOSK（ワイド）` / `KIOSK（黄）` / `KIOSK入会` / `KIOSK(QRコード読み取り)` / `各種お手続き`。
（規約は店舗設定「規約」管理でカテゴリ付与されるため、値は今後増減しうる。全カテゴリを列挙したい場合は全件取得して `categories` を集約する。）

---

## レスポンス

### 200 OK（一覧）

```json
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
        "contentByVariant": { "_default": "<h2>１Day Pass利用規約</h2> …本文HTML…" }
      }
    }
  ]
}
```

> `brand` / `category` は指定時のみエコーバックする。

### 200 OK（`termId` で1件指定時）

```json
{ "ok": true, "term": { "termId": "…", "brand": "JOYFIT", "baseTitle": "ご利用規約", "current": { "contentByVariant": { "_default": "…" } } } }
```

### フィールド定義

| フィールド | 説明 |
|---|---|
| `termId` | 規約ID（一意） |
| `brand` | ブランド（`FIT365` / `JOYFIT`） |
| `baseTitle` | 規約タイトル |
| `categories` | 掲出カテゴリ配列（`Web入会` / `1DayPass` / `KIOSK(…)` 等） |
| `variants` | バリアント（宛先/媒体別の版）識別子。無ければ本文は `_default` のみ |
| `updatedAt` | 規約レコードの更新時刻（ISO8601） |
| `current` | 現行版（`isCurrent` の版。無ければ最新版） |
| `current.id` / `current.label` | 版ID / 版名（例: 「2026年1月版」） |
| `current.createdAt` | 版の作成時刻 |
| `current.contentByVariant` | バリアント別の規約本文（HTML）。既定は `_default` |

### エラー

| ステータス | body | 条件 |
|---|---|---|
| 401 | `{ ok:false, error:"unauthorized" }` | `x-api-key` 不一致 |
| 404 | `{ ok:false, error:"not_found" }` | `termId` 指定で該当なし |
| 503 | `{ ok:false, error:"public_api_not_configured" }` | `KB_PUBLIC_API_KEY` 未設定 |
| 500 | `{ ok:false, error:"..." }` | DynamoDB 読み取り失敗 |

---

## 使用例

```sh
# 全規約(現行版)
curl -H "x-api-key: $KEY" "https://<host>/api/public/terms"

# ブランド + 掲出カテゴリで絞り込み(例: FIT365 の 1DayPass)
curl -H "x-api-key: $KEY" "https://<host>/api/public/terms?brand=FIT365&category=1DayPass"

# Web入会で掲出する JOYFIT の規約一式
curl -H "x-api-key: $KEY" "https://<host>/api/public/terms?brand=JOYFIT&category=Web入会"

# 規約1件(本文つき)
curl -H "x-api-key: $KEY" "https://<host>/api/public/terms?termId=<termId>"
```

---

## 運用メモ

- 規約は店舗設定の「規約」管理（`/store-settings/terms`）で編集する。本APIは**現行版**（`isCurrent`）のみを返す。
- 本文は HTML。バリアント（`contentByVariant` のキー）は宛先/媒体別に分岐した版で、無い場合は `_default` のみ。
- Next.js route のため Lambda 再デプロイは不要。**Amplify デプロイ（main マージ）で反映**。
- Amplify SSR ロールに `yamauchi-StoreTerms` への `dynamodb:Scan` 権限が必要（店舗設定「規約」管理と同一テーブルのため既に付与済み）。
- Web版リファレンス（クラブ / 会費 / 規約を1ページに集約）: `/api-reference`。
