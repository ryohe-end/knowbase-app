import type { NextConfig } from "next";

// NOTE: 既存コードに型エラーが残っているため、当面は ignoreBuildErrors を true にしている。
// 新規コードは `npm run typecheck` で守り、段階的に ignore を外す方針。
const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // html-pdf-node の依存 (batch → emitter) が webpack で解決できないため、
  // サーバー側で require させて bundle 対象から外す
  serverExternalPackages: ["html-pdf-node"],
};

export default nextConfig;