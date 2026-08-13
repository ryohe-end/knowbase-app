# KnowBase 公開API 利用ガイド — クラブ別 契約会費金額

外部システム連携用の公開APIです。クラブ（店舗）ごとの会費（**入会金 / 事務手数料 / 月会費**）を、
**適用年月**付きで取得できます。`適用年月` と `isLatest` により「最新の会費かどうか」を判定できます。

> 本ドキュメントは外部連携先へ配布可能です。API キーは別途、安全な手段でお渡しします（本書には記載しません）。

---

## エンドポイント

```
GET https://<KnowBaseホスト>/api/public/fees?clubCode={クラブコード}
```

- 例（Amplify 既定ホスト）: `https://main.d187n04ni244en.amplifyapp.com/api/public/fees?clubCode=375`
- 独自ドメインを利用の場合は、そちらのホストに読み替えてください。

## 認証

`x-api-key` ヘッダに、お渡しした API キーを指定してください。

```
x-api-key: <お渡しした API キー>
```

## クエリパラメータ

| 名前 | 必須 | 型 | 説明 |
|---|---|---|---|
| `clubCode` | ✅ | number | クラブコード（例: `375`） |
| `history` | – | `1` | 全ての適用年月（会費改定履歴）を返す。既定は各会費の最新のみ |
| `asOf` | – | `YYYYMM` | その年月時点で有効な会費（`適用年月 <= asOf` の中の最新）を返す |

「最新」の単位＝`(契約形態コード × 会費適用区分コード × 適用人数)`。同一単位で会費改定ごとに
`適用年月` の異なる行が存在し、既定では各単位の最新（`適用年月` 最大）のみを返します。
`適用年月` には将来日付（予定改定）を含む場合があります。現時点の有効会費を厳密に取りたい場合は
`asOf=（当月）` を指定してください。

---

## レスポンス例

```
GET /api/public/fees?clubCode=375
x-api-key: <API キー>
```

```json
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
}
```

### フィールド

| フィールド | 説明 |
|---|---|
| `clubCode` | クラブ（店舗）コード |
| `formCode` / `formName` | 契約形態コード / 契約形態名 |
| `feeApplyKubun` | 会費適用区分コード |
| `applyHeadcount` | 適用人数 |
| `applyYearMonth` | 適用年月（`YYYYMM` の数値） |
| `isLatest` | この単位で最新の適用年月なら `true` |
| `amounts.enrollmentFee` | 入会金 |
| `amounts.adminFee` | 事務手数料 |
| `amounts.monthlyFee` | 月会費 |

### エラー

| ステータス | body | 条件 |
|---|---|---|
| 400 | `{ "ok": false, "error": "clubCode is required" }` | `clubCode` 欠落 |
| 401 | `{ "ok": false, "error": "unauthorized" }` | `x-api-key` 不正/欠落 |
| 502 | `{ "ok": false, "error": "..." }` | 一時的なバックエンドエラー（リトライ可） |

---

## 呼び出し例

### cURL
```sh
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d187n04ni244en.amplifyapp.com/api/public/fees?clubCode=375"

# 改定履歴を含めて取得
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d187n04ni244en.amplifyapp.com/api/public/fees?clubCode=375&history=1"

# 指定年月時点で有効な会費
curl -H "x-api-key: $KB_API_KEY" \
  "https://main.d187n04ni244en.amplifyapp.com/api/public/fees?clubCode=375&asOf=202608"
```

### Node.js (fetch)
```js
const res = await fetch(
  "https://main.d187n04ni244en.amplifyapp.com/api/public/fees?clubCode=375",
  { headers: { "x-api-key": process.env.KB_API_KEY } }
);
const data = await res.json();
```

---

## 注意事項

- API キーは秘密情報です。第三者に共有しないでください。漏洩時は運営へご連絡ください（キーを無効化・再発行します）。
- 短時間の大量リクエストはお控えください。
- 返却される金額は円単位の整数です（`null` は未設定を表します）。
