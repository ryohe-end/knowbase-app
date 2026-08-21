# JOYFIT OneTimePass 価格 昇格スケジューラ

JOYFIT OneTimePass(時間別価格) の **「予約変更(以降ずっと=恒久)」を、開始日到来後に「基本価格(通常価格)」へ自動昇格**させる日次バッチ。

## 背景 / 不具合
- アプリ購入画面(EnjoyTimePass)は `t1pass.club_time_price_tbl` の **基本価格の行**(`start_dt='00000000' / end_dt='99999999'`)しか参照しない。
- KnowBase の「予約変更/期間限定」は **日付指定の別行**を作るため、そのままではアプリに反映されない(上新庄538/東淡路567 の事象)。
- 対策: 恒久変更(end_dt=FOREVER)が効力発生(開始日<=当日)したら、その価格を**基本価格の行に書き込む**。
  - 保存時(即時): `app/api/store-settings/joyfit-onetimepass/route.ts` の POST で対応済み。
  - **未来日付の予約変更**: この日次スケジューラが到来日に昇格させる。

## 構成
- EventBridge Rule `knowbie-onetimepass-price-promote-daily`(us-east-1)
  - `cron(0 18 * * ? *)` = 毎日 03:00 JST
  - **初期状態: DISABLED**(有効化すると効力発生済みの予約変更が基本価格に昇格=ライブ価格が変わるため)
  - Target: Lambda `knowbie-ssh-db-proxy`(target=onetimepass) に固定SQLを渡す(新規Lambdaは作らない)
- 実行SQL(2文・冪等):
  1. 昇格: 効力発生済み(end_dt=FOREVER, start_dt<>基本, start_dt<=JST当日)の各(club,分)の**最新** start_dt の価格を基本価格へ upsert
  2. 集約: 上記に該当する別行を `end_dt='00000001'` で期限切れ化(重複防止・実効価格は基本価格が正なので不変)

## 有効化 / 無効化
```
aws events enable-rule  --region us-east-1 --name knowbie-onetimepass-price-promote-daily
aws events disable-rule --region us-east-1 --name knowbie-onetimepass-price-promote-daily
```
※ 有効化前に、効力発生済みの昇格対象を確認したい場合は 上記SQLの SELECT 版(DISTINCT ON ... WHERE end_dt='99999999' AND start_dt<>'00000000' AND start_dt<=to_char(now() AT TIME ZONE 'Asia/Tokyo','YYYYMMDD')) を ssh-db-proxy で dry-run する。

## 未対応(別途)
- **期間限定(bounded)** はアプリ未反映のまま。アプリ側(EnjoyTimePass)で「日付で有効価格を選択」する対応が本筋。
