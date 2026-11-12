import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The floating dev-tools badge overlaps the mobile tab bar during local demos.
  devIndicators: false,
};

export default nextConfig;
