# 会員照会 監査ログテーブル

`/admin/member-search` 経由の検索・閲覧操作をすべて記録する DynamoDB テーブル。

## テーブル定義

- **テーブル名**: `knowbie-member-lookup-audit`
- **課金モード**: On-Demand (PAY_PER_REQUEST) ※書き込み頻度が低いため
- **TTL**: なし (恒久保存。後で年次バッチで Glacier に逃がす運用も可)

### キー構成

| 項目 | 型 | 役割 |
|---|---|---|
| `userId` (PK) | String | 操作者のメールアドレス |
| `timestamp` (SK) | String | ISO8601 (`2026-05-27T10:00:00.123Z`) |

### Item Attributes

| 属性 | 型 | 必須 | 内容 |
|---|---|:---:|---|
| `action` | String | ✓ | `"search"` または `"view"` |
| `searchType` | String | search時 | `udid`/`member_no`/`phone`/`email`/`name_kanji`/`name_kana` |
| `resultCount` | Number | search時 | ヒット件数 |
| `accessedKojinSeq` | String | view時 | 閲覧した個人SEQ |
| `ip` | String | - | `x-forwarded-for` |
| `userAgent` | String | - | UA文字列 |

> **検索値そのものは保存しない方針** (PII漏洩リスク低減)。  
> 「誰がいつ何タイプで検索→何件ヒット→誰の詳細を見た」が追える設計。

### GSI (オプション)

横断照会用に1個だけ追加すると便利:

- **インデックス名**: `action-timestamp-index`
- **PK**: `action` (String)
- **SK**: `timestamp` (String)
- **用途**: 「直近24時間のview全件を時系列で見る」

## CDK スニペット (TypeScript)

```ts
import { Table, AttributeType, BillingMode, ProjectionType } from "aws-cdk-lib/aws-dynamodb";

const auditTable = new Table(this, "MemberLookupAudit", {
  tableName: "knowbie-member-lookup-audit",
  partitionKey: { name: "userId",    type: AttributeType.STRING },
  sortKey:      { name: "timestamp", type: AttributeType.STRING },
  billingMode:  BillingMode.PAY_PER_REQUEST,
  pointInTimeRecovery: true,
});

auditTable.addGlobalSecondaryIndex({
  indexName: "action-timestamp-index",
  partitionKey: { name: "action",    type: AttributeType.STRING },
  sortKey:      { name: "timestamp", type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
});
```

## AWS CLI で手作りする場合

```sh
aws dynamodb create-table \
  --table-name knowbie-member-lookup-audit \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions \
      AttributeName=userId,AttributeType=S \
      AttributeName=timestamp,AttributeType=S \
      AttributeName=action,AttributeType=S \
  --key-schema \
      AttributeName=userId,KeyType=HASH \
      AttributeName=timestamp,KeyType=RANGE \
  --global-secondary-indexes \
      'IndexName=action-timestamp-index,KeySchema=[{AttributeName=action,KeyType=HASH},{AttributeName=timestamp,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
  --region us-east-1

aws dynamodb update-continuous-backups \
  --table-name knowbie-member-lookup-audit \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --region us-east-1
```

## IAM ポリシー (Amplify SSR ロールに付与)

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["dynamodb:PutItem"],
    "Resource": "arn:aws:dynamodb:us-east-1:340005228061:table/knowbie-member-lookup-audit"
  }]
}
```

照会用UIを後で作る場合は `dynamodb:Query` も追加。
