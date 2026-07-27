# Snowflake データ連携 仕様書（引き継ぎ用）

DynamoDB の **クラブ(knowbie-clubs)** と **1day / OneTimePass 利用データ** を Snowflake に渡すための
AWS 側アーキテクチャ仕様。既存の knowbie 基盤（DynamoDB / ssh-db-proxy / EventBridge 夜間ジョブ）を
再利用する前提でまとめる。

- 作成: 2026-07（引き継ぎ資料）
- 対象アカウント: `340005228061`（AWS）/ リージョン主: `us-east-1`（DDB・Lambda）
- 連携方向: **AWS → Snowflake（片方向・分析用のエクスポート）**

---

## 1. 目的・スコープ

分析基盤(Snowflake)で以下を扱えるよう、AWS から日次でデータを供給する。

| # | データ | ソース | 種別 |
|---|--------|--------|------|
| A | クラブ(店舗)マスタ | DynamoDB `knowbie-clubs`(us-east-1) | マスタ・全件洗い替え |
| B | 1dayパス チケット | 入会DB `one_day_ticket`（FIT365=fit365entry / JOYFIT=ecojoy、MySQL） | トランザクション・差分 |
| C | OneTimePass(EnjoyTimePass) チケット | `t1pass.ticket_tbl`（onetimepass、PostgreSQL） | トランザクション・差分 |
| D | (任意)APP未納金支払い | `unpaid_history`⋈`sb_history`（fit365entry / ecojoy） | トランザクション・差分 |

B/C/D の入会DB・t1pass は **VPC 外から直接叩けない**ため、既存の **`knowbie-ssh-db-proxy`**（SSHトンネル）を
経由して読み出す（新規に接続経路を作らない）。

---

## 2. 推奨アーキテクチャ

```
                 EventBridge (cron 日次 03:30 JST)
                          │ 起動
                          ▼
        ┌──────────────────────────────────┐
        │ Lambda: knowbie-snowflake-export │  (Node.js, us-east-1)
        │  1) DDB Scan(knowbie-clubs)       │
        │  2) ssh-db-proxy 経由で 1day/OTP   │
        │     を差分抽出(insert_date基準)     │
        │  3) NDJSON/Parquet 化              │
        └───────────────┬──────────────────┘
                        │ PutObject
                        ▼
        S3: s3://knowbie-snowflake-export/…（ステージング）
             clubs/dt=YYYY-MM-DD/clubs.ndjson.gz
             oneday/dt=YYYY-MM-DD/oneday.ndjson.gz
             onetimepass/dt=YYYY-MM-DD/otp.ndjson.gz
                        │  s3:ObjectCreated → SNS/SQS 通知
                        ▼
        Snowflake  ──(Storage Integration: IAM ロール信頼)──▶ 外部ステージ
             Snowpipe(auto_ingest) or タスク(COPY INTO) で取り込み
```

**方式の選択**
- **推奨: Lambda → S3 → Snowpipe(auto-ingest)**。疎結合・再取込容易・既存の夜間ジョブ流儀に合う。
- 代替1: DynamoDB → **S3 Export to Point-in-Time**（`ExportTableToPointInTime`）でクラブを直接出力（Aのみ簡略化可）。
- 代替2: **Glue Job/Firehose**。将来ストリーム化する場合。まずは Lambda+Snowpipe で十分。

---

## 3. AWS リソース仕様

### 3.1 S3（ステージング）
- バケット: `knowbie-snowflake-export`（us-east-1、バージョニング有効、SSE-S3/KMS）
- プレフィックス（Hive パーティション）:
  - `clubs/dt=<YYYY-MM-DD>/clubs.ndjson.gz`
  - `oneday/brand=<fit365|joyfit>/dt=<YYYY-MM-DD>/part-*.ndjson.gz`
  - `onetimepass/dt=<YYYY-MM-DD>/part-*.ndjson.gz`
- ライフサイクル: 90日で Glacier/失効（Snowflake取込後は原本不要）
- イベント通知: `s3:ObjectCreated:*` → Snowpipe 用 SQS（Snowflake が払い出す ARN）へ

### 3.2 Lambda `knowbie-snowflake-export`
- ランタイム: Node.js 20（既存 lambdas と同様、`@aws-sdk/*` 使用）
- タイムアウト: 5分 / メモリ: 512MB（データ量に応じて調整）
- 環境変数:
  - `EXPORT_BUCKET=knowbie-snowflake-export`
  - `SSH_DB_PROXY_FN=knowbie-ssh-db-proxy`
  - `CLUBS_TABLE=knowbie-clubs`
  - `STATE_TABLE=knowbie-snowflake-export-state`（差分の高水位を保持）
