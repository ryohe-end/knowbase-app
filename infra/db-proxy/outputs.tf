output "egress_ip" {
  description = "★ DB 側の allowlist に登録する固定送信元 IP (NAT Gateway の Elastic IP)"
  value       = aws_eip.nat.public_ip
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
