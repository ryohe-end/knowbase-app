# knowbie-frontend

社内 KnowBase (マニュアル / ニュース / ユーザー管理) フロントエンド + API (Next.js 15 App Router)。

## スタック

- Next.js 15 (App Router, Node.js runtime)
- React 18
- TypeScript
- AWS SDK v3 (DynamoDB, Bedrock, Q Business)
- SendGrid (メール配信)
- Firebase (認証補助)

## セットアップ

```bash
npm install
cp .env.local.example .env.local   # 必要な値を埋める
npm run dev
```

http://localhost:3000 で起動。

## 必須の環境変数

| 名前 | 用途 |
| --- | --- |
| `AWS_REGION` | DynamoDB / Bedrock のリージョン |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS 認証 |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` | メール配信 |
| `KB_ADMIN_API_KEY` | サーバー間 (cron 等) からの管理 API 呼び出し用トークン。ブラウザには露出させない |
| `KB_COOKIE_SECRET` | セッション Cookie の HMAC 署名鍵。**本番では必ず 32 文字以上のランダム値を設定**。漏洩した場合は即ローテーション |
| `NEXT_PUBLIC_APP_URL` | ログイン URL (メール本文などで使用) |

`NEXT_PUBLIC_KB_ADMIN_API_KEY` は廃止。管理画面は HttpOnly な署名 Cookie で認可する。

## スクリプト

```bash
npm run dev        # 開発サーバ
npm run build      # 本番ビルド
npm run start      # 本番サーバ
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

## 認可モデル

- ログイン成功時、サーバーが HMAC 署名した `kb_user` / `kb_uid` / `kb_admin` Cookie を発行する (`lib/auth.ts` を参照)。
- `middleware.ts` は署名検証に失敗した Cookie を無視してログイン画面へリダイレクトする。
- API route は `isAdminRequest(req)` で認可する。署名 Cookie か、サーバー間用の `x-kb-admin-key` / `?token=` のどちらかを受け付ける。
- パスワードは `lib/password.ts` で scrypt ハッシュ化する。旧 `hashed_<plain>` 形式のエントリは初回ログイン時に自動で再ハッシュされる。

## デプロイ

AWS Amplify Hosting を前提。`amplify.yml_d` はビルド設定の雛形。本番では **環境変数をファイルに書き出さずに** Amplify の環境変数機能か AWS Secrets Manager から注入すること。

## セキュリティ運用

- 認証情報 (AWS / SendGrid / Firebase / Google SA) が漏洩した疑いがあれば即ローテーション。
- `メールリスト.csv` など個人情報ファイルは絶対にコミットしない (`*.csv` は gitignore 済み)。必要な場合は S3 等の外部ストレージで管理する。
- `KB_COOKIE_SECRET` は Secrets Manager 等で管理し、ローテーション手順を決めておくこと。