- 主処理:
  1. **A クラブ**: `knowbie-clubs` を Scan → 全件 NDJSON（洗い替え。Snowflake側は TRUNCATE+COPY か MERGE）。
  2. **B 1day**: fit365entry / ecojoy に対し `ssh-db-proxy` で
     `SELECT … FROM one_day_ticket WHERE insert_date > :lastHW`（`insert_date` char8 の高水位で差分）。
  3. **C OTP**: onetimepass に `SELECT … FROM t1pass.ticket_tbl WHERE insert_dt > :lastHW`（`insert_dt` timestamptz）。
  4. 取得行を NDJSON(gzip) 化 → S3 へ PutObject。
  5. 取り込んだ最大 `insert_date/insert_dt` を `STATE_TABLE` に保存（次回差分の起点）。
- 冪等性: 出力オブジェクトキーに実行日+連番。再実行は同キー上書き or 新パーティション。

### 3.3 差分状態テーブル `knowbie-snowflake-export-state`（DynamoDB）
- PK: `source`（`clubs`|`oneday#fit365`|`oneday#joyfit`|`onetimepass`|`unpaid#…`）
- 属性: `lastHighWater`（string, 例 `20260719` or ISO）, `updatedAt`
- オンデマンド課金

### 3.4 EventBridge（スケジュール）
- ルール: `knowbie-snowflake-export-nightly`
- cron: `cron(30 18 * * ? *)`（UTC 18:30 = **JST 03:30**）
- ターゲット: 上記 Lambda
- ※ FIT365 は adb01 の夜間リストア(02:04 JST)後に走らせる想定。競合しない時間帯を選ぶ。

### 3.5 IAM
- **Lambda 実行ロール** `knowbie-snowflake-export-role`:
  - `dynamodb:Scan` on `knowbie-clubs`
  - `dynamodb:GetItem/PutItem` on `knowbie-snowflake-export-state`
  - `lambda:InvokeFunction` on `knowbie-ssh-db-proxy`
  - `s3:PutObject` on `arn:aws:s3:::knowbie-snowflake-export/*`
- **Snowflake Storage Integration 用ロール** `snowflake-s3-integration-role`:
  - 信頼ポリシー: Snowflake アカウントの IAM ユーザー ARN + `ExternalId`（`DESC INTEGRATION` で払い出される値）
  - 権限: `s3:GetObject/ListBucket` on `knowbie-snowflake-export`（読み取りのみ）

---

## 4. Snowflake 側の受け（参考・DB管理者向け）

```sql
-- 1) ストレージ統合（AWSロールを信頼）
CREATE STORAGE INTEGRATION knowbie_s3_int
  TYPE = EXTERNAL_STAGE STORAGE_PROVIDER = 'S3' ENABLED = TRUE
  STORAGE_AWS_ROLE_ARN = 'arn:aws:iam::340005228061:role/snowflake-s3-integration-role'
  STORAGE_ALLOWED_LOCATIONS = ('s3://knowbie-snowflake-export/');
-- DESC INTEGRATION knowbie_s3_int; で STORAGE_AWS_IAM_USER_ARN / EXTERNAL_ID を取得しAWSロール信頼に反映

-- 2) 外部ステージ + ファイルフォーマット
CREATE FILE FORMAT ff_ndjson TYPE = JSON COMPRESSION = GZIP;
CREATE STAGE stg_knowbie STORAGE_INTEGRATION = knowbie_s3_int
  URL = 's3://knowbie-snowflake-export/' FILE_FORMAT = ff_ndjson;

-- 3) 取込テーブル(例: クラブ)。VARIANT で受けて後段でフラット化 or 明示カラム
CREATE TABLE RAW.CLUBS (v VARIANT, loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP());

-- 4) Snowpipe(auto-ingest) — S3イベント(SQS)で自動取込
CREATE PIPE pipe_clubs AUTO_INGEST = TRUE AS
  COPY INTO RAW.CLUBS FROM @stg_knowbie/clubs/ FILE_FORMAT = ff_ndjson;
-- SHOW PIPES; の notification_channel(SQS ARN) を S3 の ObjectCreated 通知に設定
```

- 1day/OTP も同様に `RAW.ONEDAY_TICKET` / `RAW.OTP_TICKET` を VARIANT で受け、
  差分は `insert_date/insert_dt` をキーに `MERGE`（重複排除）する。

---

## 5. データスキーマ（ソース→Snowflake）

