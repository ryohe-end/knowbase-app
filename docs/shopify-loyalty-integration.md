# Shopify ⇄ CPSS ポイント連携 設計（FIT365 オンラインショップ）

Shopify テーマ（Dawn 15.4.1 / `minefit-onlineshop`）と CPSS ポイントSaaS を連携させ、
会員番号の紐付け・ランク/残高表示・ポイント付与/利用を実現するための設計。

- 連携先 CPSS 仕様: [`cpss-api-spec.md`](./cpss-api-spec.md)
- 既存資産（本リポジトリ = knowbie-frontend / Next.js 15 App Router）
  - `lib/cpss.ts` … CPSS API クライアント（`getMemberForApp` / `givePoint` / `usePoint` / `cancelPoint` / `addMember` / `updateMember` 等）
  - `lib/cpssProxy.ts` … 固定egress Lambda `knowbie-cpss-proxy`（EIP `34.199.173.5`）を invoke する `cpssCall(brand, env, action, args)`
  - CPSS は**送信元IPホワイトリスト制**のため、Shopify連携も必ずこのプロキシ経由で叩く（新規IP登録を避ける）

---

## 1. 全体構成

```
[Shopify テーマ]                         [knowbie-frontend (Next.js App Router)]        [AWS / CPSS]
 register / account  ──App Proxy──▶  app/api/shopify/loyalty/*  ──cpssCall()──▶  cpss-proxy Lambda ──▶ CPSS
 (customer-membership.js)            (HMAC署名検証)                                 (固定IP 34.199.173.5)
        ▲                                    │
        └──── customer.metafields ◀── Shopify Admin API (metafields 書込) ◀────────┘
```

- **App Proxy**: Shopify 管理画面でカスタムアプリに App Proxy を設定し、`/apps/loyalty/*`（ストアフロント）→ `https://<knowbie-frontend>/api/shopify/loyalty/*` に転送。
- リクエストは Shopify が**署名（HMAC / `signature` クエリ）**するため、バックエンドで必ず検証する。
- ログイン中は App Proxy が `logged_in_customer_id` を付与 → これで顧客を安全に特定できる。

---

## 2. 識別子の解決（既存コード調査で確定）

**会員番号だけあれば aid・clubCode(shopid) はすべて導出できる。追加のマッピング不要。**

| 項目 | 結論 | 根拠（既存実装） |
|---|---|---|
| **会員番号 → CPSS `aid`** | **等価。変換不要**。会員番号をそのまま `aid` に渡す。 | `app/api/store-settings/points/member/route.ts:137` `getMemberForApp({ aid: memberCode })`、`bulk-grant/route.ts:91` `givePoint({ aid: memberCode })` |
| **会員番号フォーマット** | `^\d{4,}$`（4桁以上の数字）。テーマ入力・バックエンド双方で検証。 | `bulk-grant/route.ts:64` `/^\d{4,}$/` |
| **`shopid`（EC）** | `resolveHomeClub(memberCode)` で会員の所属クラブを導出し、`cpssShopId()` で本番6桁ゼロ埋め。EC専用 shopid を別採番するかは運用判断（下記 Q2）。 | `lib/clubScope.ts:106` `resolveHomeClub`（会員番号先頭3/4桁→club、衝突時 `app_user.member_id` で確定）、`bulk-grant/route.ts:25` `cpssShopId` |
| **冪等 `reqid`** | 付与は `sfy-order-{orderId}`、利用は `sfy-use-{customerId}-{cartToken}`。 | 既存踏襲（bulk-grant は `${batchId}-${memberCode}`） |

→ **`/link` での会員実在チェックは `getMemberForApp({ aid: 会員番号, shopid: cpssShopId(resolveHomeClub(会員番号)) })` を叩くだけ**でよい。
　CPSS 呼び出し・shopid 導出・冪等の実装は `app/api/store-settings/points/*` が実例として流用可能。

## 2a. 検証済み CPSS 実データ（stg/prod で `getMemberForApp` 実行、2026-09）

