# Snowflake データ連携 — 構築ランブック（引き継ぎ）

クラブ(`knowbie-clubs`)・1day・OneTimePass を Snowflake に渡すための **AWS構築手順** と成果物一式。
設計の背景・仕様は [`../snowflake-export-spec.md`](../snowflake-export-spec.md) を参照。

## 成果物（この配下）
| ファイル | 用途 |
|---|---|
| `../snowflake-export-spec.md` | 仕様書（アーキ図・スキーマ・差分方針） |
| `../../lambdas/knowbie-snowflake-export/` | 出力Lambda **参照実装**（handler.mjs / package.json） |
| `iam-lambda-role-policy.json` | Lambda実行ロールのポリシー |
| `iam-snowflake-integration-role.json` | Snowflake連携ロール（信頼＋S3読取） |
| `snowflake-setup.sql` | Snowflake側 DDL（統合/ステージ/PIPE/ビュー） |

- アカウント: `340005228061` / 主リージョン `us-east-1`
- **秘密情報はコード・リポジトリに置かない**（入会DB/t1passの認証は既存の `knowbie/sshdb/*` Secrets を Lambda が ssh-db-proxy 経由で利用。このLambda自体は認証情報を持たない）

---

## 構築手順（上から順に）

### 1. S3 ステージング
```bash
aws s3api create-bucket --bucket knowbie-snowflake-export --region us-east-1
aws s3api put-bucket-encryption --bucket knowbie-snowflake-export \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket knowbie-snowflake-export \
  --lifecycle-configuration '{"Rules":[{"ID":"expire90","Status":"Enabled","Filter":{},"Expiration":{"Days":90}}]}'
```

### 2. 差分状態テーブル
```bash
aws dynamodb create-table --table-name knowbie-snowflake-export-state --region us-east-1 \
  --attribute-definitions AttributeName=source,AttributeType=S \
  --key-schema AttributeName=source,KeyType=HASH --billing-mode PAY_PER_REQUEST
```

### 3. Lambda 実行ロール + 関数
```bash
# ロール作成 + Lambda基本信頼
aws iam create-role --role-name knowbie-snowflake-export-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
# ポリシー(ACCOUNT_ID を置換してから)
sed 's/ACCOUNT_ID/340005228061/g' iam-lambda-role-policy.json > /tmp/lam.json
aws iam put-role-policy --role-name knowbie-snowflake-export-role --policy-name export --policy-document file:///tmp/lam.json

# デプロイ (参照実装をzip)
cd ../../lambdas/knowbie-snowflake-export && npm install --omit=dev && zip -r /tmp/fn.zip . >/dev/null
aws lambda create-function --function-name knowbie-snowflake-export --region us-east-1 \
  --runtime nodejs20.x --handler handler.handler --timeout 300 --memory-size 512 \
  --role arn:aws:iam::340005228061:role/knowbie-snowflake-export-role \
  --environment 'Variables={EXPORT_BUCKET=knowbie-snowflake-export,SSH_DB_PROXY_FN=knowbie-ssh-db-proxy,CLUBS_TABLE=knowbie-clubs,STATE_TABLE=knowbie-snowflake-export-state}' \
  --zip-file fileb:///tmp/fn.zip
```
- **VPC**: ssh-db-proxy は Lambda invoke で叩くだけなので、このLambda自体はVPC不要（既存の fit365-onedaypass-summary と同様）。
- **手動テスト**: `aws lambda invoke --function-name knowbie-snowflake-export --payload '{"date":"2026-07-20"}' out.json`

### 4. EventBridge 日次
```bash
aws events put-rule --name knowbie-snowflake-export-nightly --schedule-expression 'cron(30 18 * * ? *)' --region us-east-1  # JST 03:30
aws lambda add-permission --function-name knowbie-snowflake-export --statement-id eb --action lambda:InvokeFunction \
  --principal events.amazonaws.com --source-arn arn:aws:events:us-east-1:340005228061:rule/knowbie-snowflake-export-nightly
aws events put-targets --rule knowbie-snowflake-export-nightly \
  --targets 'Id=1,Arn=arn:aws:lambda:us-east-1:340005228061:function:knowbie-snowflake-export'
```

### 5. Snowflake 連携ロール（S3読取）
- `iam-snowflake-integration-role.json` の permission_policy でロール作成。信頼ポリシーは手順6の後に確定。

### 6. Snowflake 側セットアップ
1. `snowflake-setup.sql` の手順1（`CREATE STORAGE INTEGRATION`）まで実行。
2. `DESC INTEGRATION KNOWBIE_S3_INT;` の **STORAGE_AWS_IAM_USER_ARN / STORAGE_AWS_EXTERNAL_ID** を取得。
3. これを `snowflake-s3-integration-role` の**信頼ポリシー**に反映（`iam-snowflake-integration-role.json` の trust_policy）。
4. `snowflake-setup.sql` の残り（Stage / RAWテーブル / PIPE / ビュー）を実行。
5. `SHOW PIPES;` の各 **notification_channel(SQS ARN)** を控える。

### 7. S3 → Snowpipe 通知
```bash
# 各prefixごとに、対応するPIPEのSQS ARNへ ObjectCreated 通知を設定
aws s3api put-bucket-notification-configuration --bucket knowbie-snowflake-export \
  --notification-configuration '{"QueueConfigurations":[
    {"QueueArn":"<PIPE_CLUBS_SQS_ARN>","Events":["s3:ObjectCreated:*"],"Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"clubs/"}]}}},
    {"QueueArn":"<PIPE_ONEDAY_SQS_ARN>","Events":["s3:ObjectCreated:*"],"Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"oneday/"}]}}},
    {"QueueArn":"<PIPE_OTP_SQS_ARN>","Events":["s3:ObjectCreated:*"],"Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"onetimepass/"}]}}}
  ]}'
```

---

## 検証
1. `aws lambda invoke` で手動実行 → S3 に `clubs/dt=…`, `oneday/…`, `onetimepass/…` が出るか。
2. Snowflake `RAW_CLUBS/RAW_ONEDAY/RAW_ONETIMEPASS` の件数が増えるか（Snowpipe自動 or `ALTER PIPE … REFRESH`）。
3. `V_CLUBS / V_ONEDAY / V_ONETIMEPASS` で整形結果を確認。
4. 2回目実行で **差分のみ**（`knowbie-snowflake-export-state` の lastHighWater 更新）になるか。

## 運用・注意
- クラブは全件洗い替え、1day/OTP は `insert_date/insert_dt` 差分（`STATE_TABLE`）。
  - 消し込み等の**更新反映**が必要なら、直近Nヶ月をローリング洗い替えに変更（handlerのWHERE条件を調整）。
- 個人情報（会員番号・メール）を含む。S3暗号化・Snowflakeのマスキング/ロール制御を適用。
- 障害監視: Lambda失敗の CloudWatch Alarm を設定。取込件数は state / ログで追跡。
- FIT365 は adb01 の夜間リストア(02:04 JST)と競合しない 03:30 JST 実行。
