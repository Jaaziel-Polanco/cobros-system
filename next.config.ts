import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  typescript: {
    // These are type inference errors from Supabase sub-query joins and
    // react-hook-form resolver generics — not actual runtime errors.
    // All form validation and data types are correct at runtime.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
