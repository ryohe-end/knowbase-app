# 会員照会システム セットアップ手順

> **Phase 1〜5 完了** (2026-06-01 時点)。実構築値は本書中に反映済み。
> Phase 4 (EventBridge) のみ未着手。

## アカウント / リージョン構成

- AWS Account: `340005228061`

| サービス | リージョン |
|---|---|
| Oracle RDS / Lambda / Secrets Manager / API Gateway / EventBridge | `ap-northeast-1` |
| DynamoDB (knowbie既存) / Amplify | `us-east-1` |

## 全体構成

```
[Browser]
   ↓
[Next.js (Amplify)]   ← isAdminRequest で admin限定
   ↓ fetch (x-api-key)
[API Gateway (REST)]
   ↓
[Lambda: knowbie-member-search]   (VPC内)
   ↓ oracledb Thin mode
[Oracle RDS: adb01]

[EventBridge] → [Lambda: knowbie-post-restore-setup]
   ↑ RDS復元イベント

[DynamoDB: knowbie-member-lookup-audit]   ← Next.js から監査ログ書き込み
```

---

## Phase 1: AWS リソース作成

### 1.1 既存リソース (確定済み)

| 項目 | 値 |
|---|---|
| VPC | `vpc-52908b35` (snow-flake-dev) |
| Private Subnet (1d, RDS同居) | `subnet-2eb51a05` |
| Private Subnet (1a, HA用) | `subnet-0d947ddf02da83fe3` |
| NAT Gateway (既存) | `nat-0bca4681dd7d883d0` (snowflake-1 流用) |
| RDS SG | `sg-0e8dc869082c14e2b` (snow-flake-dev) |
| RDS エンドポイント | `adb01.cqqrrfiukicu.ap-northeast-1.rds.amazonaws.com:1521/ORCL` |

### 1.2 新規作成: Lambda用 Security Group + RDS Inbound

```sh
# Lambda 用 SG (構築済み: sg-0a1758b9bbd79af4a)
aws ec2 create-security-group \
  --group-name knowbie-lambda-sg \
  --description "Lambda for member-search" \
  --vpc-id vpc-52908b35

# RDS の SG (snow-flake-dev) に Inbound 追加
aws ec2 authorize-security-group-ingress \
  --group-id sg-0e8dc869082c14e2b \
  --protocol tcp --port 1521 \
  --source-group sg-0a1758b9bbd79af4a
```

> **⚠️ Secrets Manager VPCエンドポイントSG にも 443 inbound が必要**
> 既存 Interface型 VPCE (`vpce-03a5d5250257416b6` / SG `sg-3de01670`) の
> インバウンドに `TCP 443 ← sg-0a1758b9bbd79af4a` を追加しないと、
> Lambda が Secrets Manager に到達できず 30秒タイムアウトする。
> (構築時に発覚した落とし穴)

### 1.2 Secrets Manager

3つの Secret を用意:

```sh
# 検索Lambda用 (knowbie_ro 接続情報)
# 構築済み: knowbie/oracle/readonly-0dtT8U
aws secretsmanager create-secret \
  --name knowbie/oracle/readonly \
  --secret-string '{
    "user": "knowbie_ro",
    "password": "<RANDOM_STRONG_PASSWORD>",
    "host": "adb01.cqqrrfiukicu.ap-northeast-1.rds.amazonaws.com",
    "port": "1521",
    "service": "ORCL"
  }'

# 復元後セットアップ用 (FIT_ADMIN スキーマオーナーで接続)
# 構築済み: knowbie/oracle/admin-QLUqVC
# user = "FIT_ADMIN" (スキーマオーナー本体を使用。CREATE USER / GRANT
#                     ANY OBJECT PRIVILEGE / CREATE ANY INDEX / ANALYZE ANY
#                     をすべて持つ前提)
aws secretsmanager create-secret \
  --name knowbie/oracle/admin \
  --secret-string '{
    "user": "FIT_ADMIN",
    "password": "<ADMIN_PW>",
    "host": "adb01.cqqrrfiukicu.ap-northeast-1.rds.amazonaws.com",
    "port": "1521",
    "service": "ORCL"
  }'
```

> 当初は `adbuser` (RDS マスターユーザー) を想定していたが、
> 実環境では FIT_ADMIN がスキーマ所有 + 必要権限を保持していたため
> こちらを使う方が運用がシンプル。将来的に admin 専用ユーザー
> (CREATE USER と必要 GRANT のみ) を切り出してもよい。

### 1.3 DynamoDB 監査ログテーブル

[dynamodb-audit-log.md](./dynamodb-audit-log.md) の手順を参照。

### 1.4 IAM ロール

#### Lambda: knowbie-member-search 用

ポリシー:
- `AWSLambdaVPCAccessExecutionRole` (マネージド)
- カスタム: Secrets Manager 読み取り
```json
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": "arn:aws:secretsmanager:ap-northeast-1:<ACCOUNT>:secret:knowbie/oracle/readonly-*"
}
```

#### Lambda: knowbie-post-restore-setup 用