### A. クラブ `knowbie-clubs`（DynamoDB）
| 属性 | 型 | 備考 |
|---|---|---|
| clubCode | S | PK。店舗コード |
| clubName / clubNameShort | S | 店舗名 |
| businessType | S | FIT365 / 赤 / 青 / JOYFIT+ 等 |
| companyGroup | S | 担当エリア（EAST/WEST/FC(EAST)… ＝knowbie-clubs由来） |
| companyName / openDate / syncedAt | S | |
| area / area_block / territory | S | 課別エリア（例: area="関東 第1エリア", area_block="関東", territory="テリトリー1"）。`knowbie-club-areas` を join して付与。未割当店は空文字 |

> ※ `area/area_block/territory` は別マスタ `knowbie-club-areas`（PK areaId、/admin/club-areas で編集）をエクスポート時に clubCode で join。読取失敗/空なら空文字で継続（クラブ出力自体は止めない）。ロールに当テーブルの `dynamodb:Scan` 付与済み。

### B. 1day `one_day_ticket`（fit365entry / ecojoy）
`token, serial_number, uuid, shop_id, member_no, cmember_no, use_date, use_time, purchase_date, purchase_time, expiration_date, expiration_time, is_expired, payment_flg, del_flg, insert_date, insert_time`
- 店舗紐付け: `shop_convert_view.casio_shop_id = LPAD(clubCode,6,'0')` → `town_shop_id = shop_id`。エクスポート時に clubCode を付与すると Snowflake 側の結合が楽。

### C. OTP `t1pass.ticket_tbl`（onetimepass）
`access_key, seq, club_cd, ticket_stat(B/N/U/Z/E/D), max_hour, amount, order_id, start_dt(tz), end_dt(char), insert_dt(tz)`
- `club_cd = clubCode`。ステータス意味は `ticket_stat`（B/N=未使用, U=利用中, Z=使用済, E=期限切, D=削除済）。

### D. 未納(任意) `unpaid_history ⋈ sb_history(way=9)`
`uh.uid(会員), uh.amount, uh.insert_date, uh.order_id, spv.casio_shop_id`（詳細は `app/api/store-settings/unpaid-app-payments/route.ts` の結合を踏襲）。

---

## 6. 差分・冪等の方針
- クラブ(A): 件数小（数百）→ **全件洗い替え**（S3に全件出力し Snowflake で TRUNCATE+COPY か MERGE）。
- 1day/OTP(B/C/D): **`insert_date/insert_dt` の高水位で差分抽出**。`STATE_TABLE` に前回値を保持。
- Snowflake 側は主キー（1day=`token+serial_number`、OTP=`access_key+seq`）で `MERGE` し、
  更新（消し込み等でのステータス変化）も取り込む（差分は insert 基準なので、更新反映が必要なら
  当日分＋直近N日を毎回洗い替える「ローリングウィンドウ」も検討）。

---

## 7. セキュリティ / 運用
- 認証情報（入会DB/t1pass のパス15・SSH鍵）は **Secrets Manager** のみ（`knowbie/sshdb/*`）。**リポジトリ禁止**。
- S3・DDB・Secrets は最小権限。Snowflake 連携ロールは **読み取り専用**。
- 個人情報（会員番号・メール）を含むため、S3暗号化・Snowflakeのロール/マスキングポリシーを適用。
- 監視: Lambda 失敗は CloudWatch Alarm → 通知。取込件数を `STATE_TABLE` にログ。
- 冪等・再実行: 特定日を再エクスポートできるよう Lambda に `?date=` 引数を持たせる。

---

## 8. 既存資産の再利用
| 用途 | 既存資産 |
|---|---|
| 入会DB/t1pass 読み出し | `knowbie-ssh-db-proxy`（SSHトンネル。target: fit365entry / ecojoy / onetimepass） |
| クラブ→shop_id 解決 | `lib/entryShopMap.ts`（`shop_convert_view` casio=LPAD(clubCode,6)） |
| 夜間バッチ雛形 | `lambdas/fit365-onedaypass-summary/`（Lambda+EventBridge+DDBの構成例） |
| クラブ属性 | `lib/clubScope.ts`（businessType/companyGroup の読み方） |

---

## 9. 引き継ぎチェックリスト
- [ ] S3 `knowbie-snowflake-export` 作成（暗号化・ライフサイクル）
- [ ] DDB `knowbie-snowflake-export-state` 作成
- [ ] Lambda `knowbie-snowflake-export` 実装・デプロイ（雛形: fit365-onedaypass-summary）
- [ ] IAM: Lambda 実行ロール / Snowflake 連携ロール
- [ ] EventBridge cron(03:30 JST) 設定
- [ ] Snowflake: Storage Integration / Stage / RAW テーブル / Snowpipe
- [ ] S3 ObjectCreated → Snowpipe SQS 通知
- [ ] 初回フル→以降差分の検証（件数突合）
- [ ] CloudWatch アラーム / 監査
