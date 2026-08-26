import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Dev-only fetch cache that replays responses across HMR refreshes -
    // including failures. One transient Supabase auth error would otherwise
    // be served back on every refresh as a permanent "JWT issued at future".
    serverComponentsHmrCache: false,
  },
};

export default nextConfig;
