# KnowBase 公開API 利用ガイド — クラブ一覧

外部システム連携用の公開APIです。KnowBase に登録されたクラブ（店舗）の一覧を取得できます。
**閉店店舗も含めて**返し、各店に閉店フラグ（`closed`）が付きます。

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
| `includeClosed` | – | `0` | `0` を指定すると閉店店舗を除外（既定は閉店も含む） |

## レスポンス例

```
GET /api/public/clubs
x-api-key: <API キー>
```

```json
{
  "ok": true,
  "count": 463,
  "openCount": 353,
  "closedCount": 110,
  "clubs": [
    {
      "clubCode": "107",
      "clubName": "JOYFITBIO",
      "brand": "JOYFIT",
      "businessType": "青",
      "closed": true
    },
    {
      "clubCode": "228",
      "clubName": "FIT365天童",
      "brand": "FIT365",
      "businessType": "FIT365",
      "closed": false
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
| `closed` | 閉店なら `true`、営業中なら `false` |

### エラー

| ステータス | body | 条件 |
|---|---|---|
| 401 | `{ "ok": false, "error": "unauthorized" }` | `x-api-key` 不正/欠落 |
| 404 | `{ "ok": false, "error": "not_found" }` | `clubCode` 指定で該当なし |
| 502 | `{ "ok": false, "error": "..." }` | 一時的なエラー（リトライ可） |

## 呼び出し例

```sh
# 全店(閉店含む)
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/public/clubs"

# 営業中のみ
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/public/clubs?includeClosed=0"

# FIT365 のみ
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/public/clubs?brand=FIT365"

# 1店
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/public/clubs?clubCode=375"
```
