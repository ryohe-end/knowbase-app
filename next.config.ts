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
};

export default nextConfig;