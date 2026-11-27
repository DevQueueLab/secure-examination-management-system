import path from 'node:path';
import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

/** Where the Next server reaches the API in development. In production a gateway routes /api/* on the same origin. */
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4901').replace(/\/$/, '');

/** Socket.IO origin: the API in development, empty (same origin through the gateway) in production. */
const socketUrl = (process.env.NEXT_PUBLIC_SOCKET_URL ?? (isDev ? 'http://localhost:4901' : '')).replace(/\/$/, '');

/** Monorepo root, so standalone output traces @athena/shared and hoisted dependencies. */
const monorepoRoot = path.resolve(import.meta.dirname, '../..');

function socketOrigins(): string {
  if (!socketUrl) return '';
  try {
    const url = new URL(socketUrl);
    const ws = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${url.origin} ${ws}//${url.host}`;
  } catch {
    return '';
  }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // The theme script in <head> is inline; dev needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${socketOrigins()}${isDev ? ' ws: wss:' : ''}`.trim(),
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Fullscreen stays allowed for our own origin: exams can require it.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), fullscreen=(self)',
  },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ['@athena/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // Inlined for the browser so a plain `next dev` (no .env file) still reaches the dev socket server.
  env: { NEXT_PUBLIC_SOCKET_URL: socketUrl },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    if (!isDev) return [];
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
