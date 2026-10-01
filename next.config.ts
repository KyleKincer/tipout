import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Next release type and lint checks enabled.
  images: {
    domains: ['img.clerk.com', 'images.clerk.dev'],
  },
};

export default nextConfig;
