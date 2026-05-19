# マニュアル自動前処理セットアップ手順

マニュアル登録/更新時に自動で前処理が走る仕組みのセットアップ。

## アーキテクチャ

```
[管理画面でマニュアル保存]
       ↓
[POST/PUT /api/manuals] → DynamoDB に保存
       ↓
[EventBridge PutEvents] source=knowbie.manual.saved
       ↓
[EventBridge Rule] match source → API destination
       ↓
[POST /api/preprocess/run] {manualId}
       ↓
[preprocessOne(embedUrl)] Vision LLM / Textract / Transcribe ...
       ↓
[S3 へ Markdown アップロード]
       ↓
[DynamoDB に preprocessedAt 等を更新]
```

## 必要な AWS リソース

### 1. S3 バケット (出力先)

- バケット名: **`knowbie-preprocessed-manuals`** (デフォルト)
- リージョン: `us-east-1`
- パブリックアクセス: 全ブロック (デフォルト)
- バージョニング: 任意 (履歴を残したいならオン)

別名にしたい場合は Amplify 環境変数 `PREPROCESS_OUTPUT_BUCKET` で上書き。

```bash
aws s3 mb s3://knowbie-preprocessed-manuals --region us-east-1
```

### 2. IAM 権限追加 (Amplify SSR ロール)

ロール: `AmplifySSRLoggingRole-65854791-fff4-4cf6-80d6-570b46141004` (既存)

追加するインラインポリシー:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EventBridgePut",
      "Effect": "Allow",
      "Action": ["events:PutEvents"],
      "Resource": "*"
    },
    {
      "Sid": "S3PreprocessedManuals",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::knowbie-preprocessed-manuals",
        "arn:aws:s3:::knowbie-preprocessed-manuals/*"
      ]
    },
    {
      "Sid": "BedrockTextractTranscribe",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "textract:DetectDocumentText",
        "textract:AnalyzeDocument",
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob",
        "transcribe:DeleteTranscriptionJob"
      ],
      "Resource": "*"
    }
  ]
}
```

### 3. Amplify 環境変数

Amplify Console → アプリ → 環境変数 に以下を追加:

| 変数名 | 値 | 用途 |
|---|---|---|
| `PREPROCESS_OUTPUT_BUCKET` | `knowbie-preprocessed-manuals` | S3 出力先 |
| `PREPROCESS_EVENT_BUS` | `default` | (オプション、デフォルト OK) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | サービスアカウント JSON (1 行で) | Drive 読み取り |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | (オプション) |
| `PREPROCESS_TRANSCRIBE_BUCKET` | `knowbie-transcribe-tmp` | (動画処理時のみ) |
| `YOUTUBE_API_KEY` | YouTube Data API キー | (YouTube 処理時のみ) |

### 4. EventBridge API destination

#### 4-1. Connection

👉 https://us-east-1.console.aws.amazon.com/events/home?region=us-east-1#/connections

「接続を作成」:
- **名前**: `knowbie-preprocess-connection`
- **API タイプ**: パブリック
- **認可タイプ**: APIキー (ダミー値: name=`X-Dummy`, value=`dummy`)

#### 4-2. API Destination

👉 https://us-east-1.console.aws.amazon.com/events/home?region=us-east-1#/apidestinations

「API 送信先を作成」:
- **名前**: `knowbie-preprocess-run`
- **エンドポイント**: `https://main.d5z4bnw4wyrxn.amplifyapp.com/api/preprocess/run?token=<KB_ADMIN_API_KEY>`
- **HTTP メソッド**: **POST**
- **接続**: `knowbie-preprocess-connection`

### 5. EventBridge Rule

👉 https://us-east-1.console.aws.amazon.com/events/home?region=us-east-1#/rules

「ルールを作成」:
- **名前**: `KnowBase-Manual-Preprocess`
- **イベントバス**: `default`
- **ルールタイプ**: **イベントパターンを持つルール**

イベントパターン (カスタムパターン → JSON):

```json
{
  "source": ["knowbie.manual.saved"]
}
```

ターゲット:
- **ターゲットタイプ**: **EventBridge API 送信先**
- **API 送信先**: `knowbie-preprocess-run`
- **入力の設定**:
  - **入力トランスフォーマー** を選択
  - **入力パス**:
    ```json
    { "manualId": "$.detail.manualId" }
    ```
  - **入力テンプレート**:
    ```
    { "manualId": "<manualId>" }
    ```

- **実行ロール**: 「この特定のリソースのために新しいロールを作成」

## 動作確認

### 単発テスト (CLI)

```bash
curl -X POST \
  "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/preprocess/run?token=<KB_ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"manualId":"M200-XXXXXX"}'
```

期待レスポンス:
```json
{
  "ok": true,
  "manualId": "M200-XXXXXX",
  "s3Key": "manuals/M200-XXXXXX.md",
  "bucket": "knowbie-preprocessed-manuals",
  "sourceType": "google-slides",
  "chars": 12450,
  "elapsedMs": 92000
}
```

### 自動トリガーテスト

1. 管理画面でマニュアル新規作成 (embedUrl 必須)
2. 保存後、数秒で EventBridge 起動
3. /api/preprocess/run が呼ばれる
4. 数分後、DynamoDB の該当マニュアルに `preprocessedAt` がセットされる
5. S3 `knowbie-preprocessed-manuals/manuals/<manualId>.md` にファイルが作成される

CloudWatch Logs (Amplify SSR Function) で進捗確認:
- `[manuals] EventBridge PutEvents sent <manualId>` ← 保存時
- `[PREPROCESS]` 系のログ ← 前処理側

## トラブルシューティング

| 症状 | 確認ポイント |
|---|---|
| マニュアル保存はできるが前処理が走らない | 1. CloudWatch で `EventBridge PutEvents sent` が出ているか<br>2. EventBridge Rule の「呼び出し」メトリクスが増えているか<br>3. API destination の Connection 認可状態 |
| Rule が起動するが API destination 失敗 | API destination の HTTP メソッドが POST か、URL/token が正しいか |
| /api/preprocess/run が 401 | token が `KB_ADMIN_API_KEY` と一致しているか |
| 前処理がタイムアウト | Amplify SSR Lambda の timeout が 15 分に設定されているか<br>(Next.js 15 では `export const maxDuration = 900;` で有効化済み) |
| Bedrock の throttling | 連続呼び出しで Throttling が出る場合、Lambda の同時実行数で制御 |
| S3 へ書けない | IAM ポリシーに s3:PutObject が含まれているか |

## オプション: 全件初回バッチ実行

既存マニュアル 400 本に対して一度だけ実行:

```bash
# 全件処理 (Slides は 3〜5 分/本 → 全部で 1 日くらいかかる)
for manualId in $(aws dynamodb scan --table-name yamauchi-Manuals \
  --projection-expression manualId --output text --query "Items[].manualId.S"); do
  echo "Processing $manualId"
  curl -X POST "https://main.d5z4bnw4wyrxn.amplifyapp.com/api/preprocess/run?token=$KB_ADMIN_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"manualId\":\"$manualId\"}" &
  # 並列数を絞るために 10 件おきに wait
done
```

(本番では `scripts/preprocess-all-manuals.ts` を直接動かす方が早い)
