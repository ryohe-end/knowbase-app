# db-proxy — 会員DB への固定 IP 経路

管理画面 (Amplify SSR) から会員DB (PostgreSQL `188.93.146.126:5432`) へ接続する際の
**送信元 IP を 1 つの Elastic IP に固定**するための構成。DB 側の IP allowlist にはこの
EIP を 1 件登録すればよい。

## なぜ必要か

Amplify マネージド SSR は Lambda 上で動き、アウトバウンド IP は AWS の共有プールから
都度変わる（固定できない・VPC にも入れられない）。そこで **DB へ接続する処理だけ**を
VPC 内の `db-proxy` Lambda に切り出し、その egress を NAT Gateway + EIP に集約する。

```
Amplify SSR ──(lambda:InvokeFunction / IAM)──▶ db-proxy Lambda (private subnet)
                                                     │ 0.0.0.0/0
                                                     ▼
                                              NAT Gateway ── Elastic IP ★固定IP
                                                     ▼
                                       PostgreSQL 188.93.146.126:5432 (allowlist に EIP を登録)
```

アプリ側は `lib/memberDb.ts` の `query()` に集約済み。環境変数
`DB_PROXY_FUNCTION_NAME` が入っていればプロキシ経由、無ければ従来の直結。

会員DB の接続文字列は **Secrets Manager** に保存し、プロキシ Lambda が実行時に取得する
（Lambda の環境変数・コードに平文を残さない）。Terraform が `pg_database_url` から
シークレット `<name_prefix>/pg-connection` を作成し、Lambda には ARN (`PG_SECRET_ID`)
だけを渡す。既存シークレットを使う場合は `pg_secret_arn` を指定。

## デプロイ手順

```bash
cd infra/db-proxy

# 1) Lambda の依存 (pg) を取得。zip にバンドルされる。
cd lambda && npm install --omit=dev && cd ..

# 2) 変数を用意
cp terraform.tfvars.example terraform.tfvars
#   pg_database_url (機密) を編集。amplify_ssr_role_name が分かれば入れる。

# 3) 構築
terraform init
terraform plan
terraform apply

# 4) 出力を確認
terraform output egress_ip             # ← DB 管理者に渡して allowlist 登録してもらう
terraform output proxy_function_name   # ← 次のステップで Amplify に設定
```

## アプリ側の切り替え

Amplify コンソール → 対象アプリ → 環境変数に追加:

| キー | 値 |
| --- | --- |
| `DB_PROXY_FUNCTION_NAME` | `terraform output proxy_function_name` の値 |
| `DB_PROXY_REGION` | `ap-northeast-1`（このスタックのリージョン） |

再デプロイ後、3つの API (`basic` / `stores` / `machines`) はプロキシ経由になる。

### Amplify SSR ロールへの invoke 権限

`db-proxy` を呼ぶには Amplify の SSR 実行ロールに `lambda:InvokeFunction` が必要
（無いと呼び出しが 403 になるが **UI にはエラーが出ない** ので注意）。

- `terraform.tfvars` に `amplify_ssr_role_name` を入れておけば Terraform が自動付与する。
- 分からない場合は、Amplify の SSR ロール（例: `arn:aws:iam::...:role/...AmplifySSR...`）に
  以下のインラインポリシーを手動で付ける:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "lambda:InvokeFunction",
    "Resource": "<terraform output proxy_function_arn の値>"
  }]
}
```

## ロールバック

Amplify の `DB_PROXY_FUNCTION_NAME` を削除して再デプロイすれば、即座に従来の直結に戻る
（`terraform destroy` はその後で安全に実行可能）。

## 注意 / 今後

- プロキシ Lambda の接続情報は Secrets Manager に集約済み（平文なし）。ローテーション時は
  シークレット値を更新すれば、Lambda は次のコールドスタートで新しい値を読む。
- `lib/memberDb.ts` にはローカル直結用の接続文字列フォールバックが残る。Amplify で
  `DB_PROXY_FUNCTION_NAME` を設定すればプロキシ経由になりこの平文は使われないので、
  本番切替の確認後にフォールバックを削除すること。
- `db-proxy` は渡された SQL をそのまま実行する汎用プロキシ。呼び出しは IAM で自社 SSR
  ロールに限定される前提。より厳密にするなら名前付きオペレーション化を検討。
- 冗長化する場合は 2AZ 化 → NAT が 2 台になり **EIP も 2 つ**になる（allowlist も 2 IP）。
  今回は「固定 IP 1 つ」の要件に合わせ単一 AZ 構成。