固定IP Lambda を直接 invoke して確認（テスト会員番号 `1356005646`）:
```
aws lambda invoke --function-name knowbie-cpss-proxy --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"brand":"FIT365","env":"prod","action":"getMemberForApp","args":{"aid":"1356005646","cumulus":true,"expires":true}}' out.json
```
- **プロキシ Lambda は us-east-1**（EIP `34.199.173.5`）。ap-northeast-1 には存在しない。
- **会員番号=aid を実証**: `aid:"1356005646"` で照会成功（result.aid は `"1356005646:USR"`）。
- **会員不在は `code="003-001-000"`「指定された会員が存在しません」**で返る（空resultではない）。→ `fetchLoyalty` はこれを非会員(`exists:false`)として扱い、真の障害と区別する。
- **ランク体系（`result.rankinfos`）**:

  | rank コード | rankname | 到達ポイント |
  |---|---|---|
  | `0001` | ブロンズ | 0〜999 |
  | `0002` | シルバー | 1,000〜4,999 |
  | `0003` | ゴールド | 5,000〜19,999 |
  | `0004` | プラチナ | 20,000〜 |

  → メタフィールド `loyalty.rank`=コード / `loyalty.rank_name`=名称。バッジは rank名の自動判定で一致（既定マッピングにコード 0001〜0004 も設定済み）。
- stg にはこの会員は存在しない（stg/prod で会員データが別）。実会員テストは prod 会員番号が必要。

## 2b. 残る運用確認事項

| # | 項目 | 内容 | 影響 |
|---|---|---|---|
| Q2 | **EC の付与先 shopid** | EC購入のポイント付与を「会員の所属クラブ(`resolveHomeClub`)」に付けるか、**EC専用 clubCode を新設**して付けるか（売上/実績の帰属先の問題）。照合(read)は所属クラブで十分。 | Phase 3（付与）。照合・表示には影響小 |
| Q3 | **付与ルール** | 購入金額→ポイントの換算率、付与タイミング（`orders/paid` か発送後か）、対象外商品の有無。 | Phase 3 |
| Q4 | **利用（減算）方式** | チェックアウトでのポイント利用を「ポイント→割引クーポン変換」か「Shopify Functions 割引」か。決済失敗時の `cancel_point` 補償設計。 | Phase 3 |
| Q5 | **顧客アカウント種別** | Classic 前提。New customer accounts なら登録/アカウント画面のテーマ改修（Phase 1）が無効。 | Phase 1 全体 |

---

## 3. データモデル（Shopify 顧客メタフィールド）

管理画面 > 設定 > カスタムデータ > 顧客 に定義（ストアフロント表示を有効化）:

| namespace.key | 型 | 内容 | 更新元 |
|---|---|---|---|
| `loyalty.member_id` | single_line_text | 会員番号（＝CPSS `aid`。別途 aid を持つ必要なし） | 登録連携時に書込 |
| `loyalty.rank` | single_line_text | ランク（CPSS `rank` コード。バッジ判定キー） | 同期時 |
| `loyalty.rank_name` | single_line_text | ランク表示名（CPSS `rankname`） | 同期時 |
| `loyalty.points` | number_integer | ポイント残高 | 同期時 |
| `loyalty.synced_at` | date_time | 最終同期時刻（スロットル用） | 同期時 |

テーマ側（Phase 1 実装済み）は `sections/main-account.liquid` でこれらを**読み取り表示するだけ**。

---

## 4. 追加するエンドポイント（`app/api/shopify/loyalty/`）

すべて先頭で **App Proxy 署名検証**（`APP_PROXY_SHARED_SECRET` で HMAC-SHA256）を行う。

### 4.1 `POST /link` — 会員番号の検証＋紐付け（**FIT365会員限定ゲート**）
テーマの `customer-membership.js` が登録送信を**横取り**し、アカウント作成の前に `{ member_id, email }` を送る。
**この応答が `ok:true`（実在会員）のときだけ、JS が改めてフォームを送信してアカウントを作成する**（会員限定の要）。

1. `member_id` の形式検証（`^\d{4,}$`）。
2. CPSS `getMemberForApp({ aid: member_id, cumulus:true, expires:true })` で**会員実在チェック**。
   - 実在しない → `{ ok:false, reason:"not_found" }`（テーマは「会員番号が確認できません」を表示し登録を止める）
   - CPSS障害 → HTTP 502 `{ ok:false, error:"cpss_unavailable" }`（テーマは再試行を促し登録を止める）
3. 実在会員なら `{ email → member_id }` を短命ストア（DynamoDB TTL 15分）に保存し `{ ok:true }`。
4. アカウント作成後に `customers/create` webhook が email で照合し、メタフィールド `loyalty.*` を確定（下記 4.4）。

