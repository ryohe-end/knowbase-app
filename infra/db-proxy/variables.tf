variable "region" {
  description = "リソースを作成する AWS リージョン (Amplify アプリ / DynamoDB と同一に揃える)"
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "作成リソース名の接頭辞"
  type        = string
  default     = "knowbie-db-proxy"
}

variable "vpc_cidr" {
  description = "新規 VPC の CIDR"
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidr" {
  description = "NAT Gateway を置くパブリックサブネットの CIDR"
  type        = string
  default     = "10.20.0.0/24"
}

variable "private_subnet_cidr" {
  description = "プロキシ Lambda を置くプライベートサブネットの CIDR"
  type        = string
  default     = "10.20.10.0/24"
}

variable "pg_database_url" {
  description = "会員DB への接続文字列 (postgres://user:pass@host:5432/db)。pg_secret_arn が空のとき、この値で Secrets Manager シークレットを新規作成する。tfvars か環境変数 TF_VAR_pg_database_url で渡す。"
  type        = string
  sensitive   = true
  default     = ""
}

variable "pg_secret_arn" {
  description = "既存の Secrets Manager シークレット ARN を使う場合に指定。空なら pg_database_url から新規作成する。"
  type        = string
  default     = ""
}

variable "additional_db_targets" {
  description = "member 以外の追加接続先。{ target名 = 接続文字列 } のマップ。各 target ごとに Secrets Manager シークレットを作成する。例: { newdb = \"postgres://...\" }"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "pg_port" {
  description = "PostgreSQL のポート"
  type        = number
  default     = 5432
}

variable "db_egress_cidrs" {
  description = "Lambda が 5432 で接続を許可する宛先 CIDR。複数DB対応のため既定は全許可。特定IPに絞るなら各DBのIP/32を列挙する。"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "amplify_ssr_role_name" {
  description = "Amplify SSR 実行ロール名。指定するとこのロールに db-proxy への invoke 権限を付与する。空なら手動付与。"
  type        = string
  default     = ""
}
