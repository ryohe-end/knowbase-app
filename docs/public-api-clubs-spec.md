# 公開API 仕様書 — クラブ一覧 (`/api/public/clubs`)

外部システム向け公開API。KnowBase に登録されたクラブ（店舗）の一覧を返す。**閉店店舗も含めて**返し、各店に閉店フラグが付く。
`formCodes`（契約形態コード配列）を指定すると、**その主契約を契約できる店舗だけ**に絞り込める（法人入会の店舗一覧表示用）。

- 認証: `x-api-key` ヘッダ（環境変数 `KB_PUBLIC_API_KEY` と照合）
- データソース: Oracle adb01 `FIT_ADMIN.クラブ情報`（一覧）/ `FIT_ADMIN.契約会費金額`（契約形態フィルタ）（`knowbie_ro`、read-only）
- 実装: Next.js route `app/api/public/clubs/route.ts` → member-search Lambda `type:"clubs-list"`

---

## エンドポイント

```
GET /api/public/clubs[?clubCode=][&brand=][&includeClosed=0][&formCodes=][&formMatch=]
Header: x-api-key: <KB_PUBLIC_API_KEY>
```

### クエリパラメータ

| 名前 | 必須 | 型 | 説明 |
|---|---|---|---|
| `clubCode` | – | number | 指定時は該当1店のみ返す（`{ ok, club }` を返す） |
| `brand` | – | `FIT365`/`JOYFIT` | ブランドで絞り込み（業態から正規化） |
| `includeClosed` | – | `0` | `0` で閉店店舗を除外。既定は閉店も含む |
| `formCodes` | – | string | 契約形態コードのカンマ区切り（例: `2052,711`）。**その主契約を契約できる店舗だけ**に絞る（法人入会用） |
| `formMatch` | – | `any`/`all` | `any`（既定・いずれかを扱う）/ `all`（指定コード全てを扱う店舗のみ）。`formCodes` 指定時のみ有効 |

### 契約形態コードによる絞り込み（法人入会用）

法人の特定の主契約（契約形態）を扱う店舗だけを一覧したい場合に `formCodes` を使う。
判定源は `FIT_ADMIN.契約会費金額`（**クラブ×契約形態に会費行がある＝そのクラブで契約可能**）。

- **`formMatch=any`（既定）**: 指定コードの**いずれか**を扱う店舗を返す
- **`formMatch=all`**: 指定コードを**全て**扱う店舗のみ返す
- 各店が実際に契約可能な、要求コードのうちの契約形態コードを `matchedFormCodes[]` で返す

例（実データ）: `formCodes=2052,711`（`2052`=法人会員 / `711`=コーポレートＶＩＰ）
→ `any` は 9 店、`all` は 1 店（両方扱う店舗のみ）。

---

## レスポンス

### 200 OK（一覧）

```json
{
  "ok": true,
  "count": 9,
  "openCount": 8,
  "closedCount": 1,
  "formCodes": [2052, 711],
  "formMatch": "any",
  "clubs": [
    {
      "clubCode": "107",
      "clubName": "JOYFITBIO",
      "brand": "JOYFIT",
      "businessType": "赤",
      "closed": false,
      "matchedFormCodes": [711, 2052]
    }
  ]
}
```

> `formCodes` / `formMatch` は指定時のみ返す。各 club の `matchedFormCodes` も `formCodes` 指定時のみ付与。

### 200 OK（`clubCode` で1店指定時）

```json
{ "ok": true, "club": { "clubCode": "375", "clubName": "…", "brand": "JOYFIT", "businessType": "赤", "closed": false } }
```

### フィールド定義

| フィールド | 元 | 説明 |
|---|---|---|
| `count` | – | 返却クラブ数 |
| `openCount` / `closedCount` | – | うち 開店 / 閉店 の数 |
| `clubCode` | クラブ情報.クラブコード | クラブ（店舗）コード |
| `clubName` | クラブ情報.クラブ名 | クラブ名称 |
| `brand` | 業態から正規化 | ブランド（`FIT365` / `JOYFIT`） |
| `businessType` | クラブ情報.業態 | 業態（FIT365 / 赤 / 青 / 緑 / ｼﾞｮｲﾌｨｯﾄﾌﾟﾗｽ 等） |
| `closed` | クラブ情報.閉店フラグ | 閉店なら `true`（`1`=閉店） |
| `matchedFormCodes` | 契約会費金額.契約形態コード | `formCodes` 指定時のみ。その店が実際に契約可能な、要求コードのうちの契約形態コード配列 |

> 住所・都道府県はデータ未整備のため現時点では返さない（整備でき次第 追加）。

### エラー

| ステータス | body | 条件 |
|---|---|---|
| 401 | `{ ok:false, error:"unauthorized" }` | `x-api-key` 不一致 |
| 404 | `{ ok:false, error:"not_found" }` | `clubCode` 指定で該当なし |
| 503 | `{ ok:false, error:"public_api_not_configured" }` | `KB_PUBLIC_API_KEY` 未設定 |
| 502 | `{ ok:false, error:"..." }` | member-search 呼び出し失敗 |

---

## 使用例

```sh
# クラブ一覧（閉店含む）
curl -H "x-api-key: $KEY" "https://<host>/api/public/clubs"

# 開店のみ / ブランド絞り込み
curl -H "x-api-key: $KEY" "https://<host>/api/public/clubs?includeClosed=0&brand=FIT365"

# 特定の契約形態（主契約）を扱う店舗だけ（法人入会用）: いずれか
curl -H "x-api-key: $KEY" "https://<host>/api/public/clubs?formCodes=2052,711"

# 指定コードを全て扱う店舗のみ
curl -H "x-api-key: $KEY" "https://<host>/api/public/clubs?formCodes=2052,711&formMatch=all"
```

---

## 運用メモ

- 契約形態フィルタの判定源 `FIT_ADMIN.契約会費金額` は adb01 が毎晩リストアされるため、`knowbie_ro` への
  `GRANT SELECT` を `lambdas/post-restore-setup/index.mjs` の `roTables` に登録済み（リストア後も維持）。
- member-search Lambda（`knowbie-member-search`）に `type:"clubs-list"`（`formCodes`/`formMatch` 対応）ハンドラを実装。
  **ハンドラ更新時は Lambda の再デプロイが必要**（`cd lambdas/member-search && zip -r function.zip index.mjs node_modules package.json package-lock.json && aws lambda update-function-code --function-name knowbie-member-search --zip-file fileb://function.zip`）。
- `契約形態コード` は `FIT_ADMIN.契約形態` のマスタ。名称は `type:"club-fees"`（[会費API](./public-api-fees-spec.md)）の `formName` でも確認できる。
- Web版リファレンス（クラブ＋会費を1ページに集約）: `/api-reference`。
