# Shopify ⇄ CPSS 連携 セットアップ手順書（FIT365 EC）

一気通貫で動かすための操作手順。設計は [`shopify-loyalty-integration.md`](./shopify-loyalty-integration.md)。
**stg で通し確認 → prod** の順で進める。所要: 30〜60分。

前提: バックエンドは knowbie-frontend（Next.js/Amplify）に実装済み。CPSS 呼び出しは既存の
固定IP Lambda `knowbie-cpss-proxy`（us-east-1）を再利用するため、CPSS 認証情報の追加設定は不要。

---

## 0. 事前確認（ブロッカー Q5）
Shopify 管理画面 **設定 > 顧客アカウント** を開く。
- 「従来の顧客アカウント（Classic）」であること。
- 「新しい顧客アカウント（New）」の場合、テーマの登録/アカウント/マイページ改修は**表示されない**ため、
  この手順の前にアカウント方式の変更（または別UIの検討）が必要。→ 先に相談。

---

## 1. カスタムアプリ作成（Admin API トークン取得）
1. 管理画面 **設定 > アプリと販売チャネル > アプリを開発 > アプリを作成**。名前例「FIT365 Loyalty」。
2. **Configuration > Admin API integration** でスコープ:
   - `read_customers`, `write_customers`
3. **API credentials** で:
   - **Admin API access token**（`shpat_...`）を発行 → 後で `SHOPIFY_ADMIN_API_TOKEN`
   - **API secret key**（client secret）を控える → 後で `SHOPIFY_APP_PROXY_SECRET`
     （App Proxy 署名・Webhook HMAC の両方で使用）

---

## 2. App Proxy 設定
アプリの **Configuration > App proxy**:
- Subpath prefix: `apps`
- Subpath: `loyalty`
- Proxy URL: `https://<knowbie-frontendのドメイン>/api/shopify/loyalty`

これで下記が対応:
| ストアフロント | 転送先ルート |
|---|---|
| `/apps/loyalty/link` | 登録時の会員限定ゲート |
| `/apps/loyalty/link-account` | マイページからの登録/変更 |
| `/apps/loyalty/status` | ランク/残高ライブ取得 |

---

## 3. 顧客メタフィールド定義
管理画面 **設定 > カスタムデータ > 顧客 > 定義を追加**。名前空間.キー / 型:
| 名前空間とキー | 型 | ストアフロント表示 |
|---|---|---|
| `loyalty.member_id` | 1行テキスト | ON |
| `loyalty.rank` | 1行テキスト | ON |
| `loyalty.rank_name` | 1行テキスト | ON |
| `loyalty.points` | 整数 | ON |
| `loyalty.synced_at` | 日時 | ON |

※「ストアフロントでのアクセス」を必ず ON（テーマがLiquidで読むため）。

---

## 4. DynamoDB テーブル
- **新規**: `fit365-ShopifyMemberLink`
  - パーティションキー: `email`（文字列）
  - TTL: 属性名 `ttl` を有効化
- 既存流用: `yamauchi-PointTransactions`（付与台帳。env `DYNAMO_POINT_TRANSACTIONS_TABLE`）

作成例（AWS CLI, us-east-1）:
```
aws dynamodb create-table --region us-east-1 \
  --table-name fit365-ShopifyMemberLink \
  --attribute-definitions AttributeName=email,AttributeType=S \
  --key-schema AttributeName=email,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
aws dynamodb update-time-to-live --region us-east-1 \
  --table-name fit365-ShopifyMemberLink \
  --time-to-live-specification "Enabled=true, AttributeName=ttl"
```

---

## 5. 環境変数（knowbie-frontend / Amplify）
| 変数 | 値 |
|---|---|
| `SHOPIFY_SHOP_DOMAIN` | `<shop>.myshopify.com` |
| `SHOPIFY_ADMIN_API_TOKEN` | 手順1の `shpat_...` |
| `SHOPIFY_APP_PROXY_SECRET` | 手順1の API secret key |
| `SHOPIFY_API_VERSION` | `2025-01`（既定でも可） |
| `DYNAMO_SHOPIFY_LINK_TABLE` | `fit365-ShopifyMemberLink` |
| `CPSS_BRAND` | `FIT365` |
| `CPSS_ENV` | まず `stg`、本番切替時 `prod` |
| `LOYALTY_POINT_RATE` | 付与率（例 `0.01`） |
| `CPSS_EC_CLUBCODE` | EC専用clubCode（未設定なら会員の所属クラブに付与） |

