import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

/**
 * The dashboard is a static export (web/out) served by the NestJS server on the same origin.
 * `npm run dev:web` runs the Next.js dev server and proxies the API to the backend (DASHBOARD_API,
 * default http://127.0.0.1:4000).
 */
export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const api = process.env.DASHBOARD_API || 'http://127.0.0.1:4000';
  return {
    reactStrictMode: true,
    trailingSlash: true,
    poweredByHeader: false,
    images: { unoptimized: true },
    // no generated AGENTS.md in the project
    agentRules: false,
    ...(dev
      ? {
          // API paths have no trailing slash: do not redirect them
          skipTrailingSlashRedirect: true,
          async rewrites() {
            return ['/api/:path*', '/mcp', '/v1/:path*', '/ws/:path*'].map(source => ({ source, destination: `${api}${source}` }));
          }
        }
      : { output: 'export' as const })
  };
}
