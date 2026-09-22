import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root also has a bun.lock; pin the workspace root to this app.
  turbopack: { root: path.resolve(__dirname) },
  // `next dev` binds as localhost. Opening 127.0.0.1 is a different origin.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