- `AWSLambdaVPCAccessExecutionRole`
- Secrets Manager (admin + readonly 両方読み取り)

#### Amplify SSR (Next.js) 用

既存ロールに追加:
- DynamoDB PutItem (knowbie-member-lookup-audit)

---

## Phase 2: Lambda デプロイ

### 2.1 検索 Lambda

```sh
cd lambdas/member-search
npm install
zip -r function.zip .

aws lambda create-function \
  --function-name knowbie-member-search \
  --runtime nodejs20.x \
  --role arn:aws:iam::<ACCOUNT>:role/knowbie-member-search-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --timeout 30 \
  --memory-size 512 \
  --vpc-config SubnetIds=subnet-2eb51a05,subnet-0d947ddf02da83fe3,SecurityGroupIds=<LAMBDA_SG_ID> \
  --environment Variables="{ORACLE_SECRET_ARN=arn:aws:secretsmanager:ap-northeast-1:<ACCOUNT>:secret:knowbie/oracle/readonly-XXXX}"
```

> **oracledb の Thin mode** を使うため Instant Client Layer は不要。
> ただしビルド時、ローカルとLambdaのアーキテクチャ(arm64/x86_64)が一致している必要あり。

### 2.2 復元後セットアップ Lambda

```sh
cd lambdas/post-restore-setup
npm install
zip -r function.zip .

aws lambda create-function \
  --function-name knowbie-post-restore-setup \
  --runtime nodejs20.x \
  --role arn:aws:iam::<ACCOUNT>:role/knowbie-post-restore-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --timeout 120 \
  --memory-size 512 \
  --vpc-config SubnetIds=subnet-2eb51a05,subnet-0d947ddf02da83fe3,SecurityGroupIds=<LAMBDA_SG_ID> \
  --environment Variables="{ORACLE_ADMIN_SECRET_ARN=...,ORACLE_RO_SECRET_ARN=...}"
```

---

## Phase 3: API Gateway (構築済み)

| 項目 | 値 |
|---|---|
| REST API ID | `ccgkxj8d4f` |
| Stage | `prod` |
| Base URL | `https://ccgkxj8d4f.execute-api.ap-northeast-1.amazonaws.com/prod` |
| リソース | `GET /members/search` (API Key 必須) |
| 統合 | Lambda Proxy → `knowbie-member-search` |
| Usage Plan ID | `h0xwl0` (rate=20 req/s / burst=40) |
| API Key ID | `sgf6n373fc` |

```sh
# 1. REST API
aws apigateway create-rest-api \
  --name knowbie-member-search-api \
  --endpoint-configuration types=REGIONAL \
  --region ap-northeast-1

# 2. /members → /members/search リソース作成
aws apigateway create-resource --rest-api-id <ID> --parent-id <ROOT_ID> --path-part members
aws apigateway create-resource --rest-api-id <ID> --parent-id <MEMBERS_ID> --path-part search

# 3. GET メソッド (API Key 必須) + Lambda Proxy 統合
aws apigateway put-method \
  --rest-api-id <ID> --resource-id <SEARCH_ID> --http-method GET \
  --authorization-type NONE --api-key-required

aws apigateway put-integration \
  --rest-api-id <ID> --resource-id <SEARCH_ID> --http-method GET \
  --type AWS_PROXY --integration-http-method POST \
  --uri "arn:aws:apigateway:ap-northeast-1:lambda:path/2015-03-31/functions/arn:aws:lambda:ap-northeast-1:340005228061:function:knowbie-member-search/invocations"

# 4. Lambda 側に invoke 許可
aws lambda add-permission --function-name knowbie-member-search \
  --statement-id apigw-invoke-prod --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:ap-northeast-1:340005228061:<ID>/*/GET/members/search"

# 5. prod デプロイ
aws apigateway create-deployment --rest-api-id <ID> --stage-name prod

# 6. Usage Plan + API Key + 紐付け
aws apigateway create-usage-plan --name knowbie-member-search-plan \
  --api-stages "apiId=<ID>,stage=prod" --throttle 'rateLimit=20,burstLimit=40'
aws apigateway create-api-key --name knowbie-member-search-key --enabled
aws apigateway create-usage-plan-key --usage-plan-id <UP_ID> --key-id <KEY_ID> --key-type API_KEY
```

> API Key 値は `aws apigateway get-api-key --api-key <KEY_ID> --include-value` で取得。Amplify 環境変数 `MEMBER_SEARCH_API_KEY` に設定。

---

## Phase 4: EventBridge ルール (復元検知)

```sh
aws events put-rule \
  --name knowbie-rds-restore-trigger \
  --event-pattern '{
    "source": ["aws.rds"],
    "detail-type": ["RDS DB Instance Event"],
    "detail": {
      "SourceIdentifier": ["adb01"],
      "EventCategories": ["restoration"]
    }
  }'

aws events put-targets \
  --rule knowbie-rds-restore-trigger \
  --targets "Id=1,Arn=arn:aws:lambda:ap-northeast-1:<ACCOUNT>:function:knowbie-post-restore-setup"

aws lambda add-permission \
  --function-name knowbie-post-restore-setup \
  --statement-id eventbridge-restore \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:ap-northeast-1:<ACCOUNT>:rule/knowbie-rds-restore-trigger
```

