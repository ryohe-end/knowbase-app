# scripts/preprocess-manual.ts

Google Drive 上のマニュアルおよび YouTube URL を AI が読みやすい Markdown に変換するスクリプト。

## 対応形式

| 種類 | 処理 | 必要権限 |
|---|---|---|
| **Google Slides** | Slides API でテキスト+ノート抽出、各ページ画像を Bedrock Vision に投げて Markdown 化 | Drive / Slides / Bedrock |
| **PowerPoint (PPTX)** | Drive で Slides に変換してから上記処理 | + |
| **Google Docs** | Docs API で見出し付き Markdown 抽出 | Drive / Docs |
| **Word (DOCX)** | Drive で Docs に変換してから上記処理 | + |
| **PDF** | pdf-parse でテキスト抽出。空(=スキャン)なら Textract OCR | Drive / Textract |
| **Google Sheets** | Sheets API で各シートを Markdown 表に | Drive / Sheets |
| **Excel (XLSX)** | xlsx ライブラリで各シートを Markdown 表に | Drive |
| **動画 (mp4 / mov / webm)** | S3 へ一時アップロード → AWS Transcribe で文字起こし | Drive / S3 / Transcribe |
| **YouTube URL** | YouTube Data API v3 で字幕取得 | YouTube Data API key |

## 使い方

```bash
# Drive ファイル ID
npx tsx scripts/preprocess-manual.ts <DriveFileId>

# 出力先を指定
npx tsx scripts/preprocess-manual.ts <DriveFileId> --out=path/to/output.md

# YouTube URL
npx tsx scripts/preprocess-manual.ts https://www.youtube.com/watch?v=XXXXXXXXXXX

# モデルを上書き
BEDROCK_MODEL_ID="us.anthropic.claude-sonnet-4-6" \
  npx tsx scripts/preprocess-manual.ts <DriveFileId>
```

デフォルトの出力先: `./output/{fileId|youtube-id}.md`

## 環境変数

### 必須 (どの形式でも必要)

| 変数 | 説明 | 例 |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` または `GOOGLE_SERVICE_ACCOUNT_JSON` | Drive アクセス用 Service Account の JSON ファイルパスまたは JSON 文字列 | `./keys/sa.json` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or `~/.aws/credentials`) | AWS 認証 | - |

### Slides / PPTX / PDF Vision を使う場合

| 変数 | 説明 | デフォルト |
|---|---|---|
| `AWS_REGION` | Bedrock / Textract のリージョン | `us-east-1` |
| `BEDROCK_MODEL_ID` | 使用する Bedrock モデル | `us.anthropic.claude-sonnet-4-6` |

### 動画 (mp4) を処理する場合

| 変数 | 説明 |
|---|---|
| `PREPROCESS_TRANSCRIBE_BUCKET` | 動画一時格納と Transcribe 出力用の S3 バケット名 (例: `knowbie-transcribe-tmp`) |

### YouTube URL を処理する場合

| 変数 | 説明 |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 の API キー (Google Cloud Console で取得) |

## 必要な AWS 権限

IAM ユーザー or ロールに以下を付与:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "textract:DetectDocumentText",
        "textract:AnalyzeDocument",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob",
        "transcribe:DeleteTranscriptionJob"
      ],
      "Resource": "*"
    }
  ]
}
```

(本番運用時は S3 リソースを `arn:aws:s3:::knowbie-transcribe-tmp/*` のように絞り込み推奨)

## 必要な Google API

GCP プロジェクトで以下を **有効化**:

- Google Drive API
- Google Slides API
- Google Docs API
- Google Sheets API
- YouTube Data API v3 (YouTube 処理時のみ)

## 必要な AWS リソース

### 動画処理用 S3 バケット
- 名前: `PREPROCESS_TRANSCRIBE_BUCKET` 環境変数で指定 (例: `knowbie-transcribe-tmp`)
- 権限: IAM ユーザー or ロールが読み書き可能
- ライフサイクル: 1〜7 日で自動削除する設定を推奨 (スクリプトはジョブ完了後に手動削除も行うが、失敗時のゴミを放置しない保険)

### Transcribe
- リージョンが `AWS_REGION` と一致していること
- アカウントレベルの初期セットアップは不要 (IAM 権限のみあれば動く)

## 既知の制限

- **PDF 5MB 超のスキャン PDF**: 同期 Textract API では未対応。`StartDocumentTextDetection` (非同期) を使うように改修が必要
- **YouTube 字幕ダウンロード**: Service Account では取得できない場合がある (動画所有者の OAuth が必要)。代替: `yt-dlp` や Transcribe を使う
- **動画長時間**: Transcribe ジョブのポーリングは 30 分でタイムアウト
- **Vision LLM のレート制限**: 大量のスライドを連続処理すると Bedrock throttling の可能性。リトライ未実装

## 出力例

```markdown
---
source_file_id: 1AbCdEfGh...
title: "新規入会の流れ.pptx"
mime_type: application/vnd.google-apps.presentation (converted)
processed_at: 2026-05-19T...
processor: preprocess-manual.ts
bedrock_model: us.anthropic.claude-sonnet-4-6
slide_count: 19
---
# スライド 1
...
```

## トラブルシューティング

| エラー | 原因 | 対処 |
|---|---|---|
| `Service account credentials not found` | 環境変数未設定 | `.env.local` に `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` を設定 |
| `Model identifier is invalid` | Bedrock モデル ID 不正 | コンソールで正しい inference profile ID を確認 |
| `Model access is denied` | Bedrock サブスクリプション未完了 | AWS ルートでプレイグラウンドから 1 回呼び出す |
| `Use case details have not been submitted` | Anthropic フォーム未提出 | Bedrock コンソールでフォーム送信 |
| `PREPROCESS_TRANSCRIBE_BUCKET が未設定` | 動画用バケット未指定 | 環境変数に S3 バケット名を設定 |
| `YOUTUBE_API_KEY 未設定` | YouTube キー未指定 | Google Cloud Console で API キーを発行 |