> **会員限定の担保**: 検証は同期ゲート。連携URL未設定時はテーマ側が登録を止める（検証不能なため）。
> **残存リスク**: JS 無効環境では標準フォームが直接送信され得る（Classic の制約）。サーバ側で完全担保するには、
> `customers/create` webhook で有効な紐付けが無い顧客をタグ付け/無効化する追加対応が必要（未実装・要判断）。

### 4.1b `POST /link-account` — マイページからの会員番号登録/変更（ログイン済み）
App Proxy 署名 + `logged_in_customer_id` 必須。顧客が確定しているため stash/webhook を介さず直書き。

1. `member_id` 形式検証（`^\d{4,}$`）。
2. CPSS `getMemberForApp` で実在チェック（非会員 → `{ ok:false, reason:"not_found" }`）。
3. 実在会員なら当該顧客へ `loyalty.*` を直書きし、`{ ok:true, rank, rank_name, points }` を返す。
4. テーマ（マイページの登録/変更フォーム）は成功時にページ再読込してバッジ等を反映。

### 4.2 `GET /status` — ランク/残高の取得（アカウント画面ライブ表示）
App Proxy 署名 + `logged_in_customer_id` 必須。

1. 顧客メタフィールド `loyalty.member_id` を Admin API で取得（＝aid）。`shopid = cpssShopId(resolveHomeClub(member_id))`。
2. `synced_at` が閾値（例 10分）以内ならメタフィールド値を返す（**CPSS を叩かない**＝レート保護）。
3. 古ければ `getMemberForApp({ aid: member_id, ptypes:"point", shopid, cumulus:true, expires:true })` を呼び、
   rank/balance をメタフィールドへ書き戻し（`synced_at` 更新）して返す。

> CPSS 仕様 §9「叩きすぎ厳禁」。必ずスロットル + メタフィールドキャッシュ。

### 4.2b 会員ランク割引（Shopify Functions・別リポジトリ `fit365-loyalty-discount`）
ログイン会員のランクに応じ、**対象商品タグ `member-discount`** 付き商品を自動割引する
プロダクト割引 Function。App Proxy とは別に **Shopify CLI アプリ**として `shopify app deploy`。

- 割引率: シルバー(0002)=3% / ゴールド(0003)=5% / プラチナ(0004)=10% / ブロンズ・非会員=0%
- 除外: 値下げ中（`compareAtPrice > 現価格`）＝セール品は対象外
- 判定: 顧客メタフィールド `loyalty.rank` を Function 入力で参照（読めない場合は顧客タグにフォールバック）
- 実装/手順: `fit365-loyalty-discount/`（`src/run.js`・`src/run.graphql`・`README.md`）
- 有効化: 管理画面「割引 > アプリ」or `discountAutomaticAppCreate` で自動割引として登録

### 4.3 ポイント利用（方式A：カート属性＋Function＋決済後 usePoint）**実装済み**
1pt=1円、ランク割引後の小計に充当、併用可。
1. **カート**（テーマ `snippets/loyalty-points-redeem.liquid`）: 会員が利用ポイントを入力 →
   カート属性 `loyalty_points_used` を `/cart/update.js` で設定（残高上限にキャップ）。
2. **注文割引 Function**（`fit365-loyalty-discount` の `member-points-redeem`）:
   `loyalty_points_used` を読み、小計上限で `fixedAmount` 割引を適用（チェックアウト表示）。
3. **`orders/paid`**: 注文の `note_attributes.loyalty_points_used` を読み `usePoint`
   （`reqid=sfy-use-{orderId}`、冪等）→ 残高更新・台帳(`used`, hid保存)。
4. **`orders/cancelled`**（§4.6）: 保存した hid で `cancelPoint`（利用戻し＋付与取消）。

> 残高検証はカート画面（メタフィールド／App Proxy）で行い、決済後に実残高で確定。
> Function は外部APIを呼べないため、悪意ある改ざんは `orders/paid` の `usePoint` 失敗で検知（要監視）。

### 4.6 `POST /webhooks/orders-cancelled` — 補償（**実装済み**）
台帳の `sfy-use-{id}` / `sfy-order-{id}` の hid を引き、`cancelPoint` で利用戻し・付与取消。冪等。

