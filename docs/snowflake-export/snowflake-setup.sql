-- =====================================================================
-- Snowflake セットアップ: knowbie クラブ / 1day / OneTimePass 取込
-- 前提: S3 s3://knowbie-snowflake-export/ に Lambda(knowbie-snowflake-export)が
--       NDJSON(gzip) を出力している。IAMロール snowflake-s3-integration-role 作成済。
-- 実行はSnowflakeのACCOUNTADMIN相当で。<...>は自環境の値に置換。
-- =====================================================================

-- 0) DB / スキーマ
CREATE DATABASE IF NOT EXISTS KNOWBIE;
CREATE SCHEMA IF NOT EXISTS KNOWBIE.RAW;
USE SCHEMA KNOWBIE.RAW;

-- 1) ストレージ統合 (AWSロールを信頼)
CREATE STORAGE INTEGRATION IF NOT EXISTS KNOWBIE_S3_INT
  TYPE = EXTERNAL_STAGE
  STORAGE_PROVIDER = 'S3'
  ENABLED = TRUE
  STORAGE_AWS_ROLE_ARN = 'arn:aws:iam::340005228061:role/snowflake-s3-integration-role'
  STORAGE_ALLOWED_LOCATIONS = ('s3://knowbie-snowflake-export/');
-- ↓これで払い出される値を AWS ロールの信頼ポリシーに反映する
DESC INTEGRATION KNOWBIE_S3_INT;   -- STORAGE_AWS_IAM_USER_ARN / STORAGE_AWS_EXTERNAL_ID

-- 2) ファイルフォーマット & 外部ステージ
CREATE FILE FORMAT IF NOT EXISTS FF_NDJSON TYPE = JSON COMPRESSION = GZIP STRIP_OUTER_ARRAY = FALSE;
CREATE STAGE IF NOT EXISTS STG_KNOWBIE
  STORAGE_INTEGRATION = KNOWBIE_S3_INT
  URL = 's3://knowbie-snowflake-export/'
  FILE_FORMAT = FF_NDJSON;

-- 3) 生取込テーブル (VARIANTで受ける)
CREATE TABLE IF NOT EXISTS RAW_CLUBS       (v VARIANT, src_file STRING, loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP());
CREATE TABLE IF NOT EXISTS RAW_ONEDAY      (v VARIANT, src_file STRING, loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP());
CREATE TABLE IF NOT EXISTS RAW_ONETIMEPASS (v VARIANT, src_file STRING, loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP());
CREATE TABLE IF NOT EXISTS RAW_RECESS      (v VARIANT, src_file STRING, loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP());
CREATE TABLE IF NOT EXISTS RAW_OPTION      (v VARIANT, src_file STRING, loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP());  -- オプション都度利用(dgtk_sys.ticket usage=OPTN, source=option#dgtk)

-- 4) Snowpipe (S3 ObjectCreated 通知で自動取込)
CREATE PIPE IF NOT EXISTS PIPE_CLUBS AUTO_INGEST = TRUE AS
  COPY INTO RAW_CLUBS (v, src_file) FROM (SELECT $1, METADATA$FILENAME FROM @STG_KNOWBIE/clubs/);
CREATE PIPE IF NOT EXISTS PIPE_ONEDAY AUTO_INGEST = TRUE AS
  COPY INTO RAW_ONEDAY (v, src_file) FROM (SELECT $1, METADATA$FILENAME FROM @STG_KNOWBIE/oneday/);
CREATE PIPE IF NOT EXISTS PIPE_ONETIMEPASS AUTO_INGEST = TRUE AS
  COPY INTO RAW_ONETIMEPASS (v, src_file) FROM (SELECT $1, METADATA$FILENAME FROM @STG_KNOWBIE/onetimepass/);
CREATE PIPE IF NOT EXISTS PIPE_RECESS AUTO_INGEST = TRUE AS
  COPY INTO RAW_RECESS (v, src_file) FROM (SELECT $1, METADATA$FILENAME FROM @STG_KNOWBIE/recess/);
CREATE PIPE IF NOT EXISTS PIPE_OPTION AUTO_INGEST = TRUE AS
  COPY INTO RAW_OPTION (v, src_file) FROM (SELECT $1, METADATA$FILENAME FROM @STG_KNOWBIE/option/);  -- Lambdaは option/dgtk/dt=YYYY-MM-DD/part-*.ndjson.gz へ出力(接頭辞 option/ に一致)
-- ↓各PIPEの notification_channel(SQS ARN) を S3の ObjectCreated 通知先に設定する
SHOW PIPES;

-- 5) 整形ビュー (VARIANT → カラム)
CREATE OR REPLACE VIEW V_CLUBS AS
SELECT v:clubCode::STRING club_code, v:clubName::STRING club_name, v:clubNameShort::STRING club_name_short,
       v:businessType::STRING business_type, v:companyGroup::STRING company_group, v:openDate::STRING open_date,
       v:area::STRING area, v:area_block::STRING area_block, v:territory::STRING territory,  -- 課別エリア(knowbie-club-areas join, 例 area="関東 第1エリア")
       loaded_at
FROM RAW_CLUBS QUALIFY ROW_NUMBER() OVER (PARTITION BY v:clubCode ORDER BY loaded_at DESC) = 1;

CREATE OR REPLACE VIEW V_ONEDAY AS
SELECT v:token::STRING token, v:serial_number::NUMBER serial_number, v:brand::STRING brand,
       v:shop_id::STRING shop_id, v:casio_shop_id::STRING casio_shop_id, v:member_no::STRING member_no,
       v:use_date::STRING use_date, v:use_time::STRING use_time, v:purchase_date::STRING purchase_date,
       v:expiration_date::STRING expiration_date, v:is_expired::NUMBER is_expired,
       v:payment_flg::NUMBER payment_flg, v:del_flg::NUMBER del_flg, v:insert_date::STRING insert_date,
       v:base_price::NUMBER base_price, v:cp_price::NUMBER cp_price,
       COALESCE(v:cp_price::NUMBER, v:base_price::NUMBER) unit_price, loaded_at
