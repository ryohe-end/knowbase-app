# 公開API 仕様書 — クラブ別 契約会費金額 (`/api/public/fees`)

外部システム向け公開API。クラブ（店舗）ごとの会費（**入会金 / 事務手数料 / 月会費**）を、**適用年月**付きで返す。
`適用年月` と `isLatest` により「最新の会費かどうか」を判定できる。

- 認証: `x-api-key` ヘッダ（環境変数 `KB_PUBLIC_API_KEY` と照合）
- データソース: Oracle adb01 `FIT_ADMIN.契約会費金額`（`knowbie_ro`、read-only）
- 実装: Next.js route `app/api/public/fees/route.ts` → member-search Lambda `type:"club-fees"`

---

## エンドポイント

```
GET /api/public/fees?clubCode={クラブコード}[&history=1][&asOf=YYYYMM]
Header: x-api-key: <KB_PUBLIC_API_KEY>
```

### クエリパラメータ

| 名前 | 必須 | 型 | 説明 |
|---|---|---|---|
| `clubCode` | ✅ | number | クラブコード（例: `375`） |
| `history` | – | `1`/`true` | 指定時は全ての適用年月（会費改定履歴）を返す。既定は最新のみ |
| `asOf` | – | `YYYYMM` | その年月時点で有効な会費（`適用年月 <= asOf` の中の最新）を返す |

### 返却の粒度と「最新」の定義

1行 = `(契約形態コード × 会費適用区分コード × 適用人数 × 適用年月)`。
同一 `(契約形態コード, 会費適用区分コード, 適用人数)` に対し、会費改定ごとに `適用年月` の異なる行が複数存在する。

- **既定（`history` なし）**: 各キーの `適用年月` 最大の行のみ（`isLatest=true`）
- **`history=1`**: 全履歴。各行の `isLatest` で最新版かどうか判定
- **`asOf=YYYYMM`**: `適用年月 <= asOf` に絞った上での各キー最新（＝その時点の有効会費）

> 注: `適用年月` には将来日付（予定改定）も含まれる。`asOf` を使うと「現時点の有効会費」を安全に取得できる。

---

## レスポンス

### 200 OK

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

### フィールド定義

| フィールド | 元カラム | 説明 |
|---|---|---|
| `clubCode` | クラブコード | クラブ（店舗）コード |
| `formCode` | 契約形態コード | 契約形態コード |
| `formName` | 契約形態.契約形態名 | 契約形態名（例: レギュラー） |
| `feeApplyKubun` | 会費適用区分コード | 会費適用区分 |
| `applyHeadcount` | 適用人数 | 適用人数（グループ契約等） |
| `applyYearMonth` | 適用年月 | 適用年月（`YYYYMM` の数値） |
| `isLatest` | – | このキーで最新の適用年月なら `true` |
| `amounts.enrollmentFee` | 入会金 | 入会金 |
| `amounts.adminFee` | 事務手続料金 | 事務手数料 |
| `amounts.monthlyFee` | 月会費 | 月会費 |

### エラー

| ステータス | body | 条件 |
|---|---|---|
| 400 | `{ ok:false, error:"clubCode is required" }` | `clubCode` 欠落 |
| 401 | `{ ok:false, error:"unauthorized" }` | `x-api-key` 不一致 |
| 503 | `{ ok:false, error:"public_api_not_configured" }` | `KB_PUBLIC_API_KEY` 未設定 |
| 502 | `{ ok:false, error:"..." }` | member-search 呼び出し失敗 |

---

## 使用例

```sh
# 最新の会費のみ
curl -H "x-api-key: $KEY" "https://<host>/api/public/fees?clubCode=375"

# 改定履歴を含む全件
curl -H "x-api-key: $KEY" "https://<host>/api/public/fees?clubCode=375&history=1"

# 2026年8月時点で有効な会費
curl -H "x-api-key: $KEY" "https://<host>/api/public/fees?clubCode=375&asOf=202608"
```

---

## 運用メモ

- `FIT_ADMIN.契約会費金額` は adb01 が毎晩リストアされるため、`knowbie_ro` への `GRANT SELECT` を
  `lambdas/post-restore-setup/index.mjs` の `roTables` に登録済み（リストア後も維持される）。
- member-search Lambda（`knowbie-member-search`）に `type:"club-fees"` ハンドラを追加。
  **ハンドラ更新時は Lambda の再デプロイが必要**（`cd lambdas/member-search && zip -r function.zip . -x function.zip && aws lambda update-function-code --function-name knowbie-member-search --zip-file fileb://function.zip`）。
- テーブル規模: 約505万行・488クラブ・適用年月 200209〜202912。