1. `logged_in_customer_id` → aid 解決。
2. 一意 `reqid` 採番（例 `sfy-use-{customerId}-{cartToken}`）。
3. `usePoint({ aid, shopid, point, reqid })` → 成功で `hid`/`balance` 取得。
4. 利用分を Shopify 割引（Functions もしくは自動生成クーポン）へ反映。
5. **決済失敗/離脱時は `cancelPoint({ hid, shopid, reqid, reason })` で補償**（Q4）。

### 4.4 Webhook `POST /webhooks/customers-create`
Shopify 管理でカスタムアプリに `customers/create` を登録。HMAC 検証必須。

1. payload の `email` で 4.1 の一時ストアから `member_id` を引く。
2. `getMemberForApp` で rank/balance 取得。
3. Admin API で当該顧客に `loyalty.member_id / aid / rank / points / synced_at` を書込。
4. （任意）CPSS 未登録会員なら `addMember` で登録・紐付け（Q1の運用次第）。

### 4.5 Webhook `POST /webhooks/orders-paid`（Phase 3・付与）
1. 注文の顧客 → aid 解決。会員番号未連携ならスキップ。
2. 付与ポイント算出（Q3ルール）。
3. `reqid = "sfy-order-" + order.id`（冪等）で `givePoint({ aid, shopid, point, reqid, scode, svalue })`。
4. 応答 `balance` でメタフィールド `loyalty.points` を更新。

---

## 5. セキュリティ / 冪等性

- **App Proxy 署名**: クエリ `signature` を全パラメータの HMAC-SHA256（アプリ shared secret）で検証。不一致は 401。
- **Webhook HMAC**: `X-Shopify-Hmac-Sha256` を検証。
- **顧客特定はサーバ側の `logged_in_customer_id` のみ信頼**。ボディの customer_id は信用しない。
- **`reqid` は付与/利用/取消で必ず一意**（CPSS 冪等 §3）。二重送信は `001-006-000`＝成功扱い。
- CPSS 呼び出しは全て `cpssCall("FIT365", env, action, args)` 経由（固定IP）。

---

## 6. 環境変数（knowbie-frontend 側）

| 変数 | 用途 | 既定 |
|---|---|---|
| `SHOPIFY_SHOP_DOMAIN` | 例 `minefit.myshopify.com` | — |
| `SHOPIFY_ADMIN_API_TOKEN` | メタフィールド読書き（Admin API） | — |
| `SHOPIFY_API_VERSION` | Admin API バージョン | `2025-01` |
| `SHOPIFY_APP_PROXY_SECRET` | App Proxy / Webhook 署名検証（アプリの Client secret） | — |
| `DYNAMO_SHOPIFY_LINK_TABLE` | email→会員番号 一時ストア | `fit365-ShopifyMemberLink` |
| `CPSS_BRAND` | CPSS ブランド | `FIT365` |
| `LOYALTY_POINT_RATE` | 購入時付与率（Phase 3, Q3） | `0.01` |
| `CPSS_EC_CLUBCODE` | EC専用付与先clubCode（Phase 3, Q2）。未設定なら会員の所属クラブ | （空） |
| （既存）`CPSS_ENV` | `stg`/`prod` | `stg` |
| （既存）`CPSS_PROXY_FUNCTION` | cpss-proxy Lambda 名 | `knowbie-cpss-proxy` |

CPSS 認証（`sid`/`spw`）は cpss-proxy Lambda 側が保持（本連携は Lambda 経由のみ）。

---

## 7. 実装順序

1. **Q1/Q2/Q5 の確定**（会員番号↔aid、EC shopid、アカウント種別）。
2. Shopify カスタムアプリ作成 → App Proxy 設定 → Admin API スコープ（`read_customers, write_customers`）。
3. 顧客メタフィールド定義（§3）。
4. `/link` + `customers/create` webhook（紐付け）→ テーマ設定「App Proxy 連携URL」に `/apps/loyalty/link` を設定。
5. `/status`（ランク/残高のライブ表示・スロットル）。
6. Phase 3: `orders/paid` 付与、`/use` 利用 + 補償。

---

## 7b. Phase 2 実装済みファイル（knowbie-frontend）

