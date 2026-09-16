# 公開API 仕様書 — 入会完了メール送信 (`/api/public/enrollmentMail`)

外部の入会システム向け公開API。入会完了時に、KnowBaseで**店舗ごと・キャンペーン(CP)単位**に設定された
入会完了メールを、指定アドレスへ **SendGrid** で送信する。

- 認証: `x-api-key` ヘッダ（環境変数 `KB_PUBLIC_API_KEY` と照合。パートナー別キー発行可）
- メソッド: **POST**
- 実装: `app/api/public/enrollmentMail/route.ts` → `lib/storeCampaigns.ts`（DynamoDB `knowbie-store-campaigns` ＋ SendGrid）

---

## 設定（KnowBase側）
店舗担当者が **店舗設定 → キャンペーン（入会メール）** で、店舗ごとにCPを登録し、CP単位で
件名・本文（HTML）・差出人名・有効/無効を設定する。各CPには一意の **`campaignId`（例 `cp-1a2b3c4d`）** が発行される。
この `campaignId` を入会システム側に共有し、送信時に指定する。

---

## エンドポイント
```
POST /api/public/enrollmentMail
Header: x-api-key: <KB_PUBLIC_API_KEY>
Content-Type: application/json
```

### リクエスト（JSON）
| フィールド | 必須 | 型 | 説明 |
|---|---|---|---|
| `campaignId` | ● | string | 送信するCPのID（KnowBaseで発行） |
| `email` | ● | string | 送信先メールアドレス（入会者のアドレス） |
| `variables` | – | object | 差し込み変数。件名/本文の `{{key}}` を置換。例 `{ "name":"山田太郎", "clubName":"JOYFIT新宿" }` |

- 差し込み：本文の `{{key}}` は**HTMLエスケープして**置換（インジェクション防止）。件名はプレーン置換。
- 未指定の `{{key}}` は空文字に置換。

### リクエスト例
```sh
curl -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{
        "campaignId": "cp-1a2b3c4d",
        "email": "member@example.com",
        "variables": { "name": "山田太郎", "clubName": "JOYFIT新宿" }
      }' \
  https://<host>/api/public/enrollmentMail
```

---

## レスポンス（JSON）
### 200 OK
```json
{ "ok": true, "sent": true, "campaignId": "cp-1a2b3c4d", "clubCode": "305",
  "to": "member@example.com", "subject": "【JOYFIT新宿】ご入会ありがとうございます",
  "messageId": "..." }
```

### エラー
| ステータス | body | 条件 |
|---|---|---|
| 400 | `{ ok:false, error:"campaignId required" / "valid email required" }` | 必須パラメータ不足/不正 |
| 401 | `{ ok:false, error:"unauthorized" }` | `x-api-key` 不一致 |
| 404 | `{ ok:false, error:"campaign_not_found" }` | campaignId が存在しない |
| 409 | `{ ok:false, error:"campaign_disabled" }` | CPが無効化されている |
| 502 | `{ ok:false, error:"..." }` | SendGrid送信失敗 / DB読取失敗 |
| 503 | `{ ok:false, error:"public_api_not_configured" }` | `KB_PUBLIC_API_KEY` 未設定 |

---

## 運用メモ
- CPの保存先: DynamoDB `knowbie-store-campaigns`（PK=campaignId, GSI=clubCode-index）。SSRロールに管理ポリシー `knowbie-store-campaigns-access` を付与済み。
- 送信: `@sendgrid/mail`（env `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL`。KB通信と共用）。差出人名はCPの `fromName`（既定「運営事務局」）。
- 送信は1通/リクエスト（同期）。開封/クリックトラッキングは無効。categories: `enrollment-mail`, `cp:<campaignId>`。
- テスト送信は管理画面（店舗設定→キャンペーン→編集→テスト送信）から可能。
- ルート/画面の反映は Amplify のデプロイで有効化。パートナー用APIキーは `KB_PUBLIC_API_KEY` に追記。
