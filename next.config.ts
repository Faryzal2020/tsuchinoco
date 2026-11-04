import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Files named `*.dev.tsx` are routes only under `next dev`. The login-free sandbox at /sandbox/
// uses this, so it never exists in a production build or on Firebase Hosting.
export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    output: 'export',
    trailingSlash: true,
    images: {
      unoptimized: true
    },
    pageExtensions: dev ? ['dev.tsx', 'tsx', 'ts', 'jsx', 'js'] : ['tsx', 'ts', 'jsx', 'js'],
  };
}