| ファイル | 役割 |
|---|---|
| `lib/shopify.ts` | App Proxy 署名検証 / Webhook HMAC 検証 / Admin API 顧客メタフィールド読書き・email検索 |
| `lib/shopifyLinkStore.ts` | email→会員番号 一時ストア（DynamoDB, TTL 15分） |
| `lib/loyaltyCpss.ts` | CPSS `getMemberForApp` ラッパー（会員実在・rank・balance） |
| `app/api/shopify/loyalty/link/route.ts` | `POST /apps/loyalty/link`（登録時の会員限定ゲート・実在チェック・stash） |
| `app/api/shopify/loyalty/link-account/route.ts` | `POST /apps/loyalty/link-account`（マイページからの会員番号登録/変更・直書き） |
| `app/api/shopify/loyalty/status/route.ts` | `GET /apps/loyalty/status`（ランク/残高のライブ取得・10分キャッシュ） |
| `app/api/shopify/loyalty/webhooks/customers-create/route.ts` | `customers/create` webhook（email 照合→メタフィールド確定） |
| `app/api/shopify/loyalty/webhooks/orders-paid/route.ts` | `orders/paid` webhook（購入時ポイント**付与**＋**利用(usePoint)**＋台帳、冪等） |
| `app/api/shopify/loyalty/webhooks/orders-cancelled/route.ts` | `orders/cancelled` webhook（利用戻し・付与取消 `cancelPoint`、冪等） |

### セットアップ手順
1. **Shopify カスタムアプリ**作成 → Admin API スコープ `read_customers, write_customers`。Admin API アクセストークンを `SHOPIFY_ADMIN_API_TOKEN` へ。
2. **App Proxy 設定**: Subpath prefix `apps` / Subpath `loyalty` / Proxy URL `https://<knowbie-frontend>/api/shopify/loyalty`。
   - `/apps/loyalty/link` → link route、`/apps/loyalty/status` → status route に対応。
3. **Webhook 登録**:
   - `customers/create` → `.../api/shopify/loyalty/webhooks/customers-create`
   - `orders/paid` → `.../api/shopify/loyalty/webhooks/orders-paid`（付与＋利用確定）
   - `orders/cancelled` → `.../api/shopify/loyalty/webhooks/orders-cancelled`（利用戻し・付与取消）
4. **顧客メタフィールド定義**（§3、ストアフロント表示ON）。
5. **DynamoDB テーブル** `fit365-ShopifyMemberLink`（PK `email` S、TTL属性 `ttl` 有効化）。
6. `SHOPIFY_APP_PROXY_SECRET` にアプリの Client secret を設定（App Proxy と Webhook 双方の署名検証に使用）。
7. **テーマ設定**: register セクション「App Proxy 連携URL」に `/apps/loyalty/link`、account セクション「App Proxy ステータスURL」に `/apps/loyalty/status`、「App Proxy 会員番号登録URL」に `/apps/loyalty/link-account`。

## 8. Phase 1（テーマ側）実装済み内容（`minefit-onlineshop`）

- `sections/main-register.liquid`: 会員番号**必須**入力欄（`pattern="\d{4,}"`）、FIT365会員限定の案内文、エラー表示欄、セクション設定「App Proxy 連携URL」。
- `assets/customer-membership.js`: 登録=**会員限定ゲート**。送信を横取りし `/apps/loyalty/link` で CPSS 照合、`ok:true` のときだけアカウント作成を実行。非会員/障害/URL未設定時はエラー表示して登録を止める。アカウント=`/apps/loyalty/status` で rank/points をライブ更新。
- `sections/main-account.liquid`: `customer.metafields.loyalty.*` のランクバッジ/残高/会員番号表示（`data-loyalty-status` でライブ更新対応）＋**マイページからの会員番号登録/変更フォーム**、セクション設定「App Proxy ステータスURL / 会員番号登録URL」＋ランクバッジ対応付け。
- `snippets/loyalty-rank-badge.liquid`: rank/rank_name→ティア判定し `assets/rank-{tier}.svg` を出力（明示マッピング→キーワード自動判定）。
- `snippets/loyalty-member-form.liquid`: マイページ用 会員番号 登録/変更フォーム（`/apps/loyalty/link-account` へ送信）。
- `assets/rank-{bronze,silver,gold,platinum}.svg`: ランクバッジ画像。
- `locales/{en.default,ja}.json`: `register.member_id` / `loyalty.*` 文言。

> ランクバッジのティア判定は rank コード/名称のキーワード自動判定が既定。CPSS の rank 値が
> bronze/silver/gold/platinum と異なる場合は、account セクション設定「〇〇に一致する値」に
> 実際の rank 値（例 `4,VIP`）をカンマ区切りで入れて対応付ける。