> **注意**: 復元完了イベント発火直後はDBがまだ open しきっていないことがある。
> その場合は Step Functions で 60秒 Wait → Lambda invoke の構成にする。

---

## Phase 5: Amplify (Next.js) 環境変数 (構築済み)

対象 Amplify アプリ: `knowbase-app` (App ID: `d5z4bnw4wyrxn` / region: us-east-1)

| キー | 値 |
|---|---|
| `MEMBER_SEARCH_API_BASE` | `https://ccgkxj8d4f.execute-api.ap-northeast-1.amazonaws.com/prod` |
| `MEMBER_SEARCH_API_KEY` | (Secrets Manager で別管理推奨。現状は Amplify env vars に直書き) |
| `MEMBER_SEARCH_AUDIT_TABLE` | `knowbie-member-lookup-audit` (デフォルトと同じなら省略可) |

```sh
# update-app は environmentVariables を **全置換** するので、
# 既存値を get-app で取得してマージしてから書き戻すこと。
aws amplify get-app --app-id d5z4bnw4wyrxn --region us-east-1 \
  --query 'app.environmentVariables' --output json > env.json
# env.json に MEMBER_SEARCH_* を追記
aws amplify update-app --app-id d5z4bnw4wyrxn --region us-east-1 \
  --environment-variables file://env.json
```

> 反映は次回ビルド時 (push to main / 手動 release)。

---

## Phase 6: 動作確認

### 6.1 Lambda 単体

```sh
aws lambda invoke \
  --function-name knowbie-member-search \
  --payload '{"queryStringParameters":{"type":"member_no","q":"1234567"}}' \
  --cli-binary-format raw-in-base64-out \
  out.json
cat out.json
```

### 6.2 API Gateway 経由

```sh
curl -H "x-api-key: <KEY>" \
  "https://<api-id>.execute-api.ap-northeast-1.amazonaws.com/prod/members/search?type=member_no&q=1234567"
```

### 6.3 knowbie 経由 (admin ログイン後)

ブラウザで `/admin/member-search` を開く → 検索 → 結果表示 → 詳細クリック。

### 6.4 監査ログ確認

```sh
aws dynamodb scan \
  --table-name knowbie-member-lookup-audit \
  --limit 10
```

---

## トラブルシュート

| 症状 | 確認ポイント |
|---|---|
| `upstream_unreachable` | Amplify から API Gateway への到達性。CORS は不要 (server-side fetch) |
| Lambda が Oracle に繋がらない | RDS SG の Inbound に Lambda SG が許可されているか / Lambda が同VPC private subnet にあるか |
| Lambda が Secrets Manager に繋がらない | NAT Gateway の有無 / VPC Endpoint (interface) があるか |
| 復元後にユーザーが消える | post-restore-setup Lambda の CloudWatch Logs を確認 / EventCategory が想定通りか |
| `forbidden` レスポンス | knowbie 側で admin ログイン (`kb_admin` cookie) されているか |

---

## 既知の落とし穴 (構築時メモ)

- **CHAR 型 カラムは末尾スペース padded**
  `FIT_ADMIN.個人電話番号.検索用TEL` および `FIT_ADMIN.個人.T連絡先TEL` は CHAR(15) 固定長。
  oracledb の VARCHAR2 bind と non-padded 比較されるため、`WHERE 検索用TEL = :q` だと一致しない。
  → `RPAD(:q, 15)` でバインド側を 15 文字に揃えて比較する。返却値も `.trim()` してから返す。
- **生年月日は NUMBER 型 YYYYMMDD**
  DATE ではないので `TO_CHAR(num, 'YYYY-MM-DD')` は ORA-01481。
  `SUBSTR(TO_CHAR(value), 1, 4) || '-' || ...` で文字列スライスする。
  不正値対策で `CASE WHEN value BETWEEN 18000101 AND 30000101 THEN ... END`。

## 残課題 / 今後の改善

- [ ] Phase 4: EventBridge ルール (RDS復元検知) ─ **未着手**
- [ ] API Gateway を **IAM authorizer + SigV4** に切り替え (API Keyより堅牢)
- [ ] 個人電話番号テーブル経由の検索の重複行対策
- [ ] 復元処理が Step Functions の場合は EventBridge ではなく直接ステップに組み込む
- [ ] 監査ログを Athena 経由で集計するダッシュボード化
- [ ] Snow-flake-dev SG の `0.0.0.0/0` Inbound 削除 (別タスク)
- [ ] VPCE `vpce-03a5d5250257416b6` のサブネットに `subnet-0d947ddf02da83fe3` の AZ が含まれていないので AZ 偏りで Lambda 接続が不安定化する可能性 → エンドポイントへサブネット追加検討
- [ ] VPCE SG `sg-3de01670` の `1521/5432` の `0.0.0.0/0` Inbound 棚卸し (今回の作業外)
- [ ] post-restore-setup を `FIT_ADMIN` 直接でなく専用 admin ユーザーに切り出す
