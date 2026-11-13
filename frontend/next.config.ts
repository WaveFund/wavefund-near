import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The floating dev-tools badge overlaps the mobile tab bar during local demos.
  devIndicators: false,
  // The hosted static mode imports the shared, Node-free reputation reader and pinned manifests from the repo root.
  experimental: { externalDir: true },
  // Earlier routes keep working. v2 navigation is Rounds / Portfolio / Agents; query strings carry over.
  async redirects() {
    return [
      { source: "/arena", destination: "/rounds", permanent: false },
      { source: "/demo", destination: "/rounds/local", permanent: false },
      { source: "/safe", destination: "/portfolio", permanent: false },
      { source: "/safe/fund", destination: "/portfolio/fund", permanent: false },
      { source: "/fund", destination: "/portfolio/fund", permanent: false },
      { source: "/record", destination: "/agents", permanent: false },
      { source: "/manager", destination: "/advanced", permanent: false },
    ];
  },
};

export default nextConfig;
