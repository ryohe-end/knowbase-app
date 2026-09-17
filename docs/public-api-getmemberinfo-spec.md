# 公開API 仕様書 — 会員ステータス状況確認 (`/api/public/getMemberInfo`)

外部システム向け公開API。会員の**会員情報・契約情報・支払情報・入館履歴**を返す。
本家 `wellness-frontier.com/api/getMemberInfo` の**ドロップイン置換**として、同一のリクエスト/レスポンス形式で提供する。

- 認証: **送信元IP許可制**（このAPIのみ。他の公開APIの `x-api-key` は不要／使用しない）。
  許可IPは環境変数 `KB_GETMEMBERINFO_ALLOW_IPS`（カンマ区切り）＋コード内の既定IP。許可外は `403 forbidden_ip`。
  実IP判定は `cloudfront-viewer-address` 優先→`x-forwarded-for` の右端の公開IP（CloudFront/Amplify背後・詐称対策）。
- メソッド: **POST**（本家同様。動作確認用に GET も可）
- データソース: Oracle adb01 `FIT_ADMIN`（`knowbie_ro`, read-only）を member-search Lambda `type:"member_info"` で整形
- 実装: `app/api/public/getMemberInfo/route.ts`

> **⚠️ データ鮮度**: adb01 は毎晩スナップショットからリストアされるため、**当日の更新（入金・契約変更・入館）は最大約24時間反映が遅れる**。リアルタイムが必須の用途は本家APIを使用のこと。

---

## エンドポイント

```
POST /api/public/getMemberInfo
Content-Type: application/json
# ※ x-api-key は不要。許可済みの固定IPから呼び出すこと。
```

### リクエスト（JSON）

| フィールド | 必須 | 型 | 説明 |
|---|---|---|---|
| `userID` | – | string | 会員識別ID（カードUID）。指定時はレスポンスにそのまま返す |
| `memberID` | ● | number(≤10桁) | 会員番号 |
| `type` | ● | number | 1:会員認証/契約情報, 2:支払情報, 3:YOGAスタジオ履歴, 4:入館履歴 |
| `reqTimestamp` | – | string | 要求日時 `yyyy-MM-dd HH:mm:ss`（省略時はサーバ時刻） |
| `historyFrom` | △ | number(YYYYMMDD) | **type=3/4 で必須**。取得開始日（期間は最大366日） |
| `historyTo` | △ | number(YYYYMMDD) | **type=3/4 で必須**。取得終了日 |

> **type=3（YOGAスタジオ履歴）は adb01 に該当データが無いため非対応**。`resultCode:"NG"`, `yogaStudioHistory:[]` を返す。

---

## レスポンス（JSON）

本家 getMemberInfo と同一形式。`resultCode` が `NG`（会員が存在しない/退会済み）の場合、各Objectは空。

### 共通
| フィールド | 説明 |
|---|---|
| `userID` / `memberID` / `type` / `reqTimestamp` / `historyFrom` / `historyTo` | リクエスト値をエコー |
| `resultCode` | `OK` / `NG`（reqTimestamp時点で会員が存在しない/退会済みなら NG） |
| `memberInfo` | 会員情報（NGなら null） |

### memberInfo
| フィールド | 元 | 説明 |
|---|---|---|
| `memberID` | 会員番号 | 会員番号 |
| `name` | 個人.漢字姓名 | 会員名 |
| `clubCode` | 会員契約.クラブコード | 所属クラブコード（主契約=会員区分1/60/70の最新） |
| `paymentType` | 会員契約者口座.委託先コード（無ければ最新入金の委託先） | 0:現金 1:SMBC 2:JACCS収金 3:オリコ 4:りそな 5:ソフトバンク 6:JACCS(FIT) 7:GMO 9:FD自振 88/89:JACCS 90:現金 99:振込 |

