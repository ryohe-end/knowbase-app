# 公開API: 契約形態（クラブ別 契約可能な契約） `/api/public/contracts`

外部入会システム向け。クラブごとの「契約できる契約形態（主契約）」を返す。`x-api-key` 認証。

- データソース: Oracle adb01 `FIT_ADMIN.契約形態`（マスタ）＋`FIT_ADMIN.会員契約`/`会員契約明細`（直近入会実績）。読取専用 `knowbie_ro`。
- knowbie側オーバーレイ: DynamoDB `knowbie-club-contract-settings`（`clubCode`×`contractFormCode`）。Oracleマスタに無い項目を補完。

## リクエスト

```
GET /api/public/contracts?clubCode=1307[&sinceMonths=12]
Header: x-api-key: <KB_PUBLIC_API_KEY>
```

| パラメータ | 必須 | 既定 | 説明 |
|---|---|---|---|
| `clubCode` | ○ | – | クラブ（店舗）コード |
| `sinceMonths` | – | `12` | 直近 N ヶ月の入会実績から「契約可能な契約形態」を近似導出する期間（1〜60） |

### `sinceMonths` の意味（9/2 寺崎）
契約形態マスタ自体はクラブ非依存のため、**「そのクラブで直近 `sinceMonths` ヶ月に実際に契約された契約形態」**を、入会実績（`会員区分コード IN (1,7,70)`）から近似導出する。
`derivation.approximate=true` で近似であることを明示。**募集状態そのもの（今月から新規募集／先月末で募集停止）は表現できない**（前者は実績が無く出ない／後者は実績が残り出る）。募集状態の権威マスタが提供されれば置換する。暫定の運用上の募集ON/OFFは `recruiting`（オーバーレイ）で上書き可能。

## レスポンス（`contracts[]` の各要素）

| フィールド | 由来 | 説明 |
|---|---|---|
| `code` | 契約形態コード | 契約形態コード |
| `name` | 契約形態名 | 契約形態名 |
| `memberKubun` | 会員区分コード | `1`:フィットネス(主) / `7`:スタッフ / `8`:タイム / `70`:法人個人 / `90`:オプション(ロッカー類) 等 |
| `termMonths` | 有効期限 | 契約期間（月数相当） |
| `flags.school` / `groupDiscount` / `pausable` | 各フラグ | スクール/グループ割引可/休会可 |
| `monthlyUses` / `yearlyUses` | 月間/年間利用可能回数 | |
| `productCodes.deposit` | 保証金商品コード | **預り金**。契約形態マスタ元来の項目。`null`=保証金設定なし（請求なし）。新規実装不要（9/2 寺崎） |
| `productCodes.enrollment` / `adminFee` / `monthlyFee` / `annualFee` | 各商品コード | 入会金/事務手続料金/会費/年管理費 の商品コード |
| `sortNo` | ソートNO | |
| `recentSignups` / `latestSignupDate` | 集計 | 直近 `sinceMonths` の新規契約数 / 直近入会届出日 |
| `prorated` | **固定ルール** | **日割り**（9/17 寺崎）。主契約（`memberKubun∈{1,7,8,70}`）=`true` / オプション=`false`。ルール固定で可変にしない |
| `description` | オーバーレイ | **説明文**（9/17 寺崎）。マスタに列が無く、`knowbie-club-contract-settings` の入力値。未入力=`null` |
| `isPreOpenContract` | オーバーレイ | **プレオープンを表現する契約か**（9/17 寺崎）。マスタに判別列が無く、knowbie入力。未入力=`null` |
| `familyAllowed` | オーバーレイ | **家族会員を作れる契約か**（9/17 寺崎）。マスタに列が無く、knowbie入力。未入力=`null` |
| `recruiting` | オーバーレイ | 募集ON/OFF（契約別）。knowbie入力。未入力=`null`（＝近似導出に委ねる） |
| `penalty` | オーバーレイ | 違約金（円）。knowbie入力。未入力=`null` |

### オーバーレイ項目の入力
`description`/`isPreOpenContract`/`familyAllowed`/`recruiting`/`penalty` は Oracle マスタに存在しないため、**knowbase の「店舗設定 > 入会管理（契約別設定）」画面**（`/store-settings/contract-settings`）で契約形態ごとに入力する。入力が唯一の供給源で、未入力は `null`。

## オプション一覧 `options[]`（9/17 寺崎）

同じ `/contracts` 応答に**フラットなクラブ別オプション一覧**を同梱する（`?options=0` で抑止）。
源 = `FIT_ADMIN.契約会費金額`（クラブ×契約形態に会費行がある＝提供）× `契約形態`（`会員区分コード=90`）。member-search の type=`club-options`。

| フィールド | 説明 |
|---|---|
| `code` / `name` | オプションの契約形態コード / 名称（例: 契約ロッカー、オンラインレッスン、栄養カウンセリング、タンニング） |
| `memberKubun` | `90`（オプション） |
| `productCodes.*` | 保証金/入会金/事務/会費/年管理費 の商品コード |
| `prorated` | `false`（オプションは日割りなし・固定ルール） |

`optionCount` に件数も返す。

### 未対応（要・仕様合意）: 主契約への紐づけ・提供スコープ
寺崎さん想定の「オプション一覧（キー: クラブ&主契約）」「法人のみ/プレミアムのみ/家族のみ」のスコープは、
**現データ（`契約形態`）に該当構造が無い**（オプションは主契約や会員種別に紐づかない）。
これらが必要なら、**入会管理オーバーレイを拡張**して「オプション×対象主契約×スコープ」を knowbase で手入力する運用になる（源データが無いため入力が唯一の供給源）。実装前にパートナー合意が必要。
