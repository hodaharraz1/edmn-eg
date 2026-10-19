import type { NextConfig } from 'next';

const baseHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['sharp', 'pg', 'nodemailer', 'web-push'],
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  async headers() {
    return [
      { source: '/(.*)', headers: baseHeaders },
      // Content-Security-Policy is set per request (nonce) by src/proxy.ts — see pageCsp().
      // Push-only service worker: always revalidated so a deploy replaces it at once (it caches nothing itself).
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};

export default nextConfig;
