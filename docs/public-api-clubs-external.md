# KnowBase 公開API 利用ガイド — クラブ一覧

外部システム連携用の公開APIです。KnowBase に登録されたクラブ（店舗）の一覧を取得できます。

> 本ドキュメントは外部連携先へ配布可能です。API キーは別途、安全な手段でお渡しします（本書には記載しません）。
> ※ 住所・都道府県は現状データ未整備のため本APIでは返しません。整備でき次第、追加します。

---

## エンドポイント

```
GET https://main.d5z4bnw4wyrxn.amplifyapp.com/api/public/clubs
```

## 認証

```
x-api-key: <お渡しした API キー>
```

## クエリパラメータ

| 名前 | 必須 | 型 | 説明 |
|---|---|---|---|
| `clubCode` | – | number | 指定時は該当1店のみ返す |
| `brand` | – | `FIT365` \| `JOYFIT` | ブランドで絞り込み |

## レスポンス例

```
GET /api/public/clubs
x-api-key: <API キー>
```

```json
{
  "ok": true,
  "count": 465,
  "clubs": [
    {
      "clubCode": "228",
      "clubName": "FIT365天童",
      "brand": "FIT365",
      "businessType": "FIT365"
    },
    {
      "clubCode": "328",
      "clubName": "×吉祥寺",
      "brand": "JOYFIT",
      "businessType": "赤"
    }
  ]
}
```

`clubCode` を指定した場合は `{ "ok": true, "club": { ... } }` を返します。

### フィールド

| フィールド | 説明 |
|---|---|
| `clubCode` | クラブ（店舗）コード |
| `clubName` | クラブ名称 |
| `brand` | ブランド（`FIT365` / `JOYFIT`）。業態から正規化 |
| `businessType` | 業態（`FIT365` / `赤` / `青` / `緑` / `ｼﾞｮｲﾌｨｯﾄﾌﾟﾗｽ` 等の生値） |

### エラー

| ステータス | body | 条件 |
|---|---|---|
| 401 | `{ "ok": false, "error": "unauthorized" }` | `x-api-key` 不正/欠落 |
| 404 | `{ "ok": false, "error": "not_found" }` | `clubCode` 指定で該当なし |
| 500 | `{ "ok": false, "error": "..." }` | 一時的なエラー（リトライ可） |

## 呼び出し例

```sh
# 全店
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/public/clubs"

# FIT365 のみ
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/public/clubs?brand=FIT365"

# 1店
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/public/clubs?clubCode=375"
```
