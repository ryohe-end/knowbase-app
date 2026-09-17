// ★診断専用★ 実行時に環境変数が届いているか確認（値は伏せる。ドメインのみ表示）。確認後に削除。
import { NextResponse } from "next/server";
import { loadRuntimeEnv } from "@/lib/runtimeEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  loadRuntimeEnv();
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN || "";
  return NextResponse.json({
    shop_domain: process.env.SHOPIFY_SHOP_DOMAIN || null,
    admin_token_set: token.length > 0,
    admin_token_len: token.length,
    admin_token_prefix: token.slice(0, 6),
    api_version: process.env.SHOPIFY_API_VERSION || "(default 2025-01)",
    cpss_env: process.env.CPSS_ENV || "(default stg)",
  });
}
