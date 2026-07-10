terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az = data.aws_availability_zones.available.names[0]
}

# ---------------------------------------------------------------------------
# ネットワーク: VPC / サブネット / IGW / NAT + EIP (固定 egress IP)
# ---------------------------------------------------------------------------
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name_prefix }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name_prefix}-igw" }
}

# NAT を置くパブリックサブネット
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = local.az
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name_prefix}-public" }
}

# Lambda を置くプライベートサブネット (0.0.0.0/0 は NAT 経由)
resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_subnet_cidr
  availability_zone = local.az
  tags              = { Name = "${var.name_prefix}-private" }
}

# ★ 固定 egress IP。DB 側の allowlist に登録するのはこの EIP。
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.name_prefix}-nat-eip" }
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
  tags          = { Name = "${var.name_prefix}-nat" }
  depends_on    = [aws_internet_gateway.this]
}

# パブリック: default route -> IGW
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.name_prefix}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# プライベート: default route -> NAT
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }
  tags = { Name = "${var.name_prefix}-private-rt" }
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

# ---------------------------------------------------------------------------
# Lambda 用セキュリティグループ (egress は会員DB へのみ許可)
# ---------------------------------------------------------------------------
resource "aws_security_group" "lambda" {
  name        = "${var.name_prefix}-lambda-sg"
  description = "db-proxy lambda egress to member DB only"
  vpc_id      = aws_vpc.this.id

  egress {
    description = "PostgreSQL to configured DBs"
    from_port   = var.pg_port
    to_port     = var.pg_port
    protocol    = "tcp"
    cidr_blocks = var.db_egress_cidrs
  }

  # Secrets Manager / STS など AWS API 呼び出し用 (NAT 経由で HTTPS)。
  # egress を更に絞るなら Secrets Manager の VPC インターフェイスエンドポイントに置換可。
  egress {
    description = "HTTPS to AWS APIs (Secrets Manager)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-lambda-sg" }
}

# ---------------------------------------------------------------------------
# Secrets Manager: 会員DB 接続文字列 (平文を Lambda env / コードに残さない)
# ---------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "pg" {
  count = var.pg_secret_arn == "" ? 1 : 0
  name  = "${var.name_prefix}/pg-connection"
}

resource "aws_secretsmanager_secret_version" "pg" {
  count         = var.pg_secret_arn == "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.pg[0].id
  secret_string = var.pg_database_url
}

locals {
  # target名の集合。接続文字列は機密なので、for_each には名前 (非機密) のみ使う。
  extra_target_names = nonsensitive(toset(keys(var.additional_db_targets)))
}

# member 以外の追加接続先。target ごとに個別シークレットを作成。
resource "aws_secretsmanager_secret" "extra" {
  for_each = local.extra_target_names
  name     = "${var.name_prefix}/pg-${each.key}"
}

resource "aws_secretsmanager_secret_version" "extra" {
  for_each      = local.extra_target_names
  secret_id     = aws_secretsmanager_secret.extra[each.key].id
  secret_string = var.additional_db_targets[each.key]
}

locals {
  pg_secret_arn = var.pg_secret_arn != "" ? var.pg_secret_arn : aws_secretsmanager_secret.pg[0].arn

  # target名 -> シークレット ARN のマップ (member + 追加分)
  db_target_secret_arns = merge(
    { member = local.pg_secret_arn },
    { for k in local.extra_target_names : k => aws_secretsmanager_secret.extra[k].arn }
  )
}

# ---------------------------------------------------------------------------
# IAM: Lambda 実行ロール (VPC ENI 管理権限)
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "vpc_access" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# 接続文字列シークレットの読み取り権限
resource "aws_iam_role_policy" "secret_read" {
  name = "${var.name_prefix}-secret-read"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = values(local.db_target_secret_arns)
    }]
  })
}

# ---------------------------------------------------------------------------
# Lambda 本体
# ---------------------------------------------------------------------------
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.build/db-proxy.zip"
}

resource "aws_lambda_function" "proxy" {
  function_name    = var.name_prefix
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 30
  memory_size      = 256

  vpc_config {
    subnet_ids         = [aws_subnet.private.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      # 平文の接続文字列は渡さない。Lambda は実行時に Secrets Manager から取得する。
      # target名 -> シークレット ARN のマップ (member + 追加分)。
      DB_TARGETS = jsonencode(local.db_target_secret_arns)
    }
  }
}

# ---------------------------------------------------------------------------
# (任意) Amplify SSR ロールに invoke 権限を付与
# ---------------------------------------------------------------------------
resource "aws_iam_role_policy" "amplify_invoke" {
  count = var.amplify_ssr_role_name == "" ? 0 : 1
  name  = "${var.name_prefix}-invoke"
  role  = var.amplify_ssr_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.proxy.arn
    }]
  })
}
