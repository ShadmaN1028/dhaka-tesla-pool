import type { NextConfig } from "next";

// The browser only ever talks to this origin, so the API's session cookie stays first-party.
// Rewrites are resolved when Next starts or builds, so API_URL must be set for that command.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The Docker image sets BUILD_STANDALONE=1; locally `next start` keeps working as before.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
