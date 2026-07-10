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

variable "pg_host" {
  description = "会員DB のホスト IP。SG の egress をこの IP に絞るため。"
  type        = string
  default     = "188.93.146.126"
}

variable "pg_port" {
  description = "会員DB のポート"
  type        = number
  default     = 5432
}

variable "amplify_ssr_role_name" {
  description = "Amplify SSR 実行ロール名。指定するとこのロールに db-proxy への invoke 権限を付与する。空なら手動付与。"
  type        = string
  default     = ""
}
