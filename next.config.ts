//import type { NextConfig } from "next";

//const nextConfig: NextConfig = {
  /* config options here */
//};

//export default nextConfig;


import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // ESLintエラーを無視
  },
  typescript: {
    ignoreBuildErrors: true,   // TypeScriptエラーを無視
  },
};

export default nextConfig;