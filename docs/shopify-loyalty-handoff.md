# FIT365 会員/ポイント連携 — 引き継ぎメモ（2026-09）

## 結論
**テーマ(UI)・バックエンド(処理)は完成し、エンドツーエンドで動作実証済み。**
残るは「Shopify の App Proxy と Admin API トークンの配線」だけ（＝コードでなく環境設定）。

---

## 動作実証（済）
公開トンネル経由で以下を通しで確認:
- 署名検証（不正署名→401）
- CPSS 実在チェック（無効番号→not_found、`003-001-000` を正しく処理）
- **有効会員 1356005646 → CPSS(prod)から実データ取得 → Shopify顧客メタフィールド書込 → status取得** すべて成功
  （`{ok:true, rank:"0001", rank_name:"ブロンズ", points:450}`）

途中で本番バグも修正済み: `lib/shopify.ts` のメタフィールド型 `single_line_text` → **`single_line_text_field`**。

---

## 完成物

### テーマ `minefit-onlineshop`（New customer accounts 対応）
- `sections/loyalty-membership.liquid` + `templates/page.membership.json` … 会員ページ(/pages/membership)。連携済み=名前/メール/会員番号/保有ポイント/ランクバッジ、未連携=会員番号登録カード(4ランク訴求＋マスコット＋「会員番号の確認方法：FIT365アプリ≡>契約情報」)
- `snippets/loyalty-rank-badge.liquid` … rank→ティア判定でバッジ表示（既定 0001-0004）
- `snippets/loyalty-member-form.liquid` … 会員番号登録フォーム（10桁固定）
- `snippets/loyalty-link-banner.liquid`（layout/theme.liquidに差込）… 未連携者へ全ページで「FIT365にご登録済みですか？」
- `snippets/loyalty-member-price.liquid`（main-product.liquidに差込）… 商品ページの会員価格表示
- `snippets/loyalty-points-redeem.liquid`（main-cart-footer.liquidに差込）… カートのポイント利用UI（1pt=1円）
- `assets/customer-membership.js`, `assets/rank-*.svg`, `assets/mv-bear.png`
- ロケール: `locales/ja.json` / `locales/en.default.json`
- 会員番号は **10桁固定**（`^\d{10}$`）

### バックエンド `knowbie-frontend`（App Proxy）
- `app/api/shopify/loyalty/link/route.ts`（登録ゲート・classic用）
- `app/api/shopify/loyalty/link-account/route.ts`（マイページ登録・**New用の主役**）
- `app/api/shopify/loyalty/status/route.ts`（ランク/残高ライブ・10分キャッシュ）
- `app/api/shopify/loyalty/webhooks/customers-create|orders-paid|orders-cancelled/route.ts`
- `lib/shopify.ts`（署名検証/メタフィールド/email検索）、`lib/loyaltyCpss.ts`（CPSS）、`lib/shopifyLinkStore.ts`
- CPSS呼び出しは既存 `cpss-proxy` Lambda 経由（us-east-1）。**会員番号=CPSS aid**（変換不要）

### 割引 Function `fit365-loyalty-discount`（未デプロイ）
- `member-rank-discount`（シルバー3/ゴールド5/プラチナ10%、対象=商品タグ `member-discount`、セール除外）
- `member-points-redeem`（注文割引・1pt=1円）

---

## 残りの配線（本番/適切な環境で実施。コード変更なし）
> ※開発中に判明した制約：**新Dev Dashboard型のorg（minefitオンラインショップ）は静的Adminトークン(`shpat_`)を発行できず**、CLIアプリのトークンも静的利用に不向き。
> → **Adminトークンが取得できるorg/ストア**（例：レガシーカスタムアプリが使える 株式会社TaTap org の minefit-test、または本番運用環境）で実施すること。

1. **顧客アカウント**：Classic なら main-account/register も使える。New なら会員ページ方式（実装済み）で運用。
2. **Admin APIトークン**（`read/write_customers, read/write_products`）を取得 → `SHOPIFY_ADMIN_API_TOKEN`
3. **App Proxy アプリ**（Partners/CLIアプリ）を作成し、**同一orgのストアにインストール**：
   - App Proxy: prefix `apps` / subpath `loyalty` / url `https://<knowbie本番URL>/api/shopify/loyalty`
   - client secret → `SHOPIFY_APP_PROXY_SECRET`
