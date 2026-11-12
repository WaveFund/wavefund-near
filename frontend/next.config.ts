import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The floating dev-tools badge overlaps the mobile tab bar during local demos.
  devIndicators: false,
  // Earlier routes keep working: funding moved under My Safe, the track record is Agents, owner tools are Advanced.
  async redirects() {
    return [
      { source: "/fund", destination: "/safe/fund", permanent: false },
      { source: "/record", destination: "/agents", permanent: false },
      { source: "/manager", destination: "/advanced", permanent: false },
    ];
  },
};

export default nextConfig;