### contractInfo[]（type=1のみ・在籍契約=終了年月日なしのみ）
memberType昇順, contractCode昇順, startDate昇順で出力。
| フィールド | 元 | 説明 |
|---|---|---|
| `memberType` | 会員区分コード | 1:フィットネス 8:タイム会員 70:法人個人 上記以外:オプション契約 |
| `memberTypeName` | 固定変換 | memberTypeに応じ「フィットネス/タイム会員/法人個人/オプション契約」 |
| `contractCode` / `contractName` | 契約形態コード/名 | |
| `startDate` | 会員契約.利用開始日 | `yyyy-MM-dd` |
| `endDate` | 会員契約明細.終了年月日 | `yyyy-MM-dd`（終了指定なしは `9999-12-31`） |

### payInfo[]（type=2のみ・直近7ヶ月）
requestMonth降順, contractCode昇順, requestDate昇順で出力。
| フィールド | 元 | 説明 |
|---|---|---|
| `requestMonth` | 会員入金歴.対応年月 | `yyyymm` |
| `contractCode` | 契約形態コード | |
| `contractName` | – | 会費分類=年管理費(50)は「セキュリティ管理／施設メンテナンス料」、会費(1)は契約形態名、その他(入会金等)は会費分類名 |
| `requestDate` | 請求年月日（無ければ入金年月日） | `yyyy-MM-dd` |
| `amount` | 会員入金歴.請求額 | KIOSK決済分も含む |
| `payStatus` | 入金区分コード | 1:支払義務なし 2:未請求 3:支払済み 4:未納 |
| `payImmediate` | – | 都度決済フラグ(1:KIOSK/WEB, 0:会員管理)。**現状 0固定**（精緻化には売上明細GRANTが必要） |
| `payDate` | 入金年月日 | `yyyy-MM-dd`（未入金は `9999-12-31`） |

### clubHistory[]（type=4のみ・historyFrom〜historyToの入館）
businessDay昇順, inDate昇順, inClubCode昇順で出力。
| フィールド | 元 | 説明 |
|---|---|---|
| `businessDay` | 入館トラン.営業年月日 | `YYYYMMDD` |
| `inFlag` | 入館中フラグ | 0:退館済み 1:入館中 |
| `inDate` / `outDate` | 入館/退館時刻 | `YYYYMMDDHH24MISS`（入館中は outDate 空） |
| `inClubCode` | クラブコード | 入館クラブコード |

### yogaStudioHistory[]（type=3のみ）
**非対応**。常に空配列 + `resultCode:"NG"`。

---

## エラー
| ステータス | body | 条件 |
|---|---|---|
| 400 | `{ resultCode:"NG", error:"..." }` | memberID/type/historyFrom/To の形式不正 |
| 403 | `{ ok:false, error:"forbidden_ip", ip:"<判定IP>" }` | 送信元IPが許可リスト外 |
| 502 | `{ resultCode:"NG", error:"..." }` | member-search 呼び出し失敗 |
| 503 | `{ ok:false, error:"ip_allowlist_not_configured" }` | 許可IPが未設定 |

---

## 使用例
```sh
# type=1 契約情報
curl -X POST -H "Content-Type: application/json" \
  -d '{"memberID":"1180002455","type":1}' https://<host>/api/public/getMemberInfo

# type=4 入館履歴（期間指定）
curl -X POST -H "Content-Type: application/json" \
  -d '{"memberID":"1180002455","type":4,"historyFrom":"20260801","historyTo":"20260915"}' \
  https://<host>/api/public/getMemberInfo
```

---

## 運用メモ
- member-search Lambda `type:"member_info"` が本体（infoType=1/2/4）。使用テーブル（会員番号/個人/会員契約/会員契約明細/契約形態/会員区分/会員入金歴/会費分類/会員契約者口座/入館トラン）は `post-restore-setup` で GRANT 済＝夜間リストア後も維持。
- 本家との**パリティは13会員で実測一致**（payImmediate除く）。
- **payImmediate を正確化する場合**: `FIT_ADMIN.売上明細` の GRANT + `対応売上明細SEQ→売上明細→精算` の決済チャネル確定が必要。
- ルート更新は Amplify のデプロイで反映される。