FROM RAW_ONEDAY QUALIFY ROW_NUMBER() OVER (PARTITION BY v:token, v:serial_number ORDER BY loaded_at DESC) = 1;

CREATE OR REPLACE VIEW V_ONETIMEPASS AS
SELECT v:access_key::STRING access_key, v:seq::NUMBER seq, v:club_cd::NUMBER club_cd,
       v:ticket_stat::STRING ticket_stat, v:max_hour::NUMBER max_hour, v:amount::NUMBER amount,
       v:start_dt::TIMESTAMP_TZ start_dt, v:end_dt::STRING end_dt, v:insert_dt::TIMESTAMP_TZ insert_dt, loaded_at
FROM RAW_ONETIMEPASS QUALIFY ROW_NUMBER() OVER (PARTITION BY v:access_key, v:seq ORDER BY loaded_at DESC) = 1;

-- ticket_stat: B/N=未使用, U=利用中, Z=使用済, E=期限切, D=削除済

-- 休会ロスター(月×人)。recess_month=対象月(YYYYMM), applied_at=申請日時(FIT365のみ)
CREATE OR REPLACE VIEW V_RECESS AS
SELECT v:recess_month::STRING recess_month, v:memberno::STRING memberno, v:name::STRING name,
       v:club_code::STRING club_code, v:club_name::STRING club_name, v:brand::STRING brand,
       v:temp_flag::BOOLEAN temp_flag, v:applied_at::STRING applied_at, loaded_at
FROM RAW_RECESS QUALIFY ROW_NUMBER() OVER (PARTITION BY v:club_code, v:memberno, v:recess_month ORDER BY loaded_at DESC) = 1;

-- オプション都度利用(dgtk_sys.ticket usage='OPTN')。member_id=会員番号(pson.person_tbl で解決), ticket_sales_club=販売店舗
-- ticket_status: U=使用中/F=使用済/C=返金済/D=削除済/E=期限切/N,T=未確定
CREATE OR REPLACE VIEW V_OPTION AS
SELECT v:ticket_order_id::STRING     ticket_order_id,
       v:ticket_code::STRING         ticket_code,
       v:ticket_holder_id::STRING    ticket_holder_id,
       v:member_id::STRING           member_id,
       v:usage::STRING               usage,
       v:coupon_code::STRING         coupon_code,
       v:brand::STRING               brand,
       v:ticket_name::STRING         ticket_name,
       v:ticket_status::STRING       ticket_status,
       v:ticket_source::STRING       ticket_source,
       v:ticket_fix_club::STRING     ticket_fix_club,
       v:ticket_sales_club::STRING   ticket_sales_club,
       v:ticket_retail_price::NUMBER ticket_retail_price,
       v:club_income::NUMBER         club_income,
       v:ticket_create_dt::TIMESTAMP_TZ  ticket_create_dt,
       v:ticket_payment_dt::TIMESTAMP_TZ ticket_payment_dt,
       v:ticket_start_dt::TIMESTAMP_TZ   ticket_start_dt,
       v:ticket_consume_dt::TIMESTAMP_TZ ticket_consume_dt,
       v:ticket_cxl_date::TIMESTAMP_TZ   ticket_cxl_date,
       v:ticket_expire::STRING       ticket_expire,
       v:ticket_sales_date::STRING   ticket_sales_date,
       loaded_at
FROM RAW_OPTION QUALIFY ROW_NUMBER() OVER (PARTITION BY v:ticket_order_id, v:ticket_code ORDER BY loaded_at DESC) = 1;

-- ============================================================================
-- お友達紹介 クラブ別月次 DM (source=introduce, 全件洗い替え)
--   fit365sf=FIT365 / ecojoy=JOYFIT を Lambda が結合済み。ym=申込月(YYYYMM)。
--   referrers=紹介者数(distinct introducer), intro_joins=紹介経由入会, total_joins=全体入会。
-- ============================================================================
CREATE TABLE IF NOT EXISTS RAW_INTRODUCE (v VARIANT, src_file STRING, loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP());

CREATE PIPE IF NOT EXISTS PIPE_INTRODUCE AUTO_INGEST = TRUE AS
  COPY INTO RAW_INTRODUCE (v, src_file) FROM (SELECT $1, METADATA$FILENAME FROM @STG_KNOWBIE/introduce/);
-- ↑ PIPE_INTRODUCE の notification_channel(SQS ARN) も S3 ObjectCreated 通知先へ追加すること。

-- 最新スナップショットのみ(brand, club_code, ym で dedup)。紹介経由率も算出。
CREATE OR REPLACE VIEW V_INTRODUCE AS
SELECT v:brand::STRING        brand,
       v:club_code::STRING    club_code,
       v:shop_name::STRING    shop_name,
       v:ym::STRING           ym,
       v:referrers::NUMBER    referrers,
       v:intro_joins::NUMBER  intro_joins,
       v:total_joins::NUMBER  total_joins,
       IFF(v:total_joins::NUMBER > 0, ROUND(100.0 * v:intro_joins::NUMBER / v:total_joins::NUMBER, 1), 0) introduce_rate_pct,
       loaded_at
FROM RAW_INTRODUCE
QUALIFY ROW_NUMBER() OVER (PARTITION BY v:brand, v:club_code, v:ym ORDER BY loaded_at DESC) = 1;