4. **顧客メタフィールド定義**：`loyalty.member_id/rank/rank_name/points/synced_at`（storefront: PUBLIC_READ）
5. **環境変数**（knowbie-frontend 本番=Amplify）：`SHOPIFY_SHOP_DOMAIN` / `SHOPIFY_ADMIN_API_TOKEN` / `SHOPIFY_APP_PROXY_SECRET` / `CPSS_ENV` 等
6. **Webhook登録**：customers/create, orders/paid, orders/cancelled
7. **テーマ設定**：会員ページセクションに `/apps/loyalty/status` `/apps/loyalty/link-account`
8. **Function**（割引・ポイント利用）：`fit365-loyalty-discount` を `shopify app deploy` → 管理画面で自動割引として有効化
9. **テスト**：会員ページ(/pages/membership)で会員番号 → 実在チェック→連携→バッジ表示、商品/カート/チェックアウト

詳細手順: `docs/shopify-loyalty-setup.md`、設計: `docs/shopify-loyalty-integration.md`

---

## 追記(2026-09-19)：マイページ内 会員番号登録UI（R1：Customer Account UI Extension）
背景：New customer accounts は登録ページ/マイページがShopify占有でLiquid/テーマ改修不可。Classicは2026-02廃止で選べない。
そこで「マイページの中で会員番号を登録／連携済みはカード表示」を**純正のUI Extension**で実装。

実装済みファイル：
- 拡張：`fit365-loyalty/extensions/loyalty-account/`（`shopify.extension.toml` / `package.json` / `tsconfig.json` / `src/ProfileBlock.tsx`）
  - ターゲット `customer-account.profile.block.render`（Profileページのブロック）
  - 未連携→10桁の会員番号フォーム／連携済→ランクバッジ＋会員番号＋保有ポイント
  - セッショントークン(JWT)を付けて自前バックエンドを叩くだけの構成（Customer Account API仕様変動に非依存）
- バックエンド：`knowbie-frontend/app/api/shopify/loyalty/account-link/route.ts`（GET=状態/POST=連携/OPTIONS=CORS）
  - `lib/shopify.ts` に `verifySessionToken()` 追加（HS256・APP_SECRETで署名検証、`sub`=顧客gid）
  - CPSS照合＋メタフィールド書込は既存ヘルパー(`fetchLoyalty`/`setLoyaltyMetafields`)を再利用

デプロイ手順（コード完了、以下は環境作業。すべてユーザー実施）：
1. `ProfileBlock.tsx` の `BACKEND` を本番knowbie URLに合わせる（現状 feat-loyalty-cpss のAmplify URL）
2. 拡張は **customerスコープを持つ minefit-loyalty アプリ**(client_id f300f735…)で配布すること。`sub`取得に `read_customers` 必須。test用(b92bb6…)は不可
3. バックエンドの `SHOPIFY_APP_PROXY_SECRET` は **その minefit-loyalty アプリの API secret key** であること（JWT署名検証に使用）
4. `cd fit365-loyalty && shopify app deploy -c minefit-loyalty`（依存は初回 `shopify app dev`/`pnpm install` で解決）
5. アプリを minefit-test にインストール後、管理画面 **設定＞顧客アカウント＞Customize** で Profileページに「会員情報」ブロックを配置
6. 動作確認：会員でログイン→マイページ(Profile)にブロック→未連携ならフォーム→10桁入力→カードに切替
   - `api_version` は 2025-10、拡張の依存は `@shopify/ui-extensions*` 2025.10.x で作成（必要なら合わせて更新可）

## テスト環境の後片付け（任意）
- ローカルで起動中の `knowbie-frontend npm run dev` / `cloudflared` / `shopify app dev` は停止してOK
- 試行錯誤で増えた Dev Dashboard のアプリ（minefit-loyalty など）は不要なら削除可
- `.env.local` に入れたテスト用値（minefit-test/minefit-loyalty-test 向け）は本番と別
