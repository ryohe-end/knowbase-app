output "egress_ip" {
  description = "★ DB 側の allowlist に登録する固定送信元 IP (NAT Gateway の Elastic IP)"
  value       = aws_eip.nat.public_ip
}

output "db_target_secret_arns" {
  description = "target名 -> Secrets Manager シークレット ARN。新DBの接続文字列を入れる先の確認用。"
  value       = local.db_target_secret_arns
}

output "proxy_function_name" {
  description = "Amplify の環境変数 DB_PROXY_FUNCTION_NAME に設定する値"
  value       = aws_lambda_function.proxy.function_name
}

output "proxy_function_arn" {
  description = "Amplify SSR ロールへ手動で invoke 権限を付ける場合の対象 ARN"
  value       = aws_lambda_function.proxy.arn
}

output "amplify_env_hint" {
  description = "Amplify に設定すべき環境変数"
  value = {
    DB_PROXY_FUNCTION_NAME = aws_lambda_function.proxy.function_name
    DB_PROXY_REGION        = var.region
  }
}
