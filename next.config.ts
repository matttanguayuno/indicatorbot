import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['playwright', 'playwright-core'],
};

export default nextConfig;
