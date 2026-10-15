import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // TypeScript (19 MB) se colaba en el standalone sólo por cargar este
  // next.config.ts; el servidor de producción (server.js) no lo usa.
  outputFileTracingExcludes: {
    "next-server": ["**/node_modules/typescript/**"],
  },
};

export default nextConfig;
