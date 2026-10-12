import type { NextConfig } from 'next';

const adminHost = (process.env.ADMIN_HOST ?? 'admin.edmneg.com').toLowerCase();

const baseHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

/**
 * Public surfaces keep 'unsafe-inline' for scripts: Next.js App Router emits inline bootstrap scripts, and a
 * nonce would force EVERY public page to render dynamically (no static/ISR) — not viable on the current
 * Vercel Hobby budget. The admin surface (money approvals, KYC documents) is excluded here and gets a strict
 * per-request nonce CSP from src/proxy.ts instead.
 */
const publicCsp = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-src 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['sharp', 'pg', 'nodemailer', 'web-push'],
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  async headers() {
    return [
      { source: '/(.*)', headers: baseHeaders },
      { source: '/((?!admin(?:/|$)).*)', missing: [{ type: 'host', value: adminHost }], headers: publicCsp },
      // Push-only service worker: always revalidated so a deploy replaces it at once (it caches nothing itself).
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};

export default nextConfig;
