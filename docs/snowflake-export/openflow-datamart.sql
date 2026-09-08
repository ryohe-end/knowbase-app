-- =====================================================================
-- OPENFLOW_DB.DATAMART : 既存エクスポート集計SQLをテキストとして格納
--   OPENFLOW_DB は作成済み。スキーマ + 台帳テーブルに SQL 文字列を保存する。
--   SQL は実行せず「保管」する。sql_text は $$...$$ でそのまま格納(エスケープ不要)。
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS OPENFLOW_DB.DATAMART;
USE SCHEMA OPENFLOW_DB.DATAMART;

-- SQLを台帳保存する箱
CREATE TABLE IF NOT EXISTS OPENFLOW_DB.DATAMART.SAVED_QUERIES (
  name        STRING,        -- クエリ名
  source      STRING,        -- 元Lambda
  description STRING,         -- 内容
  sql_text    STRING,        -- SQL本文(実行せず保管)
  saved_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ---------------------------------------------------------------------
-- OneTimePass 店舗×月 集計 (source: lambdas/onetimepass-summary/handler.mjs)
-- ---------------------------------------------------------------------
INSERT INTO OPENFLOW_DB.DATAMART.SAVED_QUERIES (name, source, description, sql_text)
SELECT 'otp_monthly_total', 'lambdas/onetimepass-summary/handler.mjs', 'OTP 件数/売上/ユニーク', $$select t.club_cd cc, to_char(t.insert_dt at time zone 'Asia/Tokyo','YYYY-MM') ym, count(*) cnt, coalesce(sum(t.amount),0) sales, count(distinct t.access_key) uniq from t1pass.ticket_tbl t where t.insert_dt >= $1::date group by 1,2$$
UNION ALL SELECT 'otp_monthly_by_duration', 'lambdas/onetimepass-summary/handler.mjs', 'OTP 利用時間別', $$select t.club_cd cc, to_char(t.insert_dt at time zone 'Asia/Tokyo','YYYY-MM') ym, t.max_hour dur, count(*) cnt, coalesce(sum(t.amount),0) sales from t1pass.ticket_tbl t where t.insert_dt >= $1::date group by 1,2,3$$
UNION ALL SELECT 'otp_monthly_by_hour', 'lambdas/onetimepass-summary/handler.mjs', 'OTP 時間帯別', $$select t.club_cd cc, to_char(t.insert_dt at time zone 'Asia/Tokyo','YYYY-MM') ym, extract(hour from t.insert_dt at time zone 'Asia/Tokyo')::int hr, count(*) cnt from t1pass.ticket_tbl t where t.insert_dt >= $1::date group by 1,2,3$$
UNION ALL SELECT 'otp_monthly_by_dow', 'lambdas/onetimepass-summary/handler.mjs', 'OTP 曜日別', $$select t.club_cd cc, to_char(t.insert_dt at time zone 'Asia/Tokyo','YYYY-MM') ym, extract(dow from t.insert_dt at time zone 'Asia/Tokyo')::int dow, count(*) cnt from t1pass.ticket_tbl t where t.insert_dt >= $1::date group by 1,2,3$$
UNION ALL SELECT 'otp_monthly_by_gender', 'lambdas/onetimepass-summary/handler.mjs', 'OTP 男女別', $$select t.club_cd cc, to_char(t.insert_dt at time zone 'Asia/Tokyo','YYYY-MM') ym, u.sex sex, count(*) cnt, coalesce(sum(t.amount),0) sales from t1pass.ticket_tbl t left join t1pass.user_tbl u on u.access_key = t.access_key where t.insert_dt >= $1::date group by 1,2,3$$
UNION ALL SELECT 'otp_monthly_by_age', 'lambdas/onetimepass-summary/handler.mjs', 'OTP 年代別', $$select t.club_cd cc, to_char(t.insert_dt at time zone 'Asia/Tokyo','YYYY-MM') ym, case when u.birthday ~ '^[0-9]{8}$' and substr(u.birthday,1,4) ~ '^(19|20)[0-9]{2}$' then least(70,(floor((date_part('year', now()) - substr(u.birthday,1,4)::int)/10)*10)::int) else -1 end ab, count(*) cnt from t1pass.ticket_tbl t left join t1pass.user_tbl u on u.access_key = t.access_key where t.insert_dt >= $1::date group by 1,2,3$$
UNION ALL SELECT 'otp_monthly_new', 'lambdas/onetimepass-summary/handler.mjs', 'OTP 新規(初回購入が当月)', $$with firsts as (select access_key, min(insert_dt) fdt, (array_agg(club_cd order by insert_dt asc))[1] cc from t1pass.ticket_tbl group by access_key) select cc, to_char(fdt at time zone 'Asia/Tokyo','YYYY-MM') ym, count(*) newc from firsts where fdt >= $1::date group by 1,2$$;

-- ---------------------------------------------------------------------
-- オプション都度利用 店舗×月 集計 (source: lambdas/optionusage-summary/handler.mjs)
-- ---------------------------------------------------------------------
INSERT INTO OPENFLOW_DB.DATAMART.SAVED_QUERIES (name, source, description, sql_text)
SELECT 'option_monthly_total', 'lambdas/optionusage-summary/handler.mjs', 'オプション 件数/店舗収入', $$select t.ticket_sales_club cc, to_char(coalesce(t.ticket_payment_dt, t.ticket_create_dt) at time zone 'Asia/Tokyo','YYYY-MM') ym, count(*) cnt, coalesce(sum(t.club_income),0) income from dgtk_sys.ticket t where t.usage='OPTN' and t.ticket_sales_club > 0 and coalesce(t.ticket_payment_dt, t.ticket_create_dt) >= $1::timestamptz group by 1,2$$
UNION ALL SELECT 'option_monthly_by_name', 'lambdas/optionusage-summary/handler.mjs', 'オプション名別(全角半角ゆらぎ吸収)', $$select t.ticket_sales_club cc, to_char(coalesce(t.ticket_payment_dt, t.ticket_create_dt) at time zone 'Asia/Tokyo','YYYY-MM') ym, regexp_replace(coalesce(t.ticket_name,'(不明)'), '（１回）', '（1回）') name, count(*) cnt, coalesce(sum(t.club_income),0) income from dgtk_sys.ticket t where t.usage='OPTN' and t.ticket_sales_club > 0 and coalesce(t.ticket_payment_dt, t.ticket_create_dt) >= $1::timestamptz group by 1,2,3$$
UNION ALL SELECT 'option_monthly_by_brand', 'lambdas/optionusage-summary/handler.mjs', 'オプション ブランド別', $$select t.ticket_sales_club cc, to_char(coalesce(t.ticket_payment_dt, t.ticket_create_dt) at time zone 'Asia/Tokyo','YYYY-MM') ym, trim(t.brand) brand, count(*) cnt, coalesce(sum(t.club_income),0) income from dgtk_sys.ticket t where t.usage='OPTN' and t.ticket_sales_club > 0 and coalesce(t.ticket_payment_dt, t.ticket_create_dt) >= $1::timestamptz group by 1,2,3$$;

-- ---------------------------------------------------------------------
-- お友達紹介 クラブ別月次 (source: knowbie-snowflake-export/handler.mjs exportIntroduce)
--   ${db} = fit365sf(FIT365) / ecojoy(JOYFIT)。ブランドごとに実行。
-- ---------------------------------------------------------------------
INSERT INTO OPENFLOW_DB.DATAMART.SAVED_QUERIES (name, source, description, sql_text)
SELECT 'introduce_monthly_total', 'lambdas/knowbie-snowflake-export/handler.mjs', '紹介: 全体入会(月別)', $$select shop_id, SUBSTR(app_date,1,6) ym, COUNT(*) total from ${db}.member WHERE app_date REGEXP '^[0-9]{8}$' GROUP BY shop_id, ym$$
UNION ALL SELECT 'introduce_monthly_intro', 'lambdas/knowbie-snowflake-export/handler.mjs', '紹介: 紹介入会/紹介者', $$select i.shop_id, SUBSTR(m.app_date,1,6) ym, COUNT(*) intro_join, COUNT(DISTINCT i.introducer_casio_id) referrers from ${db}.introduce_member_individual i JOIN ${db}.member m ON m.member_no=i.member_no AND m.shop_id=i.shop_id WHERE m.app_date REGEXP '^[0-9]{8}$' GROUP BY i.shop_id, ym$$
UNION ALL SELECT 'introduce_shop_name', 'lambdas/knowbie-snowflake-export/handler.mjs', '紹介: 店舗名', $$select shop_id, name from ${db}.shop$$;

-- ---------------------------------------------------------------------
-- FIT365 1dayパス 価格一覧 (source: lambdas/fit365-onedaypass-summary/handler.mjs)
-- ---------------------------------------------------------------------
INSERT INTO OPENFLOW_DB.DATAMART.SAVED_QUERIES (name, source, description, sql_text)
SELECT 'fit365_oneday_price', 'lambdas/fit365-onedaypass-summary/handler.mjs', 'FIT365 1day 価格一覧(?=実行日YYYYMMDD)', $$select s.shop_id, s.name, s.one_day_flg, s.prefecture_id, cl.price base_price, (select cp.price from one_day_cp_price cp where cp.shop_id = s.shop_id and cp.delete_flg = 0 and cp.cp_start_date <= ? and cp.cp_end_date >= ? order by cp.seq desc limit 1) current_cp from shop s left join one_day_shop_price_classification cl on cl.shop_id = s.shop_id where s.delete_flag = 0 order by s.shop_id$$;

-- 確認
-- SELECT name, source, description FROM OPENFLOW_DB.DATAMART.SAVED_QUERIES ORDER BY name;