※ `CPSS_PROXY_FUNCTION` / AWS 認証は既存の points 機能と同じ設定を流用（追加不要）。設定後 **再デプロイ**。

---

## 6. Webhook 登録（Admin API 経由で作成）
> HMAC をアプリの API secret で検証する実装のため、**管理画面の通知Webフックではなく Admin API で作成**する
> （通知Webフックは署名鍵が別）。以下を `<shop>` と `shpat_...` を置換して実行。

customers/create:
```
curl -s -X POST "https://<shop>.myshopify.com/admin/api/2025-01/graphql.json" \
 -H "X-Shopify-Access-Token: shpat_XXX" -H "Content-Type: application/json" \
 -d '{"query":"mutation{webhookSubscriptionCreate(topic:CUSTOMERS_CREATE,webhookSubscription:{callbackUrl:\"https://<knowbie>/api/shopify/loyalty/webhooks/customers-create\",format:JSON}){userErrors{message} webhookSubscription{id}}}"}'
```
orders/paid（Phase3・付与）:
```
curl -s -X POST "https://<shop>.myshopify.com/admin/api/2025-01/graphql.json" \
 -H "X-Shopify-Access-Token: shpat_XXX" -H "Content-Type: application/json" \
 -d '{"query":"mutation{webhookSubscriptionCreate(topic:ORDERS_PAID,webhookSubscription:{callbackUrl:\"https://<knowbie>/api/shopify/loyalty/webhooks/orders-paid\",format:JSON}){userErrors{message} webhookSubscription{id}}}"}'
```

---

## 7. テーマ設定（minefit-onlineshop）
テーマエディタ > 各セクションの設定:
- **登録（main-register）** > 「App Proxy 連携URL」= `/apps/loyalty/link`
- **アカウント（main-account）** >
  - 「App Proxy ステータスURL」= `/apps/loyalty/status`
  - 「App Proxy 会員番号登録URL」= `/apps/loyalty/link-account`
  - ランクバッジ対応付けは既定（0001〜0004）のままでOK

テーマは `shopify theme push`（Shopify CLI）またはGitHub連携で反映。

---

## 8. 一気通貫テスト（stg 環境で）
> stg には実会員が要る。stg の有効な会員番号を CPSS から用意（prod番号はstg不可）。

1. **会員限定ゲート**: ログイン画面「アカウントを作成する」→ 有効会員番号で登録 → アカウント作成成功。
   - 無効番号 → 「FIT365会員番号が確認できませんでした」で登録が**止まる**こと。
2. **紐付け確定**: 数秒後、管理画面で当該顧客の `loyalty.member_id/rank/rank_name/points` が入る（customers/create webhook）。
3. **アカウント表示**: マイページでランクバッジ＋ランク名＋ポイント表示。`/status` で最新化。
4. **マイページ登録**: 未連携アカウントで会員番号入力 → 即時反映（`/link-account`）。
5. **付与（Phase3）**: テスト注文を「支払い済み」に → `orders/paid` → `givePoint` → ポイント加算・台帳記録。
   - CPSS `test=1` は使わず stg 環境で実施（stgは実処理で安全に検証可）。

### 動作確認の小技
- App Proxy 疎通: ブラウザでログイン状態で `https://<shop>/apps/loyalty/status` を開く（署名付きで転送される）。
- CPSS 単体: `aws lambda invoke --function-name knowbie-cpss-proxy --region us-east-1 --cli-binary-format raw-in-base64-out --payload '{"brand":"FIT365","env":"stg","action":"getMemberForApp","args":{"aid":"<番号>","cumulus":true,"expires":true}}' out.json`

---

## 9. 本番切替
1. `CPSS_ENV=prod` に変更・再デプロイ。
2. prod 用に手順1〜7を prod ストアで再実施（アプリ/App Proxy/メタフィールド/Webhook/テーマ設定）。
3. 少額の実注文で付与まで確認（`reqid=sfy-order-{id}` で冪等）。
4. 監視: knowbie-frontend のログで `[shopify loyalty ...]` の失敗、Webhook 再送（5xx）を確認。

---

## 未了（別途）
- Phase3 **ポイント利用**（`/use`＋割引反映方式 Q4）は未実装。方式決定後に実装。
- JS無効環境での会員限定の完全担保（`customers/create` で未連携顧客のタグ付け等）は要判断。
